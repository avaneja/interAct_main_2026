import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAtMixin, IdMixin, JSONType, OwnedMixin, enum_type
from app.models.enums import JobStatus, ValidationStatus


class Job(IdMixin, OwnedMixin, CreatedAtMixin, Base):
    """A long-running LLM task that the client polls at /api/v1/jobs/{id}."""

    __tablename__ = "jobs"

    kind: Mapped[str] = mapped_column(String(50))
    status: Mapped[JobStatus] = mapped_column(enum_type(JobStatus), default=JobStatus.QUEUED)
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"), index=True
    )
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    result_json: Mapped[dict[str, Any] | None] = mapped_column(JSONType)
    error_code: Mapped[str | None] = mapped_column(String(100))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class LLMCall(IdMixin, CreatedAtMixin, Base):
    """The raw, unvalidated output of one model call, kept apart from validated data.

    Every call belongs to a session or a document, so it is owned through that parent.
    """

    __tablename__ = "llm_calls"
    __table_args__ = (
        CheckConstraint(
            "session_id IS NOT NULL OR document_id IS NOT NULL", name="has_parent"
        ),
    )

    session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sessions.id", ondelete="CASCADE"), index=True
    )
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    purpose: Mapped[str] = mapped_column(String(50))
    model: Mapped[str] = mapped_column(String(200))
    prompt_version: Mapped[str] = mapped_column(String(50))
    raw_output: Mapped[str] = mapped_column(Text)
    validation_status: Mapped[ValidationStatus] = mapped_column(enum_type(ValidationStatus))


class ExperimentRun(IdMixin, CreatedAtMixin, Base):
    """One research run, recording every version that affects the results."""

    __tablename__ = "experiment_runs"

    model_version: Mapped[str] = mapped_column(String(200))
    prompt_version: Mapped[str] = mapped_column(String(50))
    rubric_version: Mapped[str] = mapped_column(String(50))
    dataset_version: Mapped[str] = mapped_column(String(50))
    metrics_json: Mapped[dict[str, Any]] = mapped_column(JSONType)
