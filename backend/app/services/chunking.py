"""Page-aware chunks of a document's text (README 2.2.1).

Chunks hold roughly MIN_TOKENS to MAX_TOKENS tokens, aiming at
TARGET_TOKENS, and end at sentence boundaries. Each one starts with the
last OVERLAP_TOKENS or so of the one before, so an idea split between two
chunks appears whole in one of them. Each chunk keeps the first and last
page it covers.

Tokens are estimated from words (about four tokens for every three
words), which is close enough for sizing chunks; no tokenizer is needed.
"""

import re
from dataclasses import dataclass

from app.services.extraction import Page
from app.services.tokens import estimate_tokens

MIN_TOKENS = 400
TARGET_TOKENS = 600
MAX_TOKENS = 800
OVERLAP_TOKENS = 80

_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[\"'(\[A-Z0-9])|\n{2,}")


@dataclass(frozen=True)
class Chunk:
    index: int
    page: int | None
    page_end: int | None
    text: str

    @property
    def tokens(self) -> int:
        return estimate_tokens(self.text)


@dataclass(frozen=True)
class _Piece:
    page: int | None
    text: str
    tokens: float  # Not rounded, so sums match the estimate for the joined text.


def _pieces(pages: list[Page]) -> list[_Piece]:
    """Sentences (or paragraphs) with their page; anything longer than MIN_TOKENS is cut by words."""
    max_words = MIN_TOKENS * 3 // 4
    pieces: list[_Piece] = []
    for page in pages:
        for sentence in _SENTENCE_END.split(page.text):
            words = sentence.split()
            for start in range(0, len(words), max_words):
                text = " ".join(words[start : start + max_words])
                if text:
                    pieces.append(_Piece(page.number, text, len(text.split()) * 4 / 3))
    return pieces


def _chunk(index: int, pieces: list[_Piece]) -> Chunk:
    return Chunk(index, pieces[0].page, pieces[-1].page, " ".join(piece.text for piece in pieces))


def chunk_pages(pages: list[Page]) -> list[Chunk]:
    groups: list[list[_Piece]] = []
    current: list[_Piece] = []
    carried = 0  # How many pieces at the start of `current` repeat the end of the previous chunk.

    def size(pieces: list[_Piece]) -> int:
        return sum(piece.tokens for piece in pieces)

    for piece in _pieces(pages):
        has_new = len(current) > carried
        if has_new and (size(current) >= TARGET_TOKENS or size(current) + piece.tokens > MAX_TOKENS):
            groups.append(current)
            overlap = _overlap(current)
            # The overlap must leave room for new text in the next chunk.
            while overlap and size(overlap) + piece.tokens > MAX_TOKENS - OVERLAP_TOKENS:
                overlap.pop(0)
            current, carried = overlap, len(overlap)
        current.append(piece)

    if len(current) > carried:
        tail = current[carried:]
        if groups and size(current) < MIN_TOKENS:
            # A short last chunk joins the one before it, or the two share their text evenly.
            combined = groups[-1] + tail
            if size(combined) <= MAX_TOKENS:
                groups[-1] = combined
            else:
                half, split = size(combined) / 2, 0
                while size(combined[: split + 1]) < half:
                    split += 1
                first = combined[: split + 1]
                rest = combined[split + 1 :]
                overlap = _overlap(first)
                while overlap and size(overlap) + size(rest) > MAX_TOKENS:
                    overlap.pop(0)
                groups[-1] = first
                groups.append(overlap + rest)
        else:
            groups.append(current)
    return [_chunk(index, group) for index, group in enumerate(groups)]


def _overlap(pieces: list[_Piece]) -> list[_Piece]:
    """The last pieces of a chunk, about OVERLAP_TOKENS long, to start the next one with."""
    overlap: list[_Piece] = []
    for previous in reversed(pieces):
        if sum(piece.tokens for piece in overlap) >= OVERLAP_TOKENS:
            break
        overlap.insert(0, previous)
    return overlap
