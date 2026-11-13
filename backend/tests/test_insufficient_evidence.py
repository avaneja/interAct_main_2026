import json

import pytest
from sqlalchemy import select

from app.core.llm import FakeLLM
from app.models import Base, Evaluation, User
from app.models.enums import AuthProvider, InputModel
from app.schemas import InterviewConfig, InterviewContext
from app.services import interview as svc
from app.services.evidence import non_answer_reason, shares_no_terms
from app.services.rubrics import REASONING

QUESTION = "Why can k-fold cross-validation give a more reliable estimate than a single train/test split?"


# Spotting answers that give nothing to grade


@pytest.mark.parametrize("answer", ["I don't know", "idk.", "Pass", "I’m not sure", "  No idea!  ", "two words"])
def test_non_answers_are_recognised(answer):
    assert non_answer_reason(answer)


@pytest.mark.parametrize("answer", [
    "Overfitting means memorising noise.",
    "It averages several splits, so the estimate varies less.",
])
def test_real_answers_are_not_non_answers(answer):
    assert non_answer_reason(answer) is None


def test_an_off_topic_answer_shares_no_terms_with_the_question():
    assert shares_no_terms("I like pizza and my favourite football team is Arsenal.", QUESTION)


def test_an_on_topic_answer_shares_terms_even_when_weak():
    assert not shares_no_terms("Cross-validation is a type of validation used in machine learning.", QUESTION)


# In an interview


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


class ScriptedEvaluations(FakeLLM):
    """Default questions and style checks; evaluations come from a script."""

    def __init__(self, *evaluations):
        super().__init__()
        self.evaluations = list(evaluations)

    def complete(self, request):
        if request.purpose == "evaluate_answer" and self.evaluations:
            self.queue(self.evaluations.pop(0))
        return super().complete(request)


def evaluation_reply(score_each=0, insufficient=False):
    return json.dumps({
        "criteria": [
            {"name": c.name, "score": min(score_each, c.max_score), "max_score": c.max_score, "reason": "r"}
            for c in REASONING.criteria
        ],
        "missing_concepts": ["variance"],
        "insufficient_evidence": insufficient,
    })


def answer_one(db, user, llm, text):
    session = svc.create_session(db, user, InputModel.TOPIC)
    svc.set_context(db, user, session.id, InterviewContext.model_validate(
        {"input_model": "TOPIC", "topic": "Machine learning", "subtopics": ["cross-validation"]}))
    svc.set_config(db, user, session.id, InterviewConfig.model_validate(
        {"question_type": "CONCEPTUAL", "difficulty": "intermediate", "question_count": 5}))
    svc.confirm_plan(db, user, session.id)
    question = svc.start(db, user, session.id, llm)
    result = svc.submit_answer(db, user, session.id, question.id, text, llm)
    return db.scalar(select(Evaluation)), result


def test_a_non_answer_scores_zero_without_asking_the_model(db, user):
    llm = FakeLLM()

    stored, result = answer_one(db, user, llm, "I don't know")

    assert "evaluate_answer" not in [r.purpose for r in llm.requests]
    assert stored.scores_json["score"] == 0
    assert stored.scores_json["max_score"] == REASONING.max_score
    assert stored.scores_json["insufficient_evidence"] is True
    assert stored.scores_json["insufficient_reason"] == "the candidate said they do not know"
    assert stored.evaluator_version == "rule|reasoning-v1|non-answer"
    assert result.next_question is not None  # The interview moves on.


def test_the_models_own_flag_is_kept_with_a_reason(db, user):
    stored, _ = answer_one(db, user, ScriptedEvaluations(evaluation_reply(0, insufficient=True)),
                           "Cross-validation is a type of validation used in machine learning.")

    assert stored.scores_json["insufficient_evidence"] is True
    assert "evaluator judged" in stored.scores_json["insufficient_reason"]


def test_an_off_topic_answer_the_model_scored_zero_is_flagged(db, user):
    # Llama 3.1 did exactly this in the live test: 0/10, but no flag.
    stored, _ = answer_one(db, user, ScriptedEvaluations(evaluation_reply(0)),
                           "I like pizza and my favourite football team is Arsenal.")

    assert stored.scores_json["insufficient_evidence"] is True
    assert stored.scores_json["insufficient_reason"] == "the answer does not address the question or its topic"


def test_an_on_topic_answer_scored_zero_is_a_confident_zero(db, user):
    stored, _ = answer_one(db, user, ScriptedEvaluations(evaluation_reply(0)),
                           "Cross-validation is a type of validation used in machine learning.")

    assert stored.scores_json["insufficient_evidence"] is False
    assert stored.scores_json["insufficient_reason"] is None


def test_a_correct_answer_in_other_words_is_not_flagged(db, user):
    stored, _ = answer_one(db, user, ScriptedEvaluations(evaluation_reply(2)),
                           "Rotating which rows are held out and averaging lowers the variance of the estimate.")

    assert stored.scores_json["insufficient_evidence"] is False
