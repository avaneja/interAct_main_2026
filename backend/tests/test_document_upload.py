"""M9: uploading documents for Model B, with checks on type, content and size."""

import os
import stat

import pytest

from app.core.config import get_settings
from app.core.storage import FileStorage, get_storage
from app.main import app
from app.services import documents as svc
from app.services.interview import InvalidInput

PDF = b"%PDF-1.7\n% a tiny stand-in; real PDFs are parsed in the extraction tests\n"
TXT = "Overfitting happens when a model learns noise.\n".encode()


@pytest.fixture
def storage(tmp_path):
    files = FileStorage(tmp_path / "uploads")
    app.dependency_overrides[get_storage] = lambda: files
    yield files
    app.dependency_overrides.pop(get_storage, None)


def send(client, name, data, content_type="application/octet-stream"):
    return client.post("/api/v1/documents", files={"file": (name, data, content_type)})


def test_a_pdf_is_stored_privately_under_a_random_name(client, storage):
    response = send(client, "Lecture 3.pdf", PDF, "application/pdf")

    assert response.status_code == 201
    body = response.json()
    assert (body["filename"], body["status"], body["summary"]) == ("Lecture 3.pdf", "UPLOADED", None)
    stored = list(storage.root.iterdir())
    assert len(stored) == 1 and stored[0].name.endswith(".pdf") and "Lecture" not in stored[0].name
    assert stored[0].read_bytes() == PDF
    assert stat.S_IMODE(os.stat(stored[0]).st_mode) == 0o600
    assert stat.S_IMODE(os.stat(storage.root).st_mode) == 0o700


def test_a_utf8_text_file_is_accepted(client, storage):
    assert send(client, "notes.TXT", "\ufeffCafé notes".encode("utf-8")).status_code == 201


@pytest.mark.parametrize("name, data, message", [
    ("slides.pptx", PDF, "Upload a PDF or TXT file"),
    ("essay.docx", b"PK\x03\x04", "Upload a PDF or TXT file"),
    ("notes", TXT, "Upload a PDF or TXT file"),
    ("fake.pdf", b"<html>not a pdf</html>", "not a valid PDF"),
    ("binary.txt", b"abc\x00def", "not plain text"),
    ("latin1.txt", "Caf\xe9".encode("latin-1"), "UTF-8"),
    ("empty.pdf", b"", "empty"),
])
def test_wrong_types_and_contents_are_refused_and_nothing_is_stored(client, storage, name, data, message):
    response = send(client, name, data)

    assert response.status_code == 422
    assert message in response.json()["detail"]
    assert not storage.root.exists() or not list(storage.root.iterdir())


def test_a_file_over_the_limit_is_refused(client, storage, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_upload_mb", 1)

    response = send(client, "big.pdf", PDF + b"x" * (1024 * 1024))

    assert response.status_code == 413
    assert "larger than 1 MB" in response.json()["detail"]


@pytest.mark.parametrize("given, shown", [
    ("../../etc/passwd.txt", "passwd.txt"),
    ("C:\\Users\\ada\\notes.txt", "notes.txt"),
    ("bad\x00name\n.pdf", "badname.pdf"),
    ("", "document"),
    ("a" * 300 + ".pdf", "a" * 251 + ".pdf"),
])
def test_filenames_are_cleaned_for_display(given, shown):
    assert svc.clean_filename(given) == shown


def test_a_storage_key_cannot_point_outside_the_folder(tmp_path):
    with pytest.raises(ValueError):
        FileStorage(tmp_path).path("../secret.txt")


def test_uploading_needs_a_signed_in_user(anonymous_client, storage):
    assert send(anonymous_client, "notes.txt", TXT).status_code == 401


def test_unknown_types_are_refused_by_extension():
    with pytest.raises(InvalidInput):
        svc.file_kind("deck.key")


def test_an_empty_upload_dir_setting_means_the_default_folder(monkeypatch):
    from app.core.config import BACKEND_DIR, Settings

    monkeypatch.setenv("UPLOAD_DIR", "")
    assert Settings(_env_file=None).upload_dir == BACKEND_DIR / "uploads"
