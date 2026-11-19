"""The final interview report, built only from stored, validated data.

No model is called here, so nothing in the report can be made up: scores
come from validated evaluations, quotes have been checked against the
answers, and outlines were part of each validated evaluation.
"""

import uuid
from collections import Counter
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Answer, DocumentChunk, Evaluation, InterviewSession, Question
from app.models.enums import GroundingStatus, StyleStatus
from app.services.pages import page_segments
from app.services.delivery import summarise
from app.services.grounding import quote_in

LABEL = "Rubric-based practice estimate"
REVISE_BELOW_PERCENT = 60


def _percent(score: int, max_score: int) -> int | None:
    return round(100 * score / max_score) if max_score else None


def _aware(moment: datetime) -> datetime:
    # SQLite returns naive datetimes; PostgreSQL returns aware ones.
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def _sources(db: Session, question: Question) -> list[dict[str, Any]]:
    """Where a document question comes from: the pages of each cited chunk."""
    sources = []
    for chunk_id in question.source_chunk_ids:
        chunk = db.get(DocumentChunk, uuid.UUID(chunk_id))
        if chunk is None:
            continue
        # The page holding the verified quote, when the chunk knows its page breaks; else the chunk's span.
        on_page = [
            page
            for page, text in page_segments(chunk.text, chunk.page_starts)
            if page is not None and question.supporting_quote and quote_in(question.supporting_quote, text)
        ]
        if on_page:
            sources.append({"page": on_page[0], "page_end": on_page[0]})
        else:
            sources.append({"page": chunk.page, "page_end": chunk.page_end})
    return sources


