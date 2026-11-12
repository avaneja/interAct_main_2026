import uuid

import pytest
from pydantic import ValidationError

from app.models.enums import Difficulty, GroundingStatus, InputModel, QuestionType
from app.schemas import (
    AnswerEvaluation,
    GeneratedQuestion,
    InterviewConfig,
    InterviewContext,
    QuestionView,
)


def topic_context(**overrides):
    data = {
        "input_model": "TOPIC",
        "topic": "Machine learning model evaluation",
        "goal": "ML internship practice",
        "level": "intermediate",
        "subtopics": ["cross-validation", "overfitting"],
    }
    return {**data, **overrides}


def evaluation(**overrides):
    data = {
        "score": 3,
        "max_score": 5,
        "criteria": [
            {"name": "metric selection", "score": 2, "max_score": 3,
             "evidence_quote": "I would examine recall and precision",
             "reason": "Relevant metrics, but no trade-offs."},
            {"name": "explanation", "score": 1, "max_score": 2,
             "reason": "Brief justification."},
        ],
        "missing_concepts": ["precision-recall trade-off"],
    }
    return {**data, **overrides}


# InterviewContext


def test_topic_context_from_the_readme_example_is_valid():
    context = InterviewContext.model_validate(topic_context())

    assert context.input_model is InputModel.TOPIC
    assert context.level is Difficulty.INTERMEDIATE


def test_context_trims_whitespace_and_rejects_blank_topic():
    assert InterviewContext.model_validate(topic_context(topic="  Databases  ")).topic == "Databases"

    with pytest.raises(ValidationError):
        InterviewContext.model_validate(topic_context(topic="   "))


def test_document_context_needs_a_document():
    with pytest.raises(ValidationError, match="needs a document_id"):
        InterviewContext.model_validate(topic_context(input_model="DOCUMENT"))

    context = InterviewContext.model_validate(
        topic_context(input_model="DOCUMENT", document_id=str(uuid.uuid4()))
    )
    assert context.document_id is not None


def test_topic_context_cannot_reference_a_document():
    with pytest.raises(ValidationError, match="cannot reference a document"):
        InterviewContext.model_validate(topic_context(document_id=str(uuid.uuid4())))


def test_duplicate_subtopics_are_rejected_ignoring_case():
    with pytest.raises(ValidationError, match="duplicates"):
        InterviewContext.model_validate(topic_context(subtopics=["Overfitting", "overfitting"]))


def test_context_rejects_misspelled_fields():
    with pytest.raises(ValidationError):
        InterviewContext.model_validate(topic_context(subtopic=["typo"]))


# InterviewConfig


def test_config_from_the_readme_example_is_valid():
    config = InterviewConfig.model_validate(
        {"question_type": "CASE_BASED", "difficulty": "intermediate", "question_count": 10,
         "adaptive": True, "feedback_timing": "END", "avatar_key": "preset-01"}
    )

    assert config.question_type is QuestionType.CASE_BASED


def test_config_defaults_to_adaptive_with_end_feedback():
    config = InterviewConfig.model_validate(
        {"question_type": "MIXED", "difficulty": "beginner", "question_count": 5}
    )

    assert config.adaptive is True
    assert config.feedback_timing == "END"
    assert config.avatar_key is None


@pytest.mark.parametrize("count", [0, 4, 7, 20])
def test_config_only_allows_5_10_or_15_questions(count):
    with pytest.raises(ValidationError):
        InterviewConfig.model_validate(
            {"question_type": "DIRECT", "difficulty": "beginner", "question_count": count}
        )


@pytest.mark.parametrize("field, value", [
    ("question_type", "TRICK"),
    ("difficulty", "expert"),
    ("feedback_timing", "AFTER_EACH"),
    ("avatar_key", "../../etc/passwd"),
])
def test_config_rejects_values_outside_the_spec(field, value):
    data = {"question_type": "DIRECT", "difficulty": "beginner", "question_count": 5, field: value}

    with pytest.raises(ValidationError):
        InterviewConfig.model_validate(data)


