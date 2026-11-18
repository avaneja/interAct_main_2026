"""Finding a document's passages for a topic or question (README 2.2.1).

BM25 ranks chunks by the words they share with a query, weighting rare
words more and long chunks less. It runs in application code over one
document's chunks, so it needs no search engine or database extension.

source_passages decides what a question about a topic is built from:
the whole document when it fits the budget (the small-document
shortcut), else the topic's mapped chunks, else the best BM25 matches.
"""

import math
import re
from collections import Counter
from collections.abc import Sequence
from typing import Protocol, TypeVar

from app.services.tokens import estimate_tokens

K1 = 1.5
B = 0.75
_WORD = re.compile(r"[a-z0-9]+")
STOPWORDS = frozenset(
    "a an and are as at be by can do does for from has have how in is it its of on or that the this to was what "
    "when where which while who why will with you your their they them these those into than then there".split()
)


class HasText(Protocol):
    text: str


ChunkT = TypeVar("ChunkT", bound=HasText)


def terms(text: str) -> list[str]:
    """Lower-case words without stopwords, with a plural "s" removed so "folds" matches "fold"."""
    words = []
    for word in _WORD.findall(text.lower()):
        if word in STOPWORDS:
            continue
        if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
            word = word[:-1]
        words.append(word)
    return words


def bm25(query: str, chunks: Sequence[ChunkT]) -> list[tuple[ChunkT, float]]:
    """Every chunk with its BM25 score for `query`, best first; ties keep document order."""
    documents = [Counter(terms(chunk.text)) for chunk in chunks]
    if not documents:
        return []
    average = sum(sum(d.values()) for d in documents) / len(documents) or 1
    query_terms = set(terms(query))
    scores = []
    for chunk, counts in zip(chunks, documents):
        length = sum(counts.values())
        score = 0.0
        for term in query_terms:
            frequency = counts.get(term, 0)
            if not frequency:
                continue
            containing = sum(1 for d in documents if term in d)
            idf = math.log(1 + (len(documents) - containing + 0.5) / (containing + 0.5))
            score += idf * frequency * (K1 + 1) / (frequency + K1 * (1 - B + B * length / average))
        scores.append((chunk, score))
    return sorted(scores, key=lambda pair: -pair[1])


def strong_matches(query: str, chunks: Sequence[ChunkT], limit: int = 3) -> list[ChunkT]:
    """The chunks that clearly match `query`: at least 60% of the best score, which must be real."""
    ranked = bm25(query, chunks)
    if not ranked or ranked[0][1] < 1.0:
        return []
    best = ranked[0][1]
    return [chunk for chunk, score in ranked[:limit] if score >= 0.6 * best]


def source_passages(
    query: str, mapped: Sequence[ChunkT], everything: Sequence[ChunkT], budget_tokens: int
) -> list[ChunkT]:
    """The passages to build a question from, within `budget_tokens`, in document order (as given)."""
    def fits(chunks: Sequence[ChunkT]) -> bool:
        return sum(estimate_tokens(chunk.text) for chunk in chunks) <= budget_tokens

    if everything and fits(everything):
        return list(everything)
    pool = list(mapped) if mapped else [chunk for chunk, score in bm25(query, everything) if score > 0]
    chosen: list[ChunkT] = []
    for chunk, _ in bm25(query, pool):
        if fits([*chosen, chunk]):
            chosen.append(chunk)
    if not chosen and pool:
        chosen = [bm25(query, pool)[0][0]]  # One passage, even over the budget, rather than none.
    order = {id(chunk): index for index, chunk in enumerate(everything)}
    return sorted(chosen, key=lambda chunk: order.get(id(chunk), 0))
