import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import func, inspect, select, text
from sqlalchemy.exc import IntegrityError

from app.core.config import BACKEND_DIR
from app.models import (
    Answer,
    Base,
    Evaluation,
    InterviewSession,
    LLMCall,
    Question,
    Rubric,
    User,
)
from app.models.enums import (
    AuthProvider,
    Difficulty,
    InputModel,
    QuestionType,
    ValidationStatus,
)

SHARED_TABLES = {"users", "rubrics", "experiment_runs"}


@pytest.fixture
def db(db_engine, db_session):
    Base.metadata.create_all(db_engine)
    return db_session


def add_user(db, provider_user_id="u-1"):
    user = User(auth_provider=AuthProvider.GITHUB, provider_user_id=provider_user_id)
    db.add(user)
    db.flush()
    return user


def add_session(db, user):
    session = InterviewSession(owner_id=user.id, input_model=InputModel.TOPIC)
    db.add(session)
    db.flush()
    return session


def add_rubric(db):
    rubric = Rubric(name="default", version="1", criteria_json=[], max_score=5)
    db.add(rubric)
    db.flush()
    return rubric


def add_question(db, session, rubric, sequence=1, type=QuestionType.CONCEPTUAL):
    question = Question(
        session_id=session.id,
        sequence=sequence,
        type=type,
        competency="overfitting",
        difficulty=Difficulty.INTERMEDIATE,
        prompt="Why does overfitting happen?",
        rubric_id=rubric.id,
    )
    db.add(question)
    db.flush()
    return question


def add_answer(db, question):
    answer = Answer(question_id=question.id, session_id=question.session_id, text="Because...")
    db.add(answer)
    db.flush()
    return answer


def count(db, model):
    return db.scalar(select(func.count()).select_from(model))


# Migration


def alembic_config(connection):
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.attributes["connection"] = connection
    config.attributes["configure_logger"] = False
    return config


def test_migration_creates_exactly_the_model_schema(db_engine):
    with db_engine.begin() as connection:
        command.upgrade(alembic_config(connection), "head")

        differences = compare_metadata(MigrationContext.configure(connection), Base.metadata)

    assert differences == []


def test_migrated_database_allows_only_known_auth_providers(db_engine):
    # compare_metadata does not compare CHECK constraints, so test them directly.
    insert = text(
        "INSERT INTO users (id, auth_provider, provider_user_id, created_at) "
        "VALUES (:id, :provider, :id, CURRENT_TIMESTAMP)"
    )
    with db_engine.begin() as connection:
        command.upgrade(alembic_config(connection), "head")
        for provider in ("google", "github", "dev"):
            connection.execute(insert, {"id": provider, "provider": provider})

        with pytest.raises(IntegrityError):
            connection.execute(insert, {"id": "apple", "provider": "apple"})


def test_migration_downgrade_removes_every_table(db_engine):
    with db_engine.begin() as connection:
        config = alembic_config(connection)
        command.upgrade(config, "head")
        command.downgrade(config, "base")

        remaining = set(inspect(connection).get_table_names()) - {"alembic_version"}

    assert remaining == set()


# Ownership


def test_every_table_is_shared_or_owned_by_a_user():
    owned = {name for name, table in Base.metadata.tables.items() if "owner_id" in table.c}

    # Child tables are owned through a required link to an owned parent.
    changed = True
    while changed:
        changed = False
        for name, table in Base.metadata.tables.items():
            if name in owned or name in SHARED_TABLES:
                continue
            if any(
                fk.column.table.name in owned and not fk.parent.nullable
                for fk in table.foreign_keys
            ):
                owned.add(name)
                changed = True

    # llm_calls has two optional parents, and a CHECK requires at least one.
    owned.add("llm_calls")

    assert set(Base.metadata.tables) - SHARED_TABLES == owned
    assert {"documents", "sessions", "jobs"} <= {
        name for name, table in Base.metadata.tables.items() if "owner_id" in table.c
    }


