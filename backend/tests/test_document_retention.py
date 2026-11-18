"""M9: deleting uploads, and deleting them automatically after the retention period."""

from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.core.storage import FileStorage, get_storage
from app.main import app
from app.models import Document, DocumentChunk, DocumentTopic, Job, LLMCall
from app.models.base import utcnow
from app.services import documents

NOTES = ("Cross-validation estimates how well a model generalises by training on folds of the data. " * 40).encode()


@pytest.fixture(autouse=True)
def storage(tmp_path):
    files = FileStorage(tmp_path / "uploads")
    app.dependency_overrides[get_storage] = lambda: files
    yield files
    app.dependency_overrides.pop(get_storage, None)


def upload(client):
    return client.post("/api/v1/documents", files={"file": ("notes.txt", NOTES)}).json()


def count(db, model):
    return db.scalar(select(func.count()).select_from(model))


def start_document_interview(client, document_id):
    sid = client.post("/api/v1/sessions", json={"input_model": "DOCUMENT"}).json()["id"]
    assert client.put(f"/api/v1/sessions/{sid}/context", json={
        "input_model": "DOCUMENT", "topic": "Notes", "document_id": document_id}).status_code == 200
    return sid


def test_uploads_are_listed_with_when_they_expire(client):
    uploaded = upload(client)

    listed = client.get("/api/v1/documents").json()

    assert [d["id"] for d in listed] == [uploaded["id"]]
    assert listed[0]["expires_at"] > listed[0]["created_at"]


def test_deleting_a_document_removes_the_file_and_everything_derived_from_it(client, storage, db_session):
    uploaded = upload(client)
    assert count(db_session, DocumentChunk) and count(db_session, DocumentTopic) and count(db_session, LLMCall)

    assert client.delete(f"/api/v1/documents/{uploaded['id']}").status_code == 204

    assert list(storage.root.iterdir()) == []
    for model in (Document, DocumentChunk, DocumentTopic, Job, LLMCall):
        assert count(db_session, model) == 0, model.__name__
    assert client.get(f"/api/v1/documents/{uploaded['id']}").status_code == 404


def test_a_document_an_unfinished_interview_uses_cannot_be_deleted(client, storage):
    uploaded = upload(client)
    start_document_interview(client, uploaded["id"])

    response = client.delete(f"/api/v1/documents/{uploaded['id']}")

    assert response.status_code == 409
    assert len(list(storage.root.iterdir())) == 1


def test_expired_uploads_are_deleted_unless_an_unfinished_interview_uses_them(client, storage, db_session):
    old, kept_for_interview, recent = upload(client), upload(client), upload(client)
    start_document_interview(client, kept_for_interview["id"])
    for document in db_session.scalars(select(Document)):
        if str(document.id) in (old["id"], kept_for_interview["id"]):
            document.created_at = utcnow() - timedelta(days=31)
    db_session.commit()

    deleted = documents.purge_expired(db_session, storage, retention_days=30)

    assert deleted == 1
    remaining = {str(document.id) for document in db_session.scalars(select(Document))}
    assert remaining == {kept_for_interview["id"], recent["id"]}
    assert len(list(storage.root.iterdir())) == 2


def test_expired_uploads_are_cleaned_up_after_the_next_upload(client, storage, db_session):
    old = upload(client)
    document = db_session.scalar(select(Document))
    document.created_at = utcnow() - timedelta(days=400)
    db_session.commit()

    upload(client)

    assert client.get(f"/api/v1/documents/{old['id']}").status_code == 404
    assert len(list(storage.root.iterdir())) == 1

