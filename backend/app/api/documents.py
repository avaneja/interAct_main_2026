"""Documents API (Model B): upload a file and read what was found in it."""

import uuid
from datetime import datetime
from typing import Annotated, Any

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import LLM, CurrentUser, DbSession
from app.core.llm import LLMClient
from app.core.config import get_settings
from app.core.storage import FileStorage, get_storage
from app.models import Document, Job
from app.models.enums import DocumentStatus, JobStatus
from app.services import documents as svc
from app.services import jobs

router = APIRouter(prefix="/api/v1/documents", tags=["documents"])
jobs_router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])
logger = logging.getLogger(__name__)
Storage = Annotated[FileStorage, Depends(get_storage)]
READ_BLOCK = 1024 * 1024


class DocumentView(BaseModel):
    id: uuid.UUID
    filename: str
    status: DocumentStatus
    summary: dict[str, Any] | None
    created_at: datetime
    # The latest processing job, to poll at /api/v1/jobs/{job_id}.
    job_id: uuid.UUID | None = None


class JobView(BaseModel):
    id: uuid.UUID
    kind: str
    status: JobStatus
    document_id: uuid.UUID | None
    result: dict[str, Any] | None
    error: str | None
    created_at: datetime
    completed_at: datetime | None


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


def _view(document: Document, job: Job | None = None) -> DocumentView:
    return DocumentView(
        id=document.id,
        filename=document.filename,
        status=document.status,
        summary=document.summary_json,
        created_at=document.created_at,
        job_id=job.id if job else None,
    )


def _process_later(db: Session, job: Job, storage: FileStorage, llm: LLMClient, background: BackgroundTasks) -> None:
    """After the response, process the job's document with a database session of its own."""
    bind, job_id = db.get_bind(), job.id

    def run() -> None:
        with Session(bind) as own:
            job = own.get(Job, job_id)
            if job is None:
                return
            try:
                jobs.start(own, job)
                document = svc.process(own, own.get(Document, job.document_id), storage, llm)
            except Exception:
                logger.exception("Processing a document failed unexpectedly.")
                own.rollback()
                document = own.get(Document, job.document_id)
                document.status = DocumentStatus.FAILED
                document.summary_json = {"error": "Something went wrong while processing. Try again."}
                jobs.finish(own, job, JobStatus.FAILED, error="unexpected", result=document.summary_json)
                return
            if document.status is DocumentStatus.READY:
                jobs.finish(own, job, JobStatus.COMPLETED, result={"document_status": document.status.value})
            else:
                jobs.finish(own, job, JobStatus.FAILED, error="document_failed", result=document.summary_json)

    background.add_task(run)


async def _read_limited(file: UploadFile, max_bytes: int) -> bytes:
    """The upload's bytes, reading at most one block past the limit so a huge file is not held in memory."""
    data = bytearray()
    while block := await file.read(READ_BLOCK):
        data.extend(block)
        if len(data) > max_bytes:
            break
    return bytes(data)


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_document(
    file: UploadFile, db: DbSession, user: CurrentUser, storage: Storage, llm: LLM, background: BackgroundTasks
) -> DocumentView:
    """Upload a text-based PDF or a TXT file for a document-based interview. It is processed
    after the response; poll the returned job_id."""
    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    data = await _read_limited(file, max_bytes)
    document = svc.upload(db, user, storage, file.filename, data, max_bytes)
    job = jobs.queue_processing(db, user, document)
    _process_later(db, job, storage, llm, background)
    return _view(document, job)


@router.get("/{document_id}")
def get_document(document_id: uuid.UUID, db: DbSession, user: CurrentUser) -> DocumentView:
    document = svc.get_document(db, user, document_id)
    return _view(document, jobs.latest_job(db, document))


@router.post("/{document_id}/process", status_code=status.HTTP_202_ACCEPTED)
def process_document(
    document_id: uuid.UUID, db: DbSession, user: CurrentUser, storage: Storage, llm: LLM, background: BackgroundTasks
) -> DocumentView:
    """Process a document again, after it failed or was interrupted."""
    document = svc.get_document(db, user, document_id)
    job = jobs.queue_processing(db, user, document)
    _process_later(db, job, storage, llm, background)
    return _view(document, job)


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
    return DocumentSummaryView(document=_view(document, jobs.latest_job(db, document)), topics=topics)


@jobs_router.get("/{job_id}")
def get_job(job_id: uuid.UUID, db: DbSession, user: CurrentUser) -> JobView:
    """A long-running job's status; when it ends, its result or why it failed."""
    job = jobs.get_job(db, user, job_id)
    return JobView(
        id=job.id,
        kind=job.kind,
        status=job.status,
        document_id=job.document_id,
        result=job.result_json,
        error=job.error_code,
        created_at=job.created_at,
        completed_at=job.completed_at,
    )
