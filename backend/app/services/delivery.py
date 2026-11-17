"""Delivery and focus: how an answer was given, not what it said.

The browser measures timing, tab switches and (with the camera on and the
candidate's consent) estimated eye contact. Words, pace and filler words are
counted here from the answer text. None of it is ever part of the rubric
score, and none of it infers emotion, personality or honesty.
"""

import re
from typing import Any

from app.schemas import DeliverySignals

# Unambiguous fillers only: "like", "actually" and "basically" are usually real words.
_FILLERS = re.compile(r"\b(um+|uh+|erm+|er|ah+|hmm+|you know|i mean|sort of|kind of)\b", re.IGNORECASE)
_WORD = re.compile(r"[A-Za-z0-9']+")
# Pace is not meaningful for very short answers.
MIN_SECONDS_FOR_PACE = 5

NOTE = (
    "These are estimates for practice: lighting, glasses, camera position and speech recognition affect them. "
    "They are never part of your score."
)


def count_words(text: str) -> int:
    return len(_WORD.findall(text))


def count_fillers(text: str) -> int:
    return len(_FILLERS.findall(text))


def delivery_record(text: str, signals: DeliverySignals) -> dict[str, Any]:
    """What is stored with one answer."""
    words = count_words(text)
    pace = None
    if signals.spoken and signals.answer_seconds >= MIN_SECONDS_FOR_PACE:
        pace = round(words / (signals.answer_seconds / 60))
    return {
        **signals.model_dump(mode="json"),
        "words": words,
        "filler_words": count_fillers(text),
        "words_per_minute": pace,
    }


def _weighted(records: list[dict[str, Any]], field: str) -> float | None:
    """A camera ratio averaged over answers, weighted by how long each answer took."""
    pairs = [(r["camera"][field], r["answer_seconds"]) for r in records if r.get("camera")]
    total = sum(seconds for _, seconds in pairs)
    if not pairs or total <= 0:
        return None
    return round(sum(value * seconds for value, seconds in pairs) / total, 2)


def summarise(records: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The report's Delivery and focus section, or None when nothing was measured."""
    if not records:
        return None
    spoken = [r for r in records if r["spoken"] and r["answer_seconds"] >= MIN_SECONDS_FOR_PACE]
    spoken_minutes = sum(r["answer_seconds"] for r in spoken) / 60
    words = sum(r["words"] for r in records)
    with_camera = [r for r in records if r.get("camera")]
    return {
        "answers_measured": len(records),
        "speaking_seconds": round(sum(r["answer_seconds"] for r in records)),
        "words_per_minute": round(sum(r["words"] for r in spoken) / spoken_minutes) if spoken_minutes else None,
        "filler_words": sum(r["filler_words"] for r in records),
        "fillers_per_100_words": round(100 * sum(r["filler_words"] for r in records) / words, 1) if words else None,
        "tab_switches": sum(r["tab_switches"] for r in records),
        "seconds_away": round(sum(r["seconds_away"] for r in records)),
        "fullscreen_exits": sum(r["fullscreen_exits"] for r in records),
        "camera": {
            "answers": len(with_camera),
            "looking_away_ratio": _weighted(with_camera, "looking_away_ratio"),
            "look_aways": sum(r["camera"]["look_aways"] for r in with_camera),
            "face_missing_ratio": _weighted(with_camera, "face_missing_ratio"),
            "multiple_faces_ratio": _weighted(with_camera, "multiple_faces_ratio"),
        }
        if with_camera
        else None,
        "note": NOTE,
    }
