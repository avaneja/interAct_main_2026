"""Adaptive question selection: a transparent, rule-based policy (README "Adaptive policy").

Fixed mode is the research baseline: planned competencies in their set
order, and no follow-ups. Adaptive mode (the default):

1. Tracks how well each planned competency is covered so far. An answer
   (with its follow-up replies) of normal length counts 1, a thin one
   (fewer than THIN_WORDS words) 0.5, a non-answer ("I don't know", a
   word or two) 0.25, an unanswered question 0.
2. Asks the next question about the least-covered competency; ties go to
   the one asked least, then to plan order, so a strong interview still
   rotates like fixed mode.
3. Lets the interviewer follow up (at most two per question) and adds a
   rule-based follow-up when a reply is thin but not a non-answer and the
   model asked none.

Both modes keep the chosen style rotation, difficulty and question budget;
earlier questions are passed to the generator so none is repeated.
No answer is scored during the interview, so these are signals of
evidence, not of correctness.
"""

import re
from collections.abc import Sequence

from app.services.evidence import asks_for_answer_or_score, non_answer_reason

THIN_WORDS = 12
RULE_FOLLOW_UP = "Could you say a bit more about that, ideally with a concrete example?"


def _words(text: str) -> int:
    return len(re.findall(r"\w+", text))


def evidence(replies: Sequence[str]) -> float:
    """How much an answer and its follow-up replies tell about the competency, from 0 to 1."""
    if not replies:
        return 0.0
    joined = " ".join(replies)
    if all(non_answer_reason(reply) for reply in replies):
        return 0.25
    if _words(joined) < THIN_WORDS:
        return 0.5
    return 1.0


def next_competency(plan: Sequence[str], history: Sequence[tuple[str, float]]) -> str:
    """The least-covered planned competency, given (competency, evidence) for each planned question asked."""
    planned = list(dict.fromkeys(plan))
    coverage = {name: 0.0 for name in planned}
    asked = {name: 0 for name in planned}
    for name, amount in history:
        if name in coverage:
            coverage[name] += amount
            asked[name] += 1
    return min(planned, key=lambda name: (coverage[name], asked[name], planned.index(name)))


def needs_rule_follow_up(reply: str) -> bool:
    """A reply that says something, but too little to show what the candidate knows."""
    return (
        non_answer_reason(reply) is None
        and not asks_for_answer_or_score(reply)
        and _words(reply) < THIN_WORDS
    )
