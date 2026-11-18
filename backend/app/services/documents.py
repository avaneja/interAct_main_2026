"""Model B documents: upload checks, storage and processing.

Rules enforced here (README 2.2):

- Only text-based PDF and TXT files are accepted, by extension and by
  content: a PDF must start with the PDF signature, and a TXT file must be
  UTF-8 text without NUL bytes. DOCX, PPTX and anything else are refused.
- Files over the size limit or empty ones are refused before storage.
- Files are stored under random names in private storage; the name the user
  gave is kept only for display, cleaned of paths and control characters.
- A document belongs to the user who uploaded it; other users' documents
  look the same as missing ones.
- Processing extracts the text, splits it into chunks and maps it into
  topics. Every topic cites only chunks that exist: ids the model invents
  are dropped. A topic left without chunks cites the chunks that clearly
  match its name and summary (BM25), or its only chunk in a one-chunk
  document; with no clear match it is dropped. A document that
  cannot be read or mapped is marked FAILED with the reason, and nothing
  partial is used.
- Small documents are mapped from their whole text; longer ones from the
  opening words of every chunk, so the request fits the model's context.
"""

import re
import uuid
from pathlib import PurePath

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.llm import LLMClient
from app.core.storage import FileStorage
from app.models import Document, DocumentChunk, DocumentTopic, User
from app.models.enums import DocumentStatus
from app.schemas import TopicMap
from app.services import prompts
from app.services.chunking import Chunk, chunk_pages, estimate_tokens
from app.services.extraction import ExtractionError, extract
from app.services.retrieval import strong_matches
from app.services.interview import InvalidInput, LLMUnavailable, NotFound, _ask_llm

ALLOWED = {".pdf": "PDF", ".txt": "TXT"}
# Up to this many tokens, the topic map reads the whole text; above it, each chunk's opening.
# Bounded by the local model's 8K context, leaving room for the instructions and the reply.
FULL_TEXT_TOKENS = 5000
OPENING_WORDS = 60
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


def pages_label(page: int | None, page_end: int | None) -> str:
    if page is None:
        return "no page numbers"
    if page_end is None or page_end == page:
        return f"page {page}"
    return f"pages {page}-{page_end}"


def map_topics(db: Session, llm: LLMClient, document: Document, chunks: list[DocumentChunk]) -> TopicMap:
    """Ask the model for the document's topics; only chunk ids that exist survive."""
    ids = {f"c{chunk.chunk_index}": chunk for chunk in chunks}
    shortened = sum(estimate_tokens(chunk.text) for chunk in chunks) > FULL_TEXT_TOKENS
    entries = [
        (
            chunk_id,
            pages_label(chunk.page, chunk.page_end),
            " ".join(chunk.text.split()[:OPENING_WORDS]) if shortened else chunk.text,
        )
        for chunk_id, chunk in ids.items()
    ]

    def cited_only(topic_map: TopicMap) -> None:
        kept = []
        seen: set[str] = set()
        for topic in topic_map.topics:
            topic.chunk_ids = list(dict.fromkeys(chunk_id.strip() for chunk_id in topic.chunk_ids if chunk_id.strip() in ids))
            if not topic.chunk_ids and len(ids) == 1:
                # A one-chunk document: its only chunk is where every topic comes from.
                topic.chunk_ids = list(ids)
            elif not topic.chunk_ids:
                # The model cited chunks that do not exist: find the ones that clearly match the topic instead.
                matches = strong_matches(f"{topic.name} {topic.summary or ''}", chunks)
                topic.chunk_ids = [f"c{chunk.chunk_index}" for chunk in matches]
            if topic.chunk_ids and topic.name.casefold() not in seen:
                seen.add(topic.name.casefold())
                kept.append(topic)
        if not kept:
            raise ValueError("no topic cites a chunk of the document")
        topic_map.topics = kept

    request = prompts.topic_map_request(filename=document.filename, chunks=entries, shortened=shortened)
    topic_map = _ask_llm(db, llm, request, TopicMap, document_id=document.id, check=cited_only)
    db.execute(delete(DocumentTopic).where(DocumentTopic.document_id == document.id))
    db.add_all(
        DocumentTopic(
            document_id=document.id,
            name=topic.name,
            summary=topic.summary,
            chunk_ids=[str(ids[chunk_id].id) for chunk_id in topic.chunk_ids],
        )
        for topic in topic_map.topics
    )
    return topic_map


def _fail(db: Session, document: Document, reason: str) -> Document:
    db.rollback()
    document.status = DocumentStatus.FAILED
    document.summary_json = {"error": reason}
    db.commit()
    return document


def process(db: Session, document: Document, storage: FileStorage, llm: LLMClient) -> Document:
    """Extract, chunk and map a stored document. Ends READY, or FAILED with the reason."""
    document.status = DocumentStatus.PROCESSING
    document.summary_json = None
    db.commit()
    try:
        pages = extract(storage.path(document.storage_key))
    except ExtractionError as error:
        return _fail(db, document, str(error))
    chunks = save_chunks(db, document, chunk_pages(pages))
    try:
        topic_map = map_topics(db, llm, document, chunks)
    except LLMUnavailable:
        return _fail(db, document, "The model could not map the document's topics. Try processing it again.")
    numbered = [page.number for page in pages if page.number is not None]
    document.status = DocumentStatus.READY
    document.summary_json = {
        "summary": topic_map.summary,
        "pages": max(numbered) if numbered else None,
        "chunks": len(chunks),
        "characters": sum(len(page.text) for page in pages),
        "mapped_from": "openings" if sum(estimate_tokens(c.text) for c in chunks) > FULL_TEXT_TOKENS else "full text",
    }
    db.commit()
    return document


def topics_of(db: Session, document: Document) -> list[tuple[DocumentTopic, list[DocumentChunk]]]:
    """The document's topics, each with the chunks it cites, in chunk order."""
    chunks = {str(chunk.id): chunk for chunk in db.scalars(
        select(DocumentChunk).where(DocumentChunk.document_id == document.id).order_by(DocumentChunk.chunk_index)
    )}
    topics = db.scalars(select(DocumentTopic).where(DocumentTopic.document_id == document.id)).all()
    return [
        (topic, sorted((chunks[i] for i in topic.chunk_ids if i in chunks), key=lambda c: c.chunk_index))
        for topic in topics
    ]
