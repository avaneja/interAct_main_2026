import uuid
from typing import Any

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAtMixin, IdMixin, JSONType, OwnedMixin, enum_type
from app.models.enums import DocumentStatus


class Document(IdMixin, OwnedMixin, CreatedAtMixin, Base):
    """An uploaded source file for a Model B interview."""

    __tablename__ = "documents"

    filename: Mapped[str] = mapped_column(String(255))
    storage_key: Mapped[str] = mapped_column(String(512), unique=True)
    status: Mapped[DocumentStatus] = mapped_column(
        enum_type(DocumentStatus), default=DocumentStatus.UPLOADED
    )
    summary_json: Mapped[dict[str, Any] | None] = mapped_column(JSONType)


class DocumentChunk(IdMixin, Base):
    """A page-aware slice of a document's text that questions can cite."""

    __tablename__ = "document_chunks"
    __table_args__ = (UniqueConstraint("document_id", "chunk_index"),)

    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    chunk_index: Mapped[int] = mapped_column(Integer)
    # The pages the chunk spans (None for an unpaged TXT file).
    page: Mapped[int | None] = mapped_column(Integer)
    page_end: Mapped[int | None] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)


class DocumentTopic(IdMixin, Base):
    """One entry of a document's topic map: a topic and the chunks that cover it."""

    __tablename__ = "document_topics"

    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    summary: Mapped[str | None] = mapped_column(Text)
    chunk_ids: Mapped[list[str]] = mapped_column(JSONType, default=list)
