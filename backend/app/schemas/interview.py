"""Data contracts from README section 4.

Client input (context, config) rejects unknown fields, so a misspelled field
fails loudly. LLM output (generated questions, evaluations) ignores extra
fields, because models often add harmless ones, but every required field must
be present and valid. Ids come from the URL and the database, not from these
bodies.
"""

import uuid
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from app.models.enums import Difficulty, GroundingStatus, InputModel, QuestionType

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
LongText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
AvatarKey = Annotated[str, StringConstraints(pattern=r"^[a-z0-9-]{1,64}$")]


class ClientInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CameraFocus(ClientInput):
    """Estimated in the browser from the camera while the candidate answered. Numbers only."""

    looking_away_ratio: float = Field(ge=0, le=1)
    look_aways: int = Field(ge=0, le=1000)
    face_missing_ratio: float = Field(ge=0, le=1)
    multiple_faces_ratio: float = Field(ge=0, le=1)


class DeliverySignals(ClientInput):
    """Measured in the browser while the candidate answered one question.

    Numbers only: no video, audio, image or screen content is ever sent. The
    focus fields are sent only when the candidate consented to focus
    tracking, and the camera ones only when the camera was on.
    """

    answer_seconds: float = Field(ge=0, le=3600)
    spoken: bool
    tab_switches: int = Field(default=0, ge=0, le=1000)
    seconds_away: float = Field(default=0, ge=0, le=3600)
    fullscreen_exits: int = Field(default=0, ge=0, le=1000)
    camera: CameraFocus | None = None


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


SpokenText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=600)]


class InterviewerTurn(LLMOutput):
    """What the interviewer says after the candidate's reply.

    `reaction` responds to what the candidate said. `follow_up` is one more
    question about the same planned question, or empty to move on, when
    `transition` leads into the next one.
    """

    reaction: SpokenText = ""
    follow_up: SpokenText | None = None
    transition: SpokenText = ""

    @model_validator(mode="after")
    def blank_means_none(self) -> Self:
        if self.follow_up is not None and not self.follow_up.strip():
            self.follow_up = None
        return self


class SmallTalk(LLMOutput):
    """The interviewer's reply in the warm-up or the closing; `done` ends the closing."""

    reply: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=800)]
    done: bool = False


class SuggestedSubtopics(LLMOutput):
    """Concrete areas to cover, suggested when the candidate gave none or only vague ones."""

    subtopics: list[ShortText] = Field(min_length=3, max_length=6)

    @model_validator(mode="after")
    def check_unique(self) -> Self:
        _unique_ignoring_case(self.subtopics, "subtopics")
        return self


class StyleVerdict(LLMOutput):
    """The style check's judgement of which style a question really is."""

    style: QuestionType
    reason: LongText

    @model_validator(mode="after")
    def check_style(self) -> Self:
        if self.style is QuestionType.MIXED:
            raise ValueError("the verdict must name a concrete style")
        return self


class QuestionView(BaseModel):
    """A question as the client sees it while answering.

    It has no answer key or supporting quote, so neither can leak before the
    question is answered.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    sequence: int
    # 0 for a planned question, 1 or more for the interviewer's follow-ups to it.
    follow_up: int
    # What the interviewer says just before the question (a reaction and a transition).
    lead_in: str | None
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

    The totals are always the sum of the criteria. A model may leave them
    out, and they are filled in; if it states them, they must match, so it
    cannot claim a total its own criteria do not support.
    """

    score: int | None = Field(default=None, ge=0)
    max_score: int | None = Field(default=None, gt=0)
    criteria: list[CriterionScore] = Field(min_length=1, max_length=10)
    missing_concepts: list[ShortText] = Field(default_factory=list, max_length=20)
    insufficient_evidence: bool = False
    better_answer_outline: list[LongText] = Field(default_factory=list, max_length=6)

    @model_validator(mode="after")
    def check_totals(self) -> Self:
        _unique_ignoring_case([c.name for c in self.criteria], "criteria names")
        max_total = sum(c.max_score for c in self.criteria)
        total = sum(c.score for c in self.criteria)
        if self.max_score is not None and self.max_score != max_total:
            raise ValueError("max_score must equal the sum of the criteria maximums")
        if self.score is not None and self.score != total:
            raise ValueError("score must equal the sum of the criteria scores")
        self.max_score, self.score = max_total, total
        return self


class PreparationTurn(LLMOutput):
    """The planner's reading of the clarification chat so far, and its next question.

    Lenient where models are sloppy: an empty goal or question, an unknown
    level and repeated subtopics are dropped rather than failing the turn.
    """

    topic: ShortText
    goal: str | None = None
    level: Difficulty | None = None
    subtopics: list[str] = Field(default_factory=list)
    question: str | None = None

    @field_validator("goal", "question", mode="before")
    @classmethod
    def blank_is_none(cls, value: object) -> object:
        if isinstance(value, str) and (not value.strip() or value.strip().lower() in {"null", "none", "n/a"}):
            return None
        return value

    @field_validator("goal")
    @classmethod
    def short_goal(cls, value: str | None) -> str | None:
        return value[:200].strip() if value else None

    @field_validator("question")
    @classmethod
    def short_question(cls, value: str | None) -> str | None:
        if value is not None and len(value) > 400:
            raise ValueError("the question is too long")
        return value

    @field_validator("level", mode="before")
    @classmethod
    def known_level(cls, value: object) -> object:
        if isinstance(value, str):
            value = value.strip().lower()
            return value if value in {level.value for level in Difficulty} else None
        return value

    @field_validator("subtopics", mode="before")
    @classmethod
    def clean_subtopics(cls, value: object) -> object:
        if not isinstance(value, list):
            return []
        kept: list[str] = []
        for item in value:
            text = str(item).strip()[:200] if item is not None else ""
            if text and text.casefold() not in {k.casefold() for k in kept}:
                kept.append(text)
        return kept[:20]
