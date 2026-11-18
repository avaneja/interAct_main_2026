"""Checking that a document question is grounded in its source (README 2.2.1).

A supporting quote counts only if it appears in the cited chunk, compared
after normalising case, spacing, quote marks and dashes, so a model cannot
cite a passage that does not say what it claims. Very short quotes are
not accepted: a few common words would match almost anywhere.
"""

import re
import unicodedata

MIN_QUOTE_WORDS = 5
_SPACES = re.compile(r"\s+")
_EDGES = "\"'“”‘’«»`.,;:!?…-–— ()[]"
_SAME = str.maketrans({"“": '"', "”": '"', "‘": "'", "’": "'", "–": "-", "—": "-", "‐": "-", "‑": "-"})


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).translate(_SAME).lower()
    text = text.replace("-\n", "").replace("...", " ").replace("…", " ")
    return _SPACES.sub(" ", text).strip()


def quote_problem(quote: str) -> str | None:
    """Why `quote` cannot serve as a supporting quote, or None."""
    if len(normalise(quote).strip(_EDGES).split()) < MIN_QUOTE_WORDS:
        return f"the supporting quote is shorter than {MIN_QUOTE_WORDS} words"
    return None


def quote_in(quote: str, text: str) -> bool:
    """True if `quote` appears in `text`, ignoring case, spacing, quote marks, dashes and edge punctuation."""
    needle = normalise(quote).strip(_EDGES)
    return bool(needle) and needle in normalise(text)