def test_llm_call_without_a_session_or_document_is_rejected(db):
    db.add(
        LLMCall(
            purpose="generate_question",
            model="fake",
            prompt_version="1",
            raw_output="{}",
            validation_status=ValidationStatus.VALID,
        )
    )

    with pytest.raises(IntegrityError):
        db.flush()


def test_deleting_a_user_deletes_everything_they_own(db):
    user = add_user(db)
    session = add_session(db, user)
    add_answer(db, add_question(db, session, add_rubric(db)))
    db.commit()

    db.delete(user)
    db.commit()

    assert count(db, InterviewSession) == 0
    assert count(db, Question) == 0
    assert count(db, Answer) == 0
    assert count(db, Rubric) == 1  # Shared, so it stays.


def test_a_rubric_in_use_cannot_be_deleted(db):
    rubric = add_rubric(db)
    add_question(db, add_session(db, add_user(db)), rubric)
    db.commit()

    with pytest.raises(IntegrityError):
        db.execute(text("DELETE FROM rubrics"))


# Duplicate protection


def test_a_question_accepts_only_one_answer(db):
    question = add_question(db, add_session(db, add_user(db)), add_rubric(db))
    add_answer(db, question)

    with pytest.raises(IntegrityError):
        add_answer(db, question)


def test_an_answer_accepts_only_one_evaluation(db):
    answer = add_answer(db, add_question(db, add_session(db, add_user(db)), add_rubric(db)))
    db.add(Evaluation(answer_id=answer.id, scores_json={}, evaluator_version="1"))
    db.flush()

    db.add(Evaluation(answer_id=answer.id, scores_json={}, evaluator_version="1"))
    with pytest.raises(IntegrityError):
        db.flush()


def test_a_session_cannot_have_two_questions_with_the_same_sequence(db):
    session = add_session(db, add_user(db))
    rubric = add_rubric(db)
    add_question(db, session, rubric, sequence=1)

    with pytest.raises(IntegrityError):
        add_question(db, session, rubric, sequence=1)


def test_the_same_provider_account_cannot_sign_up_twice(db):
    add_user(db, provider_user_id="same")

    with pytest.raises(IntegrityError):
        add_user(db, provider_user_id="same")


# Allowed values


def test_a_generated_question_cannot_be_mixed(db):
    session = add_session(db, add_user(db))

    with pytest.raises(IntegrityError):
        add_question(db, session, add_rubric(db), type=QuestionType.MIXED)


def test_the_database_rejects_an_unknown_session_state(db):
    session = add_session(db, add_user(db))

    with pytest.raises(IntegrityError):
        db.execute(
            text("UPDATE sessions SET state = 'DANCING' WHERE id = :id"),
            {"id": session.id.hex},
        )


def test_new_rows_get_ids_timestamps_and_defaults(db):
    session = add_session(db, add_user(db))
    question = add_question(db, session, add_rubric(db))

    assert session.id is not None
    assert session.state == "PREPARING"
    assert session.created_at is not None
    assert question.grounding_status == "NOT_APPLICABLE"
    assert question.source_chunk_ids == []


def test_labels_built_from_prompt_versions_fit_their_columns():
    """SQLite ignores string lengths, so a value too long for PostgreSQL would pass every other test."""
    from app.models import Evaluation, LLMCall
    from app.services.prompts import PROMPT_VERSIONS

    for purpose, version in PROMPT_VERSIONS.items():
        assert len(purpose) <= LLMCall.__table__.c.purpose.type.length, purpose
        assert len(version) <= LLMCall.__table__.c.prompt_version.type.length, version
    longest_model = "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free-with-a-long-provider-suffix"
    longest = max(f"{longest_model}|reasoning-v1|{version}" for version in PROMPT_VERSIONS.values())
    assert len(longest) <= Evaluation.__table__.c.evaluator_version.type.length
