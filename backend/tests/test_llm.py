import json

import pytest

from app.core.llm import FakeLLM, LLMError, LLMRequest, get_llm
from app.schemas import AnswerEvaluation, GeneratedQuestion

CRITERIA = [{"name": "correctness", "max_score": 3}, {"name": "completeness", "max_score": 2}]


def question_request(**hints):
    return LLMRequest(
        purpose="generate_question",
        system="system prompt",
        user="user prompt",
        hints={"question_type": "CONCEPTUAL", "competency": "overfitting",
               "difficulty": "beginner", "sequence": 1, "topic": "ML", **hints},
    )


def evaluation_request(answer):
    return LLMRequest(
        purpose="evaluate_answer",
        system="system prompt",
        user="user prompt",
        hints={"answer": answer, "criteria": CRITERIA, "competency": "overfitting"},
    )


def test_default_question_reply_is_a_valid_generated_question():
    reply = FakeLLM().complete(question_request(question_type="SCENARIO_BASED"))
    question = GeneratedQuestion.model_validate_json(reply.text)

    assert question.type == "SCENARIO_BASED"
    assert question.competency == "overfitting"
    assert reply.model == "fake-llm"


@pytest.mark.parametrize("answer, expected", [("", 0), ("word " * 20, 3), ("word " * 40, 5)])
def test_default_evaluation_is_valid_and_scales_with_answer_length(answer, expected):
    reply = FakeLLM().complete(evaluation_request(answer))
    evaluation = AnswerEvaluation.model_validate_json(reply.text)

    assert evaluation.score == expected
    assert evaluation.max_score == 5
    assert evaluation.insufficient_evidence is (answer == "")


def test_queued_replies_come_first_then_defaults_resume():
    llm = FakeLLM("not json")
    llm.queue(json.dumps({"hello": "world"}))

    assert llm.complete(question_request()).text == "not json"
    assert llm.complete(question_request()).text == '{"hello": "world"}'
    GeneratedQuestion.model_validate_json(llm.complete(question_request()).text)


def test_a_queued_exception_is_raised():
    llm = FakeLLM(LLMError("provider timed out"))

    with pytest.raises(LLMError, match="timed out"):
        llm.complete(question_request())


def test_every_request_is_recorded():
    llm = FakeLLM()
    llm.complete(question_request())
    llm.complete(evaluation_request("an answer"))

    assert [r.purpose for r in llm.requests] == ["generate_question", "evaluate_answer"]


def test_unknown_purpose_raises_instead_of_inventing_a_reply():
    with pytest.raises(LLMError, match="no default reply"):
        FakeLLM().complete(LLMRequest(purpose="summarise", system="", user=""))


def test_get_llm_returns_the_fake_by_default():
    assert isinstance(get_llm(), FakeLLM)
