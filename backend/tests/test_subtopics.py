"""Concrete areas for a topic the candidate left open, such as "All DSA topics"."""

import json

import pytest

from app.core.llm import FakeLLM, LLMError
from app.models import Base, User
from app.models.enums import AuthProvider, InputModel
from app.schemas import InterviewContext
from app.services import interview as svc


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


def context(subtopics, topic="DSA"):
    return InterviewContext.model_validate(
        {"input_model": "TOPIC", "topic": topic, "level": "intermediate", "subtopics": subtopics})


def saved(db, user, llm, subtopics, topic="DSA"):
    session = svc.create_session(db, user, InputModel.TOPIC)
    return svc.set_context(db, user, session.id, context(subtopics, topic), llm).context_json["subtopics"]


@pytest.mark.parametrize("subtopics", [[], ["All DSA topics"], ["everything"], ["the basics"], ["DSA"],
                                       ["general questions", "any topic"]])
def test_missing_or_vague_subtopics_need_concrete_ones(subtopics):
    assert svc.needs_subtopics(context(subtopics))


@pytest.mark.parametrize("subtopics", [["hash maps"], ["All DSA topics", "binary trees"], ["dynamic programming"]])
def test_any_concrete_subtopic_is_enough(subtopics):
    assert not svc.needs_subtopics(context(subtopics))


def test_vague_subtopics_are_replaced_by_the_models_suggestions(db, user):
    llm = FakeLLM()
    llm.queue_for("suggest_subtopics", json.dumps(
        {"subtopics": ["arrays and hashing", "binary trees", "graph traversal", "dynamic programming"]}))

    subtopics = saved(db, user, llm, ["All DSA topics"])

    assert subtopics == ["arrays and hashing", "binary trees", "graph traversal", "dynamic programming"]
    request = next(r for r in llm.requests if r.purpose == "suggest_subtopics")
    assert "What the candidate wrote as the focus: All DSA topics" in request.user
    assert "Candidate's level: intermediate" in request.user


def test_concrete_subtopics_are_kept_without_asking_the_model(db, user):
    llm = FakeLLM()

    assert saved(db, user, llm, ["hash maps", "tries"]) == ["hash maps", "tries"]
    assert llm.requests == []


def test_a_model_failure_keeps_what_the_candidate_wrote(db, user):
    llm = FakeLLM()
    llm.queue_for("suggest_subtopics", LLMError("down"), LLMError("down"))

    assert saved(db, user, llm, ["All DSA topics"]) == ["All DSA topics"]


@pytest.mark.parametrize("reply", [
    {"subtopics": ["one", "two"]},                    # Too few.
    {"subtopics": ["a", "b", "c", "d", "e", "f", "g"]},  # Too many.
    {"subtopics": ["trees", "Trees", "graphs"]},     # Repeated.
])
def test_unusable_suggestions_are_retried(db, user, reply):
    llm = FakeLLM()
    llm.queue_for("suggest_subtopics", json.dumps(reply))

    subtopics = saved(db, user, llm, [])

    assert subtopics == ["DSA fundamentals", "DSA in practice", "common DSA pitfalls", "DSA trade-offs"]


def test_the_plan_shows_the_suggested_areas(client, fake_llm):
    fake_llm.queue_for("suggest_subtopics", json.dumps({"subtopics": ["hash maps", "binary trees", "graphs"]}))
    session_id = client.post("/api/v1/sessions", json={"input_model": "TOPIC"}).json()["id"]

    client.put(f"/api/v1/sessions/{session_id}/context",
               json={"input_model": "TOPIC", "topic": "DSA", "subtopics": ["All DSA topics"]})
    plan = client.put(f"/api/v1/sessions/{session_id}/config",
                      json={"question_type": "DIRECT", "difficulty": "intermediate", "question_count": 5}).json()["plan"]

    assert [p["competency"] for p in plan] == ["hash maps", "binary trees", "graphs", "hash maps", "binary trees"]
