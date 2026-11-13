import json

import pytest
from sqlalchemy import select

from app.core.config import get_settings
from app.core.llm import FAKE_QUESTIONS, FakeLLM, LLMError
from app.models import Base, Question, User
from app.models.enums import AuthProvider, InputModel, QuestionType, StyleStatus
from app.schemas import InterviewConfig, InterviewContext
from app.services import interview as svc
from app.services.question_styles import STYLES, style_rule_problem

Q = QuestionType


# The rule check


@pytest.mark.parametrize("question_type", list(STYLES))
def test_the_readme_example_of_each_style_passes(question_type):
    assert style_rule_problem(question_type, STYLES[question_type].example) is None


@pytest.mark.parametrize("question_type", list(STYLES))
def test_the_fake_questions_pass_their_own_style(question_type):
    prompt = FAKE_QUESTIONS[question_type.value].format(n=1, competency="indexes", topic="databases")

    assert style_rule_problem(question_type, prompt) is None


@pytest.mark.parametrize("question_type, prompt, problem", [
    # Seen from Llama 3.1 in the M2 task 3 live test, labelled CONCEPTUAL.
    (Q.CONCEPTUAL, "What is the main advantage of using stratified cross-validation over simple "
                   "cross-validation when evaluating a model on imbalanced classes?", "why or how"),
    (Q.DIRECT, " ".join(["word"] * 45) + "?", "too long"),
    (Q.DIRECT, "Your model scores 98% on training data. What do you do?", "case or scenario"),
    (Q.CASE_BASED, "What is a confusion matrix?", "no concrete case"),
    (Q.SCENARIO_BASED, "A model drifts after a pipeline change. What causes drift?", "situation"),
    (Q.SCENARIO_BASED, "You are a data scientist on a fraud team.", "would do"),
    (Q.APPLICATION, "What is the difference between precision and recall?", "design, plan or method"),
])
def test_clear_style_misses_are_caught(question_type, prompt, problem):
    assert problem in style_rule_problem(question_type, prompt)


# Regenerating and flagging in the interview service


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
def style_check(monkeypatch):
    def set_mode(mode):
        monkeypatch.setenv("STYLE_CHECK", mode)
        get_settings.cache_clear()

    yield set_mode
    get_settings.cache_clear()


def ready_session(db, user, question_type="CONCEPTUAL"):
    session = svc.create_session(db, user, InputModel.TOPIC)
    svc.set_context(db, user, session.id, InterviewContext.model_validate(
        {"input_model": "TOPIC", "topic": "Machine learning", "subtopics": ["overfitting"]}))
    svc.set_config(db, user, session.id, InterviewConfig.model_validate(
        {"question_type": question_type, "difficulty": "intermediate", "question_count": 5}))
    svc.confirm_plan(db, user, session.id)
    return session


def question_reply(prompt, question_type="CONCEPTUAL"):
    return json.dumps({"type": question_type, "competency": "overfitting",
                       "difficulty": "intermediate", "prompt": prompt})


OFF_STYLE = question_reply("What is overfitting?")  # No why or how: not conceptual.


def purposes(llm):
    return [request.purpose for request in llm.requests]


def test_a_question_in_the_right_style_passes(db, user):
    llm = FakeLLM()

    question = svc.start(db, user, ready_session(db, user).id, llm)

    assert question.style_status is StyleStatus.PASSED
    assert question.style_note is None
    assert purposes(llm) == ["generate_question", "classify_style"]


def test_an_off_style_question_is_regenerated(db, user):
    llm = FakeLLM(OFF_STYLE)

    question = svc.start(db, user, ready_session(db, user).id, llm)

    assert question.style_status is StyleStatus.PASSED
    assert question.prompt.startswith("Question 1: Why")
    assert purposes(llm) == ["generate_question", "generate_question", "classify_style"]


def test_a_question_still_off_style_is_kept_and_flagged(db, user):
    llm = FakeLLM(OFF_STYLE, OFF_STYLE)
    session = ready_session(db, user)

    question = svc.start(db, user, session.id, llm)

    assert question.prompt == "What is overfitting?"
    assert question.style_status is StyleStatus.FLAGGED
    assert "why or how" in question.style_note
    assert svc.current_question(db, user, session.id).id == question.id


def test_the_llm_check_catches_what_the_rules_miss(db, user):
    disagree = json.dumps({"style": "DIRECT", "reason": "It only asks for a definition."})
    llm = FakeLLM()
    llm.queue(question_reply("Why is overfitting a problem?"), disagree)

    question = svc.start(db, user, ready_session(db, user).id, llm)

    assert question.style_status is StyleStatus.PASSED
    assert purposes(llm) == ["generate_question", "classify_style", "generate_question", "classify_style"]


def test_a_failed_llm_check_does_not_block_the_interview(db, user):
    llm = FakeLLM()
    llm.queue(question_reply("Why is overfitting a problem?"), LLMError("down"), LLMError("down"))

    question = svc.start(db, user, ready_session(db, user).id, llm)

    assert question.style_status is StyleStatus.PASSED


def test_rules_only_mode_makes_no_extra_llm_call(db, user, style_check):
    style_check("rules")
    llm = FakeLLM()

    question = svc.start(db, user, ready_session(db, user).id, llm)

    assert question.style_status is StyleStatus.PASSED
    assert purposes(llm) == ["generate_question"]


def test_a_mixed_interview_checks_every_style(db, user):
    llm = FakeLLM()
    session = ready_session(db, user, question_type="MIXED")
    question = svc.start(db, user, session.id, llm)
    for _ in range(4):
        result = svc.submit_answer(db, user, session.id, question.id, "An answer " * 25, llm)
        question = result.next_question

    rows = list(db.scalars(select(Question).order_by(Question.sequence)))
    assert [row.style_status for row in rows] == [StyleStatus.PASSED] * 5
    assert purposes(llm).count("generate_question") == 5
