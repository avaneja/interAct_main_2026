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


# Answers that give nothing to grade, compared after normalising.
NON_ANSWERS = {
    "i don't know", "i dont know", "dont know", "don't know", "idk", "no idea", "not sure",
    "i'm not sure", "im not sure", "pass", "skip", "n/a", "na", "nothing", "no comment",
}
MIN_WORDS = 3
STOPWORDS = {
    "about", "after", "again", "also", "because", "been", "before", "being", "between", "both",
    "could", "does", "doing", "down", "each", "from", "have", "having", "here", "into", "just",
    "like", "more", "most", "much", "only", "other", "over", "same", "should", "some", "such",
    "than", "that", "their", "them", "then", "there", "these", "they", "this", "those", "through",
    "under", "very", "what", "when", "where", "which", "while", "will", "with", "would", "your",
    "yours", "were", "make", "made", "thing", "things", "really", "think",
}


def non_answer_reason(answer: str) -> str | None:
    """Why the answer gives nothing to grade, or None if it does."""
    text = _normalise(answer).strip(" .!?")
    if text in NON_ANSWERS:
        return "the candidate said they do not know"
    if len(re.findall(r"\w+", text)) < MIN_WORDS:
        return "the answer is too short to grade"
    return None


def _content_words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z][a-z'-]{3,}", _normalise(text)) if w not in STOPWORDS}


def shares_no_terms(answer: str, reference: str) -> bool:
    """True if the answer uses none of the meaningful words of the question and its topic."""
    return not (_content_words(answer) & _content_words(reference))


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
