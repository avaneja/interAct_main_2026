"""Long-running work done after the response, with a status the client polls.

A job records what is being done (its kind), for whom, its status and,
when it ends, the result or the reason it failed. The work itself runs in
a FastAPI background task with its own database session.
"""

import uuid
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Document, Job, User
from app.models.base import utcnow
from app.models.enums import DocumentStatus, JobStatus
from app.services.interview import Conflict, NotFound

PROCESS_DOCUMENT = "process_document"
# A document still processing after this long was interrupted (for example by a restart).
STALE_AFTER = timedelta(minutes=10)


def get_job(db: Session, user: User, job_id: uuid.UUID) -> Job:
    job = db.scalar(select(Job).where(Job.id == job_id, Job.owner_id == user.id))
    if job is None:
        raise NotFound("Job not found.")
    return job


def latest_job(db: Session, document: Document) -> Job | None:
    return db.scalar(select(Job).where(Job.document_id == document.id).order_by(Job.created_at.desc()).limit(1))


def _aware(moment):
    return moment if moment.tzinfo else moment.replace(tzinfo=utcnow().tzinfo)


def queue_processing(db: Session, user: User, document: Document) -> Job:
    """A new job to process `document`, unless it is ready or already being processed."""
    if document.status is DocumentStatus.READY:
        raise Conflict("The document is already processed.")
    previous = latest_job(db, document)
    if previous is not None and previous.status in (JobStatus.QUEUED, JobStatus.PROCESSING):
        if utcnow() - _aware(previous.created_at) < STALE_AFTER:
            raise Conflict("The document is already being processed.")
        finish(db, previous, JobStatus.FAILED, error="interrupted", result={"error": "Processing was interrupted."})
    job = Job(owner_id=user.id, kind=PROCESS_DOCUMENT, document_id=document.id, status=JobStatus.QUEUED)
    db.add(job)
    db.commit()
    return job


def start(db: Session, job: Job) -> None:
    job.status = JobStatus.PROCESSING
    db.commit()


def finish(db: Session, job: Job, status: JobStatus, *, result: dict | None = None, error: str | None = None) -> None:
    job.status = status
    job.result_json = result
    job.error_code = error
    job.completed_at = utcnow()
    db.commit()
