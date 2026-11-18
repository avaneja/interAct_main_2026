"""M9: documents are processed in the background, with a job status to poll."""

from datetime import timedelta

import pymupdf
import pytest
from sqlalchemy import select

from app.core.llm import LLMError
from app.core.storage import FileStorage, get_storage
from app.main import app
from app.models import Document, Job
from app.models.enums import DocumentStatus, JobStatus
from app.services import jobs

NOTES = ("Cross-validation estimates how well a model generalises by training on folds of the data. " * 40).encode()


@pytest.fixture(autouse=True)
def storage(tmp_path):
    files = FileStorage(tmp_path / "uploads")
    app.dependency_overrides[get_storage] = lambda: files
    yield files
    app.dependency_overrides.pop(get_storage, None)


def upload(client, name="notes.txt", data=NOTES):
    response = client.post("/api/v1/documents", files={"file": (name, data)})
    assert response.status_code == 201
    return response.json()


def test_an_upload_is_processed_after_the_response_and_its_job_completes(client):
    uploaded = upload(client)

    assert uploaded["status"] == "UPLOADED"
    job = client.get(f"/api/v1/jobs/{uploaded['job_id']}").json()
    assert (job["kind"], job["status"], job["document_id"]) == ("process_document", "COMPLETED", uploaded["id"])
    assert job["completed_at"] is not None
    document = client.get(f"/api/v1/documents/{uploaded['id']}").json()
    assert document["status"] == "READY"
    assert document["job_id"] == uploaded["job_id"]


def test_a_scanned_pdf_ends_with_a_failed_job_and_the_reason(client):
    scan = pymupdf.open()
    scan.new_page().insert_image(pymupdf.Rect(50, 50, 500, 700),
                                 pixmap=pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 50, 50), False))

    uploaded = upload(client, "scan.pdf", scan.tobytes())

    job = client.get(f"/api/v1/jobs/{uploaded['job_id']}").json()
    assert (job["status"], job["error"]) == ("FAILED", "document_failed")
    assert "looks scanned" in job["result"]["error"]
    assert client.get(f"/api/v1/documents/{uploaded['id']}").json()["status"] == "FAILED"


def test_a_failed_document_can_be_processed_again(client, fake_llm):
    fake_llm.queue_for("map_topics", LLMError("down"), LLMError("down"))
    uploaded = upload(client)
    assert client.get(f"/api/v1/documents/{uploaded['id']}").json()["status"] == "FAILED"

    again = client.post(f"/api/v1/documents/{uploaded['id']}/process")

    assert again.status_code == 202
    assert again.json()["job_id"] != uploaded["job_id"]
    assert client.get(f"/api/v1/jobs/{again.json()['job_id']}").json()["status"] == "COMPLETED"
    assert client.get(f"/api/v1/documents/{uploaded['id']}").json()["status"] == "READY"


def test_a_ready_document_is_not_processed_again(client):
    uploaded = upload(client)
    assert client.post(f"/api/v1/documents/{uploaded['id']}/process").status_code == 409


def test_a_document_already_being_processed_is_not_queued_twice(client, db_session):
    uploaded = upload(client)
    job = db_session.scalar(select(Job))
    job.status = JobStatus.PROCESSING
    document = db_session.scalar(select(Document))
    document.status = DocumentStatus.PROCESSING
    db_session.commit()

    assert client.post(f"/api/v1/documents/{uploaded['id']}/process").status_code == 409

    job.created_at = job.created_at - jobs.STALE_AFTER - timedelta(minutes=1)
    db_session.commit()
    retried = client.post(f"/api/v1/documents/{uploaded['id']}/process")
    assert retried.status_code == 202
    db_session.refresh(job)
    assert (job.status, job.error_code) == (JobStatus.FAILED, "interrupted")


def test_an_unexpected_error_fails_the_job_cleanly(client, monkeypatch):
    from app.services import documents

    def explode(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(documents, "chunk_pages", explode)
    uploaded = upload(client)

    job = client.get(f"/api/v1/jobs/{uploaded['job_id']}").json()
    assert (job["status"], job["error"]) == ("FAILED", "unexpected")
    assert client.get(f"/api/v1/documents/{uploaded['id']}").json()["status"] == "FAILED"


def test_an_unknown_job_is_not_found(client):
    assert client.get("/api/v1/jobs/00000000-0000-4000-8000-000000000000").status_code == 404
