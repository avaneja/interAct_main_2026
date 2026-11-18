"""Model B documents: upload checks and storage.

Rules enforced here (README 2.2):

- Only text-based PDF and TXT files are accepted, by extension and by
  content: a PDF must start with the PDF signature, and a TXT file must be
  UTF-8 text without NUL bytes. DOCX, PPTX and anything else are refused.
- Files over the size limit or empty ones are refused before storage.
- Files are stored under random names in private storage; the name the user
  gave is kept only for display, cleaned of paths and control characters.
- A document belongs to the user who uploaded it; other users' documents
  look the same as missing ones.
"""

import re
import uuid
from pathlib import PurePath

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.storage import FileStorage
from app.models import Document, DocumentChunk, User
from app.models.enums import DocumentStatus
from app.services.chunking import Chunk
from app.services.interview import InvalidInput, NotFound

ALLOWED = {".pdf": "PDF", ".txt": "TXT"}
PDF_SIGNATURE = b"%PDF-"
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


class TooLarge(InvalidInput):
    """The upload is over the size limit."""


def clean_filename(name: str | None) -> str:
    """The name to show for an upload: no folders, no control characters, at most 255 characters."""
    base = PurePath((name or "").replace("\\", "/")).name
    base = _CONTROL.sub("", base).strip()
    if len(base) > 255:
        stem, dot, ext = base.rpartition(".")
        base = (stem[: 255 - len(ext) - 1] + dot + ext) if dot and len(ext) < 10 else base[:255]
    return base or "document"


def file_kind(filename: str) -> str:
    """"PDF" or "TXT" from the extension; anything else is refused."""
    suffix = PurePath(filename).suffix.lower()
    if suffix not in ALLOWED:
        raise InvalidInput("Upload a PDF or TXT file. Other formats, such as DOCX and PPTX, are not supported yet.")
    return ALLOWED[suffix]


def check_content(kind: str, data: bytes, max_bytes: int) -> None:
    if not data:
        raise InvalidInput("The file is empty.")
    if len(data) > max_bytes:
        raise TooLarge(f"The file is larger than {max_bytes // (1024 * 1024)} MB.")
    if kind == "PDF":
        if not data.startswith(PDF_SIGNATURE):
            raise InvalidInput("This file is not a valid PDF.")
        return
    if b"\x00" in data:
        raise InvalidInput("This file is not plain text.")
    try:
        data.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise InvalidInput("Save the text file as UTF-8, then upload it again.") from error


def upload(db: Session, user: User, storage: FileStorage, filename: str | None, data: bytes, max_bytes: int) -> Document:
    """Check an uploaded file and store it for processing."""
    name = clean_filename(filename)
    kind = file_kind(name)
    check_content(kind, data, max_bytes)
    key = storage.save(data, f".{kind.lower()}")
    document = Document(owner_id=user.id, filename=name, storage_key=key, status=DocumentStatus.UPLOADED)
    db.add(document)
    try:
        db.commit()
    except Exception:
        storage.delete(key)
        raise
    return document


def get_document(db: Session, user: User, document_id: uuid.UUID) -> Document:
    """The user's document, or NotFound. Other users' documents look the same as missing ones."""
    document = db.scalar(select(Document).where(Document.id == document_id, Document.owner_id == user.id))
    if document is None:
        raise NotFound("Document not found.")
    return document


def save_chunks(db: Session, document: Document, chunks: list[Chunk]) -> list[DocumentChunk]:
    """Replace the document's chunks with `chunks`, in order."""
    db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document.id))
    rows = [
        DocumentChunk(
            document_id=document.id, chunk_index=chunk.index, page=chunk.page, page_end=chunk.page_end, text=chunk.text
        )
        for chunk in chunks
    ]
    db.add_all(rows)
    db.commit()
    return rows
