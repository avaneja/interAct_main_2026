import json

import pytest
from sqlalchemy import select

from app.core.llm import FakeLLM
from app.models import Base, Evaluation, LLMCall, User
from app.models.enums import AuthProvider, InputModel, ValidationStatus
from app.schemas import AnswerEvaluation, InterviewConfig, InterviewContext
from app.services import interview as svc
from app.services.evidence import quote_in_answer, verify_evidence
from app.services.rubrics import RECALL

ANSWER = (
    "Overfitting happens when a model memorises the noise in its training data. "
    "It then scores well on training data but badly on new data, so you need a held-out test set."
)


# Finding quotes in the answer


@pytest.mark.parametrize("quote", [
    "memorises the noise in its training data",
    "MEMORISES   the noise",
    "“memorises the noise”",
    "'scores well on training data,'",
    "Overfitting happens ... a held-out test set",
    "scores well on training data…badly on new data",
])
def test_quotes_from_the_answer_are_found(quote):
    assert quote_in_answer(quote, ANSWER)


@pytest.mark.parametrize("quote", [
    "the model fails to generalise",          # A paraphrase, not the candidate's words.
    "a held-out test set ... Overfitting happens",  # Pieces out of order.
    "memorizes the noise",                    # A different spelling is not a quote.
    "...",
    "",
])
def test_words_the_candidate_never_wrote_are_not_found(quote):
    assert not quote_in_answer(quote, ANSWER)


def evaluation(correctness_quote, completeness_quote):
    return AnswerEvaluation.model_validate({"criteria": [
        {"name": "correctness", "score": 3, "max_score": 3, "evidence_quote": correctness_quote, "reason": "Accurate."},
        {"name": "completeness", "score": 1, "max_score": 2, "evidence_quote": completeness_quote, "reason": "Partial."},
    ]})


def test_verify_evidence_keeps_real_quotes_and_removes_invented_ones():
    result = verify_evidence(evaluation("memorises the noise", "uses cross-validation to tune"), ANSWER)

    quotes = [c.evidence_quote for c in result.evaluation.criteria]
    assert quotes == ["memorises the noise", None]
    assert result.verified == 1
    assert result.removed == ["uses cross-validation to tune"]
    assert result.evaluation.score == 4  # Scores are untouched.


def test_criteria_without_a_quote_are_left_alone():
    result = verify_evidence(evaluation(None, None), ANSWER)

    assert (result.verified, result.removed) == (0, [])


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


def answer_direct_question(db, user, llm, text=ANSWER):
    session = svc.create_session(db, user, InputModel.TOPIC)
    svc.set_context(db, user, session.id, InterviewContext.model_validate(
        {"input_model": "TOPIC", "topic": "Machine learning", "subtopics": ["overfitting"]}))
    svc.set_config(db, user, session.id, InterviewConfig.model_validate(
        {"question_type": "DIRECT", "difficulty": "beginner", "question_count": 5}))
    svc.confirm_plan(db, user, session.id)
    question = svc.start(db, user, session.id, llm)
    svc.submit_answer(db, user, session.id, question.id, text, llm)
    return db.scalar(select(Evaluation))


def recall_reply(correctness, completeness, quote=None, correctness_max=3):
    return json.dumps({"criteria": [
        {"name": "correctness", "score": correctness, "max_score": correctness_max,
         "evidence_quote": quote, "reason": "r"},
        {"name": "completeness", "score": completeness, "max_score": 2, "reason": "r"},
    ]})


class EvaluationScript(FakeLLM):
    """Answers questions and style checks by default; evaluations come from a script."""

    def __init__(self, *evaluations):
        super().__init__()
        self.evaluations = list(evaluations)

    def complete(self, request):
        if request.purpose == "evaluate_answer" and self.evaluations:
            self.queue(self.evaluations.pop(0))
        return super().complete(request)


def test_an_invented_quote_is_not_stored_but_the_raw_reply_keeps_it(db, user):
    invented = recall_reply(3, 2, quote="the candidate said regularisation fixes everything")

    stored = answer_direct_question(db, user, EvaluationScript(invented))

    assert stored.evidence_json[0]["evidence_quote"] is None
    assert stored.scores_json["evidence"] == {"quotes_verified": 0, "quotes_removed": 1}
    raw = db.scalar(select(LLMCall).where(LLMCall.purpose == "evaluate_answer"))
    assert "regularisation fixes everything" in raw.raw_output


def test_a_real_quote_is_kept_and_counted(db, user):
    stored = answer_direct_question(db, user, EvaluationScript(recall_reply(3, 2, quote="memorises the noise")))

    assert stored.evidence_json[0]["evidence_quote"] == "memorises the noise"
    assert stored.scores_json["evidence"] == {"quotes_verified": 1, "quotes_removed": 0}


@pytest.mark.parametrize("bad_reply", [
    recall_reply(4, 2),                       # Above the criterion's own maximum.
    recall_reply(5, 2, correctness_max=5),    # Claims a bigger maximum than the rubric's 3.
    recall_reply(-1, 2),                      # Negative.
])
def test_scores_outside_the_rubric_are_rejected_and_regraded(db, user, bad_reply):
    llm = EvaluationScript(bad_reply)

    stored = answer_direct_question(db, user, llm)

    statuses = [
        call.validation_status
        for call in db.scalars(select(LLMCall).where(LLMCall.purpose == "evaluate_answer").order_by(LLMCall.created_at))
    ]
    assert statuses == [ValidationStatus.INVALID, ValidationStatus.VALID]
    assert stored.scores_json["max_score"] == RECALL.max_score
    for criterion, rubric_criterion in zip(stored.evidence_json, RECALL.criteria):
        assert 0 <= criterion["score"] <= rubric_criterion.max_score
