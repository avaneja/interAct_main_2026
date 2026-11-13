"""Checks that evidence quotes really come from the candidate's answer.

A model sometimes "quotes" words the candidate never wrote. Such a quote is
removed from the stored evaluation (the raw reply stays in llm_calls) and
counted, so the report never presents the model's paraphrase as the
candidate's words, and the evidence support rate can be measured.
"""

import re
from dataclasses import dataclass

from app.schemas import AnswerEvaluation

QUOTE_MARKS = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"'})
ELLIPSIS = re.compile(r"\.\.\.|…")


def _normalise(text: str) -> str:
    text = text.translate(QUOTE_MARKS).casefold()
    return " ".join(text.split())


def quote_in_answer(quote: str, answer: str) -> bool:
    """True if the quote appears in the answer.

    Case, spacing and curly quote marks are ignored, as are quote marks and
    punctuation around the quote. An ellipsis may stand for skipped words, as
    long as the pieces appear in order.
    """
    haystack = _normalise(answer)
    position = 0
    pieces = [_normalise(piece).strip(" \"'.,;:") for piece in ELLIPSIS.split(quote)]
    pieces = [piece for piece in pieces if piece]
    if not pieces:
        return False
    for piece in pieces:
        found = haystack.find(piece, position)
        if found == -1:
            return False
        position = found + len(piece)
    return True


@dataclass
class EvidenceCheck:
    evaluation: AnswerEvaluation
    verified: int
    removed: list[str]


def verify_evidence(evaluation: AnswerEvaluation, answer: str) -> EvidenceCheck:
    """Keep only quotes found in the answer; report how many were removed."""
    verified, removed = 0, []
    criteria = []
    for criterion in evaluation.criteria:
        quote = criterion.evidence_quote
        if quote is not None and not quote_in_answer(quote, answer):
            removed.append(quote)
            criterion = criterion.model_copy(update={"evidence_quote": None})
        elif quote is not None:
            verified += 1
        criteria.append(criterion)
    return EvidenceCheck(evaluation.model_copy(update={"criteria": criteria}), verified, removed)
