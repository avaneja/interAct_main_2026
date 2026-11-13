"""End-to-end tests of the sessions API: M1's "done when" criteria."""

import uuid

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.llm import LLMError
from app.models import Answer, Evaluation, Question
from app.services.rubrics import REASONING

ANSWER = "A detailed answer about the topic " * 7

CONTEXT = {"input_model": "TOPIC", "topic": "Operating systems",
           "goal": "Software engineering internship", "level": "intermediate",
           "subtopics": ["processes", "memory", "scheduling"]}
CONFIG = {"question_type": "SCENARIO_BASED", "difficulty": "intermediate", "question_count": 5}


def url(session_id, action=""):
    return f"/api/v1/sessions/{session_id}" + (f"/{action}" if action else "")


def new_session(client):
    response = client.post("/api/v1/sessions", json={"input_model": "TOPIC"})
    assert response.status_code == 201
    return response.json()["id"]


def ready_session(client):
    session_id = new_session(client)
    assert client.put(url(session_id, "context"), json=CONTEXT).status_code == 200
    assert client.put(url(session_id, "config"), json=CONFIG).status_code == 200
    assert client.post(url(session_id, "confirm")).status_code == 200
    return session_id


def started_session(client):
    session_id = ready_session(client)
    response = client.post(url(session_id, "start"))
    assert response.status_code == 200
    return session_id, response.json()


def answer(client, session_id, question_id, text=ANSWER):
    return client.post(url(session_id, "answers"), json={"question_id": question_id, "text": text})


def count(db_engine, model):
    with Session(db_engine) as db:
        return db.scalar(select(func.count()).select_from(model))


def test_a_full_interview_runs_through_the_api(client):
    session_id = new_session(client)
    assert client.get(url(session_id)).json()["state"] == "PREPARING"

    assert client.put(url(session_id, "context"), json=CONTEXT).json()["state"] == "CONFIGURING"
    assert client.put(url(session_id, "config"), json=CONFIG).json()["config"]["question_count"] == 5
    assert client.post(url(session_id, "confirm")).json()["state"] == "READY"

    question = client.post(url(session_id, "start")).json()
    assert question["sequence"] == 1
    assert question["type"] == "SCENARIO_BASED"
    assert client.get(url(session_id, "current-question")).json()["id"] == question["id"]

    for sequence in range(1, 6):
        result = answer(client, session_id, question["id"]).json()
        if sequence < 5:
            assert result == {"state": "IN_PROGRESS", "completed": False, "next_question": result["next_question"]}
            question = result["next_question"]
            assert question["sequence"] == sequence + 1

    assert result["completed"] is True
    assert result["state"] == "COMPLETED"
    assert result["next_question"] is None

    report = client.get(url(session_id, "report"))
    assert report.status_code == 200
    summary = report.json()["summary"]
    assert summary["answered_questions"] == 5
    assert summary["score"] == summary["max_score"] == 5 * REASONING.max_score
    assert [q["sequence"] for q in summary["questions"]] == [1, 2, 3, 4, 5]

    detail = client.get(url(session_id)).json()
    assert detail["questions_asked"] == detail["questions_answered"] == 5

    history = client.get("/api/v1/sessions").json()
    assert [s["id"] for s in history] == [session_id]


def test_history_lists_newest_first(client):
    first = new_session(client)
    second = new_session(client)

    assert [s["id"] for s in client.get("/api/v1/sessions").json()] == [second, first]


def test_pause_and_resume_keep_the_same_question(client):
    session_id, question = started_session(client)

    assert client.post(url(session_id, "pause")).json()["state"] == "PAUSED"
    assert answer(client, session_id, question["id"]).status_code == 409
    assert client.get(url(session_id, "current-question")).json()["id"] == question["id"]

    assert client.post(url(session_id, "resume")).json()["state"] == "IN_PROGRESS"
    assert answer(client, session_id, question["id"]).status_code == 200


def test_finishing_early_produces_a_report(client):
    session_id, question = started_session(client)
    answer(client, session_id, question["id"])

    assert client.post(url(session_id, "finish")).json()["state"] == "COMPLETED"

    summary = client.get(url(session_id, "report")).json()["summary"]
    assert summary["ended_early"] is True
    assert summary["answered_questions"] == 1


# Invalid transitions


@pytest.mark.parametrize("action", ["start", "pause", "resume", "finish", "confirm"])
def test_actions_out_of_order_are_rejected_with_409(client, action):
    session_id = new_session(client)

    response = client.post(url(session_id, action))

    assert response.status_code == 409
    assert response.json()["detail"]


