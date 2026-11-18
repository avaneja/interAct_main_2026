"""Documents API (Model B): upload a file and read what was found in it."""

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, UploadFile, status
from pydantic import BaseModel

from app.api.deps import CurrentUser, DbSession
from app.core.config import get_settings
from app.core.storage import FileStorage, get_storage
from app.models import Document
from app.models.enums import DocumentStatus
from app.services import documents as svc

router = APIRouter(prefix="/api/v1/documents", tags=["documents"])
Storage = Annotated[FileStorage, Depends(get_storage)]
READ_BLOCK = 1024 * 1024


class DocumentView(BaseModel):
    id: uuid.UUID
    filename: str
    status: DocumentStatus
    summary: dict[str, Any] | None
    created_at: datetime


class TopicView(BaseModel):
    id: uuid.UUID
    name: str
    summary: str | None
    pages: list[int]
    chunks: int


class DocumentSummaryView(BaseModel):
    """What was found in a document, for the candidate to review and choose topics from."""

    document: DocumentView
    topics: list[TopicView]


def _view(document: Document) -> DocumentView:
    return DocumentView(
        id=document.id,
        filename=document.filename,
        status=document.status,
        summary=document.summary_json,
        created_at=document.created_at,
    )


async def _read_limited(file: UploadFile, max_bytes: int) -> bytes:
    """The upload's bytes, reading at most one block past the limit so a huge file is not held in memory."""
    data = bytearray()
    while block := await file.read(READ_BLOCK):
        data.extend(block)
        if len(data) > max_bytes:
            break
    return bytes(data)


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_document(file: UploadFile, db: DbSession, user: CurrentUser, storage: Storage) -> DocumentView:
    """Upload a text-based PDF or a TXT file for a document-based interview."""
    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    data = await _read_limited(file, max_bytes)
    return _view(svc.upload(db, user, storage, file.filename, data, max_bytes))


@router.get("/{document_id}")
def get_document(document_id: uuid.UUID, db: DbSession, user: CurrentUser) -> DocumentView:
    return _view(svc.get_document(db, user, document_id))


@router.get("/{document_id}/summary")
def get_summary(document_id: uuid.UUID, db: DbSession, user: CurrentUser) -> DocumentSummaryView:
    """The document's summary and topic map, once it is processed."""
    document = svc.get_document(db, user, document_id)
    topics = [
        TopicView(
            id=topic.id,
            name=topic.name,
            summary=topic.summary,
            pages=sorted({page for chunk in chunks for page in (chunk.page, chunk.page_end) if page is not None}),
            chunks=len(chunks),
        )
        for topic, chunks in svc.topics_of(db, document)
    ]
    return DocumentSummaryView(document=_view(document), topics=topics)
