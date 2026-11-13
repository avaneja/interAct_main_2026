"""Request and response bodies for the sessions API."""

import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, StringConstraints

from app.models.enums import InputModel, QuestionType, SessionState
from app.schemas.interview import QuestionView

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


class AnswerResult(BaseModel):
    """What the client gets after answering. Scores stay in the final report."""

    state: SessionState
    next_question: QuestionView | None
    completed: bool


class ReportView(BaseModel):
    session_id: uuid.UUID
    generated_at: datetime
    summary: dict[str, Any]
