"""The warm-up and the closing: talk around the questions that is never scored."""

import json

import pytest

from app.core.llm import FakeLLM, LLMError
from app.models import Base, Evaluation, User
from app.models.enums import AuthProvider, InputModel
from app.schemas import InterviewConfig, InterviewContext
from app.services import interview as svc
from app.services import prompts

ANSWER = "A process is a running program with its own address space " * 3


@pytest.fixture
def db(db_engine, db_session):
    Base.metadata.create_all(db_engine)
    return db_session


@pytest.fixture
def user(db):
    user = User(auth_provider=AuthProvider.GOOGLE, provider_user_id="1", display_name="Ada Lovelace")
    db.add(user)
    db.commit()
    return user


@pytest.fixture
def llm():
    return FakeLLM()


def started(db, user, llm):
    session = svc.create_session(db, user, InputModel.TOPIC)
    svc.set_context(db, user, session.id, InterviewContext.model_validate(
        {"input_model": "TOPIC", "topic": "Operating systems", "subtopics": ["processes"]}))
    svc.set_config(db, user, session.id, InterviewConfig.model_validate(
        {"question_type": "DIRECT", "difficulty": "beginner", "question_count": 5}))
    svc.confirm_plan(db, user, session.id)
    return session, svc.start(db, user, session.id, llm)


def wrapped_up(db, user, llm):
    session, question = started(db, user, llm)
    for _ in range(5):
        question = svc.submit_answer(db, user, session.id, question.id, ANSWER, llm).next_question
    return session


# Warm-up


def test_the_warm_up_reply_picks_up_the_introduction(db, user, llm):
    session, _ = started(db, user, llm)
    llm.queue_for("warm_up", json.dumps({"reply": "Brown and data science, nice. Let's get into the questions."}))

    reply = svc.chat(db, user, session.id, "warm_up", "I studied at Brown and love data science.", llm)

    assert reply == svc.ChatReply("Brown and data science, nice. Let's get into the questions.", done=True)
    request = llm.requests[-1]
    assert "Candidate: I studied at Brown and love data science." in request.user
    assert "Candidate's first name: Ada" in request.user


def test_the_warm_up_is_never_scored(db, user, llm):
    session, _ = started(db, user, llm)

    svc.chat(db, user, session.id, "warm_up", "I like operating systems.", llm)
    svc.finish(db, user, session.id, llm)

    assert db.query(Evaluation).count() == 0


def test_the_warm_up_asks_nothing_because_the_questions_come_next(db, user, llm):
    session, _ = started(db, user, llm)
    llm.queue_for("warm_up", json.dumps(
        {"reply": "So you study engineering, great. What draws you to backend roles?"}))

    reply = svc.chat(db, user, session.id, "warm_up", "I study engineering.", llm)

    assert reply.reply == "So you study engineering, great. Let's get into the questions."


def test_a_warm_up_that_is_only_a_question_falls_back(db, user, llm):
    session, _ = started(db, user, llm)
    llm.queue_for("warm_up", json.dumps({"reply": "Why backend?"}))

    assert svc.chat(db, user, session.id, "warm_up", "I study engineering.", llm).reply == svc.WARM_UP_FALLBACK


def test_the_development_test_user_is_not_called_by_name(db, llm):
    tester = User(auth_provider=AuthProvider.DEV, provider_user_id="local-dev", display_name="Local test user")
    db.add(tester)
    db.commit()
    session, _ = started(db, tester, llm)

    svc.chat(db, tester, session.id, "warm_up", "Hello.", llm)

    assert "Candidate's first name: not given" in llm.requests[-1].user


def test_a_failed_warm_up_reply_falls_back_to_a_plain_line(db, user, llm):
    session, _ = started(db, user, llm)
    llm.queue_for("warm_up", LLMError("down"), LLMError("down"))

    assert svc.chat(db, user, session.id, "warm_up", "Hi!", llm) == svc.ChatReply(svc.WARM_UP_FALLBACK, done=True)


def test_the_warm_up_needs_a_running_interview(db, user, llm):
    session, _ = started(db, user, llm)
    svc.pause(db, user, session.id)

    with pytest.raises(svc.Conflict):
        svc.chat(db, user, session.id, "warm_up", "Hi!", llm)


# Closing


def test_questions_for_the_interviewer_come_after_the_last_question(db, user, llm):
    session, _ = started(db, user, llm)

    with pytest.raises(svc.Conflict, match="after the last question"):
        svc.chat(db, user, session.id, "closing", "What is the salary?", llm)


def test_the_interviewer_answers_and_asks_for_more_questions(db, user, llm):
    session = wrapped_up(db, user, llm)

    reply = svc.chat(db, user, session.id, "closing", "What should I revise first?", llm)

    assert reply.done is False
    assert "Candidate: What should I revise first?" in llm.requests[-1].user


def test_an_open_closing_reply_always_invites_more_questions(db, user, llm):
    session = wrapped_up(db, user, llm)
    llm.queue_for("closing", json.dumps({"reply": "Start with hash maps.", "done": False}))

    reply = svc.chat(db, user, session.id, "closing", "What should I revise first?", llm)

    assert reply.reply == "Start with hash maps. Do you have any other questions?"


@pytest.mark.parametrize("text", ["No, that's all.", "Nope", "No questions, thank you", "Thanks!", "Goodbye"])
def test_having_no_more_questions_ends_the_closing(db, user, llm, text):
    session = wrapped_up(db, user, llm)
    llm.queue_for("closing", json.dumps({"reply": "Thanks for your time, Ada. Goodbye.", "done": False}))

    assert svc.chat(db, user, session.id, "closing", text, llm).done is True


def test_a_failed_closing_reply_falls_back_without_ending_the_call(db, user, llm):
    session = wrapped_up(db, user, llm)
    llm.queue_for("closing", LLMError("down"), LLMError("down"), LLMError("down"), LLMError("down"))

    assert svc.chat(db, user, session.id, "closing", "How did I do?", llm) == svc.ChatReply(svc.CLOSING_FALLBACK, done=False)
    assert svc.chat(db, user, session.id, "closing", "No, that's all.", llm) == svc.ChatReply(
        "Thanks for your time, Ada. Goodbye.", done=True)


def test_the_interviewer_never_invents_jobs_salaries_or_scores():
    system = prompts.closing_request(topic="DSA", candidate_name="Ada", question="What's the salary?").system

    assert "not a real job" in system
    assert "Never invent facts about a company, salary or hiring outcome, and never reveal scores" in system


def test_the_closing_is_not_available_once_finished(db, user, llm):
    session = wrapped_up(db, user, llm)
    svc.finish(db, user, session.id, llm)

    with pytest.raises(svc.Conflict):
        svc.chat(db, user, session.id, "closing", "One more thing?", llm)


def test_the_chat_api_validates_the_stage(client):
    session_id = client.post("/api/v1/sessions", json={"input_model": "TOPIC"}).json()["id"]

    response = client.post(f"/api/v1/sessions/{session_id}/chat", json={"stage": "gossip", "text": "hi"})

    assert response.status_code == 422
