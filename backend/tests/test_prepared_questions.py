"""The next planned question is written in the background while the candidate answers."""

import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.llm import FakeLLM, LLMError
from app.models import Base, InterviewSession, Question, User
from app.models.enums import AuthProvider, InputModel
from app.schemas import InterviewConfig, InterviewContext
from app.services import interview as svc

ANSWER = "A process is a running program with its own address space " * 3


@pytest.fixture
def db(db_engine, db_session):
    Base.metadata.create_all(db_engine)
    return db_session


@pytest.fixture
def user(db):
    user = User(auth_provider=AuthProvider.DEV, provider_user_id="tester")
    db.add(user)
    db.commit()
    return user


@pytest.fixture
def llm():
    return FakeLLM()


def started(db, user, llm, question_count=5):
    session = svc.create_session(db, user, InputModel.TOPIC)
    svc.set_context(db, user, session.id, InterviewContext.model_validate(
        {"input_model": "TOPIC", "topic": "Operating systems", "subtopics": ["processes", "memory"]}))
    svc.set_config(db, user, session.id, InterviewConfig.model_validate(
        {"question_type": "CONCEPTUAL", "difficulty": "beginner", "question_count": question_count}))
    svc.confirm_plan(db, user, session.id)
    return session, svc.start(db, user, session.id, llm)


def written(llm):
    return [r.purpose for r in llm.requests].count("generate_question")


def prepared(db, session):
    db.expire_all()
    return db.get(InterviewSession, session.id).prepared_json


def test_the_next_question_is_written_while_the_candidate_answers(db, user, llm):
    session, _ = started(db, user, llm)

    svc.prepare_next_question(db, session.id, llm)

    ahead = prepared(db, session)
    assert ahead["sequence"] == 2
    assert ahead["question"]["competency"] == "memory"
    assert db.scalar(select(func.count()).select_from(Question)) == 1  # Not asked yet.
    assert svc.current_question(db, user, session.id).sequence == 1


def test_moving_on_asks_the_prepared_question_without_writing_another(db, user, llm):
    session, first = started(db, user, llm)
    svc.prepare_next_question(db, session.id, llm)
    ahead = prepared(db, session)
    before = written(llm)

    result = svc.submit_answer(db, user, session.id, first.id, ANSWER, llm)

    assert written(llm) == before
    assert result.next_question.prompt == ahead["question"]["prompt"]
    assert result.next_question.lead_in == "Thank you, that is a clear answer. Let's move on."
    assert prepared(db, session) is None


def test_preparing_twice_writes_the_question_once(db, user, llm):
    session, _ = started(db, user, llm)
    svc.prepare_next_question(db, session.id, llm)
    before = written(llm)

    svc.prepare_next_question(db, session.id, llm)

    assert written(llm) == before


def test_nothing_is_prepared_after_the_last_question(db, user, llm):
    session, question = started(db, user, llm, question_count=5)
    for _ in range(4):
        question = svc.submit_answer(db, user, session.id, question.id, ANSWER, llm).next_question
    before = written(llm)

    svc.prepare_next_question(db, session.id, llm)

    assert written(llm) == before
    assert prepared(db, session) is None


def test_nothing_is_prepared_for_a_paused_interview(db, user, llm):
    session, _ = started(db, user, llm)
    svc.pause(db, user, session.id)

    svc.prepare_next_question(db, session.id, llm)

    assert prepared(db, session) is None


def test_a_failure_in_the_background_is_ignored_and_the_question_is_written_when_needed(db, user, llm):
    session, first = started(db, user, llm)
    llm.queue_for("generate_question", LLMError("down"), LLMError("down"))
    svc.prepare_next_question(db, session.id, llm)
    assert prepared(db, session) is None

    result = svc.submit_answer(db, user, session.id, first.id, ANSWER, llm)

    assert result.next_question.sequence == 2


def test_a_question_prepared_too_late_is_thrown_away(db, user, llm):
    session, first = started(db, user, llm)
    planned = svc._planned_asked(db, session.id)
    svc.submit_answer(db, user, session.id, first.id, ANSWER, llm)  # Moves on to question 2 meanwhile.

    # As if a background job that started before the answer finished now.
    original = svc._planned_asked
    calls = iter([planned])
    svc._planned_asked = lambda db_, session_id: next(calls, original(db_, session_id))
    try:
        svc.prepare_next_question(db, session.id, llm)
    finally:
        svc._planned_asked = original

    assert prepared(db, session) is None


def test_an_unusable_prepared_question_is_ignored(db, user, llm):
    session, first = started(db, user, llm)
    row = db.get(InterviewSession, session.id)
    row.prepared_json = {"sequence": 2, "question": {"prompt": "half a question"}}
    db.commit()

    result = svc.submit_answer(db, user, session.id, first.id, ANSWER, llm)

    assert result.next_question.sequence == 2
    assert result.next_question.prompt != "half a question"


def test_the_api_prepares_the_next_question_after_responding(client, db_engine):
    session_id = client.post("/api/v1/sessions", json={"input_model": "TOPIC"}).json()["id"]
    client.put(f"/api/v1/sessions/{session_id}/context",
               json={"input_model": "TOPIC", "topic": "Operating systems", "subtopics": ["processes", "memory"]})
    client.put(f"/api/v1/sessions/{session_id}/config",
               json={"question_type": "DIRECT", "difficulty": "beginner", "question_count": 5})
    client.post(f"/api/v1/sessions/{session_id}/confirm")

    client.post(f"/api/v1/sessions/{session_id}/start")

    with Session(db_engine) as other:
        assert other.get(InterviewSession, uuid.UUID(session_id)).prepared_json["sequence"] == 2
    view = client.get(f"/api/v1/sessions/{session_id}").json()
    assert "prepared" not in str(view)  # The client never sees it.
