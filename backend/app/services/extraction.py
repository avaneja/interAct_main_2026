"""Text from uploaded documents, page by page (README 2.2.1).

PDFs are read with PyMuPDF, one entry per page, so every chunk and citation
keeps its page number. TXT files are one page, or several when the text
uses form feeds as page breaks. Scanned PDFs (pages that are images with
no text layer) are refused, because the MVP has no OCR.

Extraction limits keep a hostile or huge file from tying up the server:
at most MAX_PAGES pages and MAX_CHARS characters of text.
"""

import re
from dataclasses import dataclass
from pathlib import Path

import pymupdf

from app.services.interview import InvalidInput

MAX_PAGES = 300
MAX_CHARS = 1_500_000
# A text-based page has at least this many characters on average.
MIN_CHARS_PER_PAGE = 40

_SPACES = re.compile(r"[ \t ]+")
_BLANK_LINES = re.compile(r"\n{3,}")
_HYPHEN_BREAK = re.compile(r"(\w)-\n(\w)")


class ExtractionError(InvalidInput):
    """The document's text cannot be used; the message says why."""


class ScannedDocument(ExtractionError):
    pass


@dataclass(frozen=True)
class Page:
    number: int | None
    text: str


def tidy(text: str) -> str:
    """Normal spacing, words split across lines joined, at most one blank line in a row."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _HYPHEN_BREAK.sub(r"\1\2", text)
    lines = [_SPACES.sub(" ", line).strip() for line in text.split("\n")]
    return _BLANK_LINES.sub("\n\n", "\n".join(lines)).strip()


def _check_total(pages: list[Page]) -> list[Page]:
    if sum(len(page.text) for page in pages) > MAX_CHARS:
        raise ExtractionError("The document has too much text. Upload a shorter part, such as one chapter.")
    return pages


def extract_pdf(path: Path) -> list[Page]:
    try:
        document = pymupdf.open(path, filetype="pdf")
    except Exception as error:
        raise ExtractionError("The PDF could not be read. It may be damaged.") from error
    with document:
        if document.needs_pass:
            raise ExtractionError("The PDF is password-protected. Remove the password, then upload it again.")
        if document.page_count == 0:
            raise ExtractionError("The PDF has no pages.")
        if document.page_count > MAX_PAGES:
            raise ExtractionError(f"The PDF has more than {MAX_PAGES} pages. Upload a shorter part, such as one chapter.")
        pages: list[Page] = []
        images = 0
        for index, page in enumerate(document):
            pages.append(Page(index + 1, tidy(page.get_text("text"))))
            images += len(page.get_images(full=False))
    characters = sum(len(page.text) for page in pages)
    if characters < MIN_CHARS_PER_PAGE * len(pages):
        if images:
            raise ScannedDocument(
                "This PDF looks scanned: its pages are images without a text layer. InterAct can't read scanned "
                "documents yet. Upload a text-based PDF (one where you can select the text) or a TXT file."
            )
        raise ExtractionError("The PDF has almost no text to build questions from.")
    return _check_total([page for page in pages if page.text])


def extract_txt(path: Path) -> list[Page]:
    text = path.read_bytes().decode("utf-8-sig")
    parts = [tidy(part) for part in text.split("\f")]
    if len(parts) == 1:
        pages = [Page(None, parts[0])]
    else:
        pages = [Page(number, part) for number, part in enumerate(parts, start=1)]
    pages = [page for page in pages if page.text]
    if sum(len(page.text) for page in pages) < MIN_CHARS_PER_PAGE:
        raise ExtractionError("The file has almost no text to build questions from.")
    return _check_total(pages)


def extract(path: Path) -> list[Page]:
    """The document's text by page; raises ExtractionError with a message for the user."""
    if path.suffix == ".pdf":
        return extract_pdf(path)
    if path.suffix == ".txt":
        return extract_txt(path)
    raise ExtractionError("Only PDF and TXT files can be read.")