# GeneratedQuestion


def test_generated_question_ignores_extra_fields_from_the_model():
    question = GeneratedQuestion.model_validate(
        {"type": "CONCEPTUAL", "competency": "overfitting", "difficulty": "intermediate",
         "prompt": "Why can cross-validation beat one train/test split?",
         "confidence": 0.9}
    )

    assert question.answer_key is None
    assert question.source_chunk_ids == []


def test_generated_question_cannot_be_mixed():
    with pytest.raises(ValidationError, match="concrete type"):
        GeneratedQuestion.model_validate(
            {"type": "MIXED", "competency": "x", "difficulty": "beginner", "prompt": "Define it."}
        )


def test_generated_question_with_a_quote_must_cite_its_chunks():
    data = {"type": "CASE_BASED", "competency": "normalisation", "difficulty": "advanced",
            "prompt": "Diagnose this schema.", "supporting_quote": "Third normal form removes..."}

    with pytest.raises(ValidationError, match="source_chunk_ids"):
        GeneratedQuestion.model_validate(data)

    question = GeneratedQuestion.model_validate({**data, "source_chunk_ids": [str(uuid.uuid4())]})
    assert len(question.source_chunk_ids) == 1


def test_generated_question_requires_a_prompt():
    with pytest.raises(ValidationError):
        GeneratedQuestion.model_validate(
            {"type": "DIRECT", "competency": "x", "difficulty": "beginner", "prompt": ""}
        )


def test_question_view_never_exposes_the_answer_key():
    fields = set(QuestionView.model_fields)

    assert "answer_key" not in fields
    assert "answer_key_json" not in fields
    assert "supporting_quote" not in fields


def test_question_view_reads_from_a_database_row():
    class Row:
        id = uuid.uuid4()
        sequence = 1
        type = QuestionType.DIRECT
        competency = "overfitting"
        difficulty = Difficulty.BEGINNER
        prompt = "Define overfitting."
        source_chunk_ids = []
        grounding_status = GroundingStatus.NOT_APPLICABLE
        answer_key_json = {"key_points": ["secret"]}
        supporting_quote = "secret"

    dumped = QuestionView.model_validate(Row()).model_dump()

    assert "secret" not in str(dumped)


# AnswerEvaluation


def test_evaluation_whose_totals_match_its_criteria_is_valid():
    result = AnswerEvaluation.model_validate(evaluation())

    assert result.score == 3
    assert result.insufficient_evidence is False


def test_evaluation_total_must_equal_the_sum_of_criteria():
    with pytest.raises(ValidationError, match="score must equal"):
        AnswerEvaluation.model_validate(evaluation(score=5))

    with pytest.raises(ValidationError, match="max_score must equal"):
        AnswerEvaluation.model_validate(evaluation(max_score=10))


def test_criterion_cannot_score_above_its_maximum():
    data = evaluation(score=4)
    data["criteria"][0]["score"] = 4

    with pytest.raises(ValidationError, match="above its maximum"):
        AnswerEvaluation.model_validate(data)


def test_evaluation_rejects_negative_scores():
    data = evaluation(score=0)
    data["criteria"][0]["score"] = -1
    data["criteria"][1]["score"] = 1

    with pytest.raises(ValidationError):
        AnswerEvaluation.model_validate(data)


def test_evaluation_needs_at_least_one_criterion():
    with pytest.raises(ValidationError):
        AnswerEvaluation.model_validate(evaluation(score=0, max_score=0, criteria=[]))


def test_evaluation_rejects_duplicate_criteria():
    data = evaluation()
    data["criteria"][1]["name"] = "Metric Selection"

    with pytest.raises(ValidationError, match="duplicates"):
        AnswerEvaluation.model_validate(data)
