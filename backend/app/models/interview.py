import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import (
    Base,
    CreatedAtMixin,
    IdMixin,
    JSONType,
    OwnedMixin,
    enum_type,
    utcnow,
)
from app.models.enums import (
    Difficulty,
    GroundingStatus,
    InputModel,
    MessageRole,
    QuestionType,
    SessionState,
    StyleStatus,
)


class InterviewSession(IdMixin, OwnedMixin, CreatedAtMixin, Base):
    """One interview, from preparation to the final report."""

    __tablename__ = "sessions"

    input_model: Mapped[InputModel] = mapped_column(enum_type(InputModel))
    state: Mapped[SessionState] = mapped_column(
        enum_type(SessionState), default=SessionState.PREPARING
    )
    context_json: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    config_json: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    questions: Mapped[list["Question"]] = relationship(
        back_populates="session", order_by="Question.sequence", passive_deletes=True
    )


class PreparationMessage(IdMixin, CreatedAtMixin, Base):
    """One turn of the Model A clarification chat."""

    __tablename__ = "preparation_messages"

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[MessageRole] = mapped_column(enum_type(MessageRole))
    content: Mapped[str] = mapped_column(Text)


class Rubric(IdMixin, CreatedAtMixin, Base):
    """A shared, versioned scoring rubric. A version is never edited once used."""

    __tablename__ = "rubrics"
    __table_args__ = (
        UniqueConstraint("name", "version"),
        CheckConstraint("max_score > 0", name="max_score_positive"),
    )

    name: Mapped[str] = mapped_column(String(200))
    version: Mapped[str] = mapped_column(String(50))
    criteria_json: Mapped[list[dict[str, Any]]] = mapped_column(JSONType)
    max_score: Mapped[int] = mapped_column(Integer)


class Question(IdMixin, CreatedAtMixin, Base):
    __tablename__ = "questions"
    __table_args__ = (
        UniqueConstraint("session_id", "sequence", "follow_up"),
        CheckConstraint("sequence >= 1", name="sequence_positive"),
        CheckConstraint("follow_up >= 0", name="follow_up_not_negative"),
        CheckConstraint("type <> 'MIXED'", name="type_not_mixed"),
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"), index=True
    )
    # The planned question's number. Follow-ups share it with the question they follow.
    sequence: Mapped[int] = mapped_column(Integer)
    # 0 for a planned question; 1, 2, ... for the interviewer's follow-ups to it.
    # Only planned questions count toward the question budget and are scored,
    # each together with its follow-ups.
    follow_up: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # What the interviewer says just before asking: a reaction to the last
    # answer and, for a planned question, a transition to it.
    lead_in: Mapped[str | None] = mapped_column(Text)
    type: Mapped[QuestionType] = mapped_column(enum_type(QuestionType))
    competency: Mapped[str] = mapped_column(String(200))
    difficulty: Mapped[Difficulty] = mapped_column(enum_type(Difficulty))
    prompt: Mapped[str] = mapped_column(Text)
    rubric_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("rubrics.id", ondelete="RESTRICT"), index=True
    )
    source_chunk_ids: Mapped[list[str]] = mapped_column(JSONType, default=list)
    # Model B only. Never sent to the client before the question is answered.
    supporting_quote: Mapped[str | None] = mapped_column(Text)
    answer_key_json: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    grounding_status: Mapped[GroundingStatus] = mapped_column(
        enum_type(GroundingStatus), default=GroundingStatus.NOT_APPLICABLE
    )
    # Whether the question matches its requested style; the note says why not.
    style_status: Mapped[StyleStatus] = mapped_column(
        enum_type(StyleStatus), default=StyleStatus.UNCHECKED, server_default=StyleStatus.UNCHECKED.value
    )
    style_note: Mapped[str | None] = mapped_column(Text)

    session: Mapped[InterviewSession] = relationship(back_populates="questions")
    answer: Mapped["Answer | None"] = relationship(
        back_populates="question", passive_deletes=True
    )


class Answer(IdMixin, Base):
    """The candidate's answer. One per question, so a resubmission cannot duplicate it."""

    __tablename__ = "answers"

    question_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("questions.id", ondelete="CASCADE"), unique=True
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"), index=True
    )
    text: Mapped[str] = mapped_column(Text)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # What the interviewer said in reply to this answer, so a repeated submit gets the same reply.
    reaction: Mapped[str | None] = mapped_column(Text)

    question: Mapped[Question] = relationship(back_populates="answer")
    evaluation: Mapped["Evaluation | None"] = relationship(
        back_populates="answer", passive_deletes=True
    )


class Evaluation(IdMixin, CreatedAtMixin, Base):
    """The validated score for one answer. One per answer."""

    __tablename__ = "evaluations"

    answer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("answers.id", ondelete="CASCADE"), unique=True
    )
    scores_json: Mapped[dict[str, Any]] = mapped_column(JSONType)
    evidence_json: Mapped[list[dict[str, Any]]] = mapped_column(JSONType, default=list)
    evaluator_version: Mapped[str] = mapped_column(String(50))

    answer: Mapped[Answer] = relationship(back_populates="evaluation")


class Report(IdMixin, Base):
    """The final report for a session. One per session."""

    __tablename__ = "reports"

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"), unique=True
    )
    summary_json: Mapped[dict[str, Any]] = mapped_column(JSONType)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