def test_config_before_context_is_rejected(client):
    session_id = new_session(client)

    response = client.put(url(session_id, "config"), json=CONFIG)

    assert response.status_code == 409
    assert "context first" in response.json()["detail"]


def test_start_before_confirming_is_rejected_and_calls_no_model(client, fake_llm):
    session_id = new_session(client)
    client.put(url(session_id, "context"), json=CONTEXT)
    client.put(url(session_id, "config"), json=CONFIG)

    response = client.post(url(session_id, "start"))

    assert response.status_code == 409
    assert "Allowed: PLAN_CONFIRMED" in response.json()["detail"]
    assert fake_llm.requests == []


def test_starting_twice_is_rejected(client):
    session_id, _ = started_session(client)

    assert client.post(url(session_id, "start")).status_code == 409


def test_a_completed_interview_accepts_no_more_actions(client):
    session_id, _ = started_session(client)
    client.post(url(session_id, "finish"))

    for action in ("finish", "pause", "resume", "start"):
        assert client.post(url(session_id, action)).status_code == 409
    assert client.put(url(session_id, "context"), json=CONTEXT).status_code == 409


def test_the_report_is_not_available_before_completion(client):
    session_id, _ = started_session(client)

    assert client.get(url(session_id, "report")).status_code == 409


# Duplicate answers


def test_submitting_the_same_answer_twice_returns_the_same_result(client, db_engine):
    session_id, question = started_session(client)

    first = answer(client, session_id, question["id"])
    second = answer(client, session_id, question["id"])

    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert count(db_engine, Answer) == 1
    assert count(db_engine, Evaluation) == 1
    assert count(db_engine, Question) == 2


def test_changing_an_answer_after_submitting_is_rejected(client, db_engine):
    session_id, question = started_session(client)
    answer(client, session_id, question["id"])

    response = answer(client, session_id, question["id"], text="Actually, something else.")

    assert response.status_code == 409
    assert count(db_engine, Answer) == 1


def test_answering_a_question_from_another_session_is_rejected(client):
    first_session, first_question = started_session(client)
    second_session, _ = started_session(client)

    response = answer(client, second_session, first_question["id"])

    assert response.status_code == 404


# Model failures


def test_a_failed_evaluation_returns_503_and_can_be_retried(client, fake_llm, db_engine):
    session_id, question = started_session(client)
    fake_llm.queue(LLMError("down"), LLMError("down"))

    failed = answer(client, session_id, question["id"])
    assert failed.status_code == 503
    assert "Nothing was scored" in failed.json()["detail"]
    assert client.get(url(session_id)).json()["state"] == "EVALUATING"
    assert count(db_engine, Evaluation) == 0

    retried = answer(client, session_id, question["id"])
    assert retried.status_code == 200
    assert retried.json()["next_question"]["sequence"] == 2
    assert count(db_engine, Evaluation) == 1


# What the client can and cannot see


def test_answer_results_and_questions_contain_no_scores_or_answer_keys(client):
    session_id, question = started_session(client)

    result = answer(client, session_id, question["id"]).json()
    current = client.get(url(session_id, "current-question")).json()

    for body in (question, result, current):
        text = str(body)
        assert "score" not in text
        assert "answer_key" not in text
        assert "supporting_quote" not in text


def test_no_current_question_before_the_interview_starts(client):
    session_id = ready_session(client)

    response = client.get(url(session_id, "current-question"))

    assert response.status_code == 404


# Input validation


def test_an_unknown_session_is_404(client):
    assert client.get(url(uuid.uuid4())).status_code == 404


def test_a_malformed_session_id_is_422(client):
    assert client.get(url("not-a-uuid")).status_code == 422


@pytest.mark.parametrize("body", [
    {**CONFIG, "question_count": 7},
    {**CONFIG, "question_type": "TRICK"},
    {**CONFIG, "surprise": True},
])
def test_invalid_config_is_rejected_with_422(client, body):
    session_id = new_session(client)
    client.put(url(session_id, "context"), json=CONTEXT)

    assert client.put(url(session_id, "config"), json=body).status_code == 422


def test_a_blank_answer_is_rejected_with_422(client):
    session_id, question = started_session(client)

    assert answer(client, session_id, question["id"], text="   ").status_code == 422


def test_a_document_context_on_a_topic_session_is_422(client):
    session_id = new_session(client)
    body = {"input_model": "DOCUMENT", "topic": "Notes", "document_id": str(uuid.uuid4())}

    response = client.put(url(session_id, "context"), json=body)

    assert response.status_code == 422
    assert "TOPIC interview" in response.json()["detail"]
