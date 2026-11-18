"""Request and response bodies for the sessions API."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints

from app.models.enums import InputModel, QuestionType, SessionState
from app.schemas.interview import DeliverySignals, QuestionView

AnswerText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=10_000)]


class SessionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_model: InputModel


class PlannedQuestion(BaseModel):
    sequence: int
    question_type: QuestionType
    competency: str


class SessionView(BaseModel):
    id: uuid.UUID
    input_model: InputModel
    state: SessionState
    context: dict[str, Any] | None
    config: dict[str, Any] | None
    questions_asked: int
    questions_answered: int
    # The style and focus of each planned question, once the context and config are set.
    plan: list[PlannedQuestion] | None
    created_at: datetime
    updated_at: datetime


class AnswerSubmit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question_id: uuid.UUID
    text: AnswerText
    # How the answer was given, measured in the browser. Never part of the score.
    delivery: DeliverySignals | None = None


class AnswerResult(BaseModel):
    """What the client gets after answering. Scores stay in the final report.

    `reaction` is what the interviewer says about this answer. It is also the
    start of the next question's lead_in, so a client that speaks the
    lead_in should not speak it twice; it is there for the last answer, which
    has no next question.
    """

    state: SessionState
    next_question: QuestionView | None
    completed: bool
    reaction: str | None = None


class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    stage: Literal["warm_up", "closing"]
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]


class ChatReplyView(BaseModel):
    """The interviewer's reply. `done` is true when the closing conversation is over."""

    reply: str
    done: bool


class PrepareMessage(BaseModel):
    """The candidate's next turn in the clarification chat.

    `skip` passes on the planner's current question; `enough` asks for no more
    questions, so the planner summarises the scope.
    """

    model_config = ConfigDict(extra="forbid")

    text: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)] = ""
    skip: bool = False
    enough: bool = False


class PreparationMessageView(BaseModel):
    role: Literal["user", "assistant"]
    kind: Literal["request", "reply", "skip", "question", "summary"]
    content: str


class PreparationView(BaseModel):
    """The clarification chat. `context` is the draft scope, not confirmed until
    PUT /context; `question` is waiting for a reply; `done` means the scope was summarised."""

    messages: list[PreparationMessageView]
    context: dict[str, Any] | None
    question: str | None
    done: bool
    questions_asked: int
    max_questions: int


class ReportView(BaseModel):
    session_id: uuid.UUID
    generated_at: datetime
    summary: dict[str, Any]
