"""Data contracts from README section 4.

Client input (context, config) rejects unknown fields, so a misspelled field
fails loudly. LLM output (generated questions, evaluations) ignores extra
fields, because models often add harmless ones, but every required field must
be present and valid. Ids come from the URL and the database, not from these
bodies.
"""

import uuid
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.models.enums import Difficulty, GroundingStatus, InputModel, QuestionType

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
AvatarKey = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,64}$")]


class ClientInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class LLMOutput(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


def _unique_ignoring_case(items: list[str], field: str) -> None:
    seen = [item.casefold() for item in items]
    if len(seen) != len(set(seen)):
        raise ValueError(f"{field} contains duplicates")


class InterviewContext(ClientInput):
    """What the interview is about, agreed during preparation."""

    input_model: InputModel
    topic: ShortText
    goal: ShortText | None = None
    level: Difficulty | None = None
    subtopics: list[ShortText] = Field(default_factory=list, max_length=20)
    document_id: uuid.UUID | None = None
    selected_topic_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def check_source(self) -> Self:
        _unique_ignoring_case(self.subtopics, "subtopics")
        if self.input_model is InputModel.DOCUMENT and self.document_id is None:
            raise ValueError("a DOCUMENT interview needs a document_id")
        if self.input_model is InputModel.TOPIC and (self.document_id or self.selected_topic_ids):
            raise ValueError("a TOPIC interview cannot reference a document")
        return self


class InterviewConfig(ClientInput):
    """The shared configuration screen, the same for both input models."""

    question_type: QuestionType
    difficulty: Difficulty
    question_count: Literal[5, 10, 15]
    adaptive: bool = True
    feedback_timing: Literal["END"] = "END"
    avatar_key: AvatarKey | None = None


class AnswerKey(LLMOutput):
    key_points: list[LongText] = Field(min_length=1, max_length=10)


class GeneratedQuestion(LLMOutput):
    """One question as the generator must return it, before it is stored."""

    type: QuestionType
    competency: ShortText
    difficulty: Difficulty
    prompt: LongText
    source_chunk_ids: list[uuid.UUID] = Field(default_factory=list, max_length=10)
    supporting_quote: LongText | None = None
    answer_key: AnswerKey | None = None

    @model_validator(mode="after")
    def check_question(self) -> Self:
        if self.type is QuestionType.MIXED:
            raise ValueError("a generated question needs a concrete type, not MIXED")
        if self.supporting_quote and not self.source_chunk_ids:
            raise ValueError("a supporting_quote needs the source_chunk_ids it came from")
        return self


class QuestionView(BaseModel):
    """A question as the client sees it while answering.

    It has no answer key or supporting quote, so neither can leak before the
    question is answered.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    sequence: int
    type: QuestionType
    competency: str
    difficulty: Difficulty
    prompt: str
    source_chunk_ids: list[uuid.UUID]
    grounding_status: GroundingStatus


class CriterionScore(LLMOutput):
    name: ShortText
    score: int = Field(ge=0)
    max_score: int = Field(gt=0)
    evidence_quote: LongText | None = None
    reason: LongText

    @model_validator(mode="after")
    def check_bounds(self) -> Self:
        if self.score > self.max_score:
            raise ValueError(f"criterion '{self.name}' scores {self.score} above its maximum {self.max_score}")
        return self


class AnswerEvaluation(LLMOutput):
    """A rubric score for one answer, as the evaluator must return it.

    The totals must equal the sum of the criteria, so a model cannot state a
    total its own criteria do not support.
    """

    score: int = Field(ge=0)
    max_score: int = Field(gt=0)
    criteria: list[CriterionScore] = Field(min_length=1, max_length=10)
    missing_concepts: list[ShortText] = Field(default_factory=list, max_length=20)
    insufficient_evidence: bool = False

    @model_validator(mode="after")
    def check_totals(self) -> Self:
        _unique_ignoring_case([c.name for c in self.criteria], "criteria names")
        if self.max_score != sum(c.max_score for c in self.criteria):
            raise ValueError("max_score must equal the sum of the criteria maximums")
        if self.score != sum(c.score for c in self.criteria):
            raise ValueError("score must equal the sum of the criteria scores")
        return self