def build_report(db: Session, session: InterviewSession, *, ended_early: bool) -> dict[str, Any]:
    context = session.context_json or {}
    config = session.config_json or {}
    asked = list(
        db.scalars(select(Question).where(Question.session_id == session.id).order_by(Question.sequence, Question.follow_up))
    )
    # Planned questions are reported and scored; follow-ups are listed under the question they follow.
    questions = [question for question in asked if question.follow_up == 0]
    follow_ups: dict[int, list[Question]] = {}
    for question in asked:
        if question.follow_up > 0:
            follow_ups.setdefault(question.sequence, []).append(question)

    entries: list[dict[str, Any]] = []
    competencies: dict[str, dict[str, Any]] = {}
    missing: Counter[str] = Counter()
    notices: list[str] = []
    low_confidence: list[int] = []
    off_style: list[int] = []
    instructed: list[int] = []
    ungrounded: list[int] = []
    quotes_removed = 0

    for question in questions:
        answer = db.scalar(select(Answer).where(Answer.question_id == question.id))
        evaluation = db.scalar(select(Evaluation).where(Evaluation.answer_id == answer.id)) if answer else None
        entry: dict[str, Any] = {
            "sequence": question.sequence,
            "type": question.type.value,
            "competency": question.competency,
            "difficulty": question.difficulty.value,
            "prompt": question.prompt,
            "answer": answer.text if answer else None,
            "follow_ups": [
                {"prompt": follow_up.prompt, "answer": reply.text if reply else None}
                for follow_up in follow_ups.get(question.sequence, [])
                for reply in [db.scalar(select(Answer).where(Answer.question_id == follow_up.id))]
            ],
            "evaluation": None,
            "better_answer_outline": [],
            # Revealed only once the question has been answered.
            "answer_key": question.answer_key_json if answer else None,
        }
        if question.grounding_status is not GroundingStatus.NOT_APPLICABLE:
            entry["grounding"] = {
                "status": question.grounding_status.value,
                "note": question.grounding_note,
                "sources": _sources(db, question),
                "supporting_quote": question.supporting_quote if answer else None,
            }
            if question.grounding_status is GroundingStatus.FLAGGED:
                ungrounded.append(question.sequence)
        if question.style_status is StyleStatus.FLAGGED:
            off_style.append(question.sequence)

        if evaluation is not None:
            scores = evaluation.scores_json
            entry["evaluation"] = {
                "score": scores["score"],
                "max_score": scores["max_score"],
                "percent": _percent(scores["score"], scores["max_score"]),
                "criteria": evaluation.evidence_json,
                "missing_concepts": scores.get("missing_concepts", []),
                "insufficient_evidence": scores.get("insufficient_evidence", False),
                "insufficient_reason": scores.get("insufficient_reason"),
            }
            entry["better_answer_outline"] = scores.get("better_answer_outline", [])
            if question.grounding_status is not GroundingStatus.NOT_APPLICABLE:
                entry["document_points"] = {
                    "supported": scores.get("document_supported", []),
                    "outside": scores.get("outside_knowledge", []),
                }
            totals = competencies.setdefault(question.competency, {"score": 0, "max_score": 0, "questions": 0})
            totals["score"] += scores["score"]
            totals["max_score"] += scores["max_score"]
            totals["questions"] += 1
            missing.update(concept.strip().lower() for concept in scores.get("missing_concepts", []))
            if scores.get("insufficient_evidence"):
                low_confidence.append(question.sequence)
            quotes_removed += scores.get("evidence", {}).get("quotes_removed", 0)
            if scores.get("instructions_removed"):
                instructed.append(question.sequence)
        entries.append(entry)

    for totals in competencies.values():
        totals["percent"] = _percent(totals["score"], totals["max_score"])

    planned = list(context.get("subtopics") or [context.get("topic")] if context else [])
    covered = [name for name in planned if name in competencies]
    not_covered = [name for name in planned if name not in competencies]
    weak = sorted(
        (name for name, totals in competencies.items() if (totals["percent"] or 0) < REVISE_BELOW_PERCENT),
        key=lambda name: competencies[name]["percent"] or 0,
    )

    if low_confidence:
        notices.append(
            f"{len(low_confidence)} answer(s) could not be graded with confidence "
            f"(question {', '.join(map(str, low_confidence))}); treat their scores with care."
        )
    if off_style:
        notices.append(
            f"Question {', '.join(map(str, off_style))} did not fully match the requested question style."
        )
    if ungrounded:
        notices.append(
            f"Question {', '.join(map(str, ungrounded))} could not be verified against your document; "
            "check it against your notes."
        )
    if instructed:
        notices.append(
            f"Answer {', '.join(map(str, instructed))} contained text addressed to the grader "
            "(for example, asking for full marks); it was removed before grading."
        )
    if quotes_removed:
        notices.append(
            f"{quotes_removed} quote(s) the grader attributed to you were not in your answers and were removed."
        )
    if ended_early:
        notices.append("The interview was ended early, so some planned questions were not asked.")

    graded = [e["evaluation"] for e in entries if e["evaluation"]]
    score = sum(e["score"] for e in graded)
    max_score = sum(e["max_score"] for e in graded)
    started_at = _aware(questions[0].created_at) if questions else _aware(session.created_at)

    return {
        "label": LABEL,
        "score": score,
        "max_score": max_score,
        "percent": _percent(score, max_score),
        "planned_questions": config.get("question_count"),
        "answered_questions": len(graded),
        "ended_early": ended_early,
        "duration_seconds": round((datetime.now(UTC) - started_at).total_seconds()),
        "configuration": config,
        "topic": context.get("topic"),
        "competencies": competencies,
        "coverage": {
            "planned": planned,
            "covered": covered,
            "not_covered": not_covered,
            "percent": _percent(len(covered), len(planned)),
        },
        "missing_concepts": [concept for concept, _ in missing.most_common(10)],
        "areas_to_revise": weak + [name for name in not_covered if name not in weak],
        "notices": notices,
        "questions": entries,
        # Document interviews only: how many questions were verified against the document.
        "grounding": _grounding(questions),
        # How answers were given (pace, fillers, focus); never part of the score above.
        "delivery": summarise(
            [a.delivery_json for a in db.scalars(select(Answer).where(Answer.session_id == session.id)) if a.delivery_json]
        ),
    }


def _grounding(questions: list[Question]) -> dict[str, Any] | None:
    checked = [q for q in questions if q.grounding_status is not GroundingStatus.NOT_APPLICABLE]
    if not checked:
        return None
    verified = sum(1 for q in checked if q.grounding_status is GroundingStatus.VERIFIED)
    return {
        "questions": len(checked),
        "verified": verified,
        "flagged": len(checked) - verified,
        "pass_rate": _percent(verified, len(checked)),
    }
