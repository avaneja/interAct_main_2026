"""The interview service: every rule from README section 5, in one place.

Routes call these functions and only translate between HTTP and Python. The
rules this module enforces:

- A session cannot start until a valid context and config are confirmed.
- Only one unanswered question exists per session.
- Submitting the same answer twice creates no second answer, score or question;
  a different answer to an answered question is rejected.
- State is committed before a function returns, and an answer is committed
  before the LLM is asked to score it.
- When the LLM fails or returns invalid output after a limited number of
  tries, no score is written; resubmitting the same answer retries.
- Every LLM reply is stored raw in llm_calls, apart from the validated rows.
- Scores stay within the rubric: every criterion must match the rubric's name
  and maximum, and totals are computed. Evidence quotes not found in the
  answer are removed and counted.
- An answer that cannot support a confident score is flagged with the reason:
  non-answers are scored zero without a model call, and the model's own flag
  and an off-topic check cover the rest.
- A question that misses its requested style is regenerated once, then kept
  and flagged with the reason.

LLM calls happen without holding a row lock. Each one is committed to
llm_calls on its own, and the session is locked again and re-checked before
the result is applied.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import TypeVar

from pydantic import BaseModel, ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.llm import LLMClient, LLMError, LLMRequest
from app.models import (
    Answer,
    Document,
    Evaluation,
    InterviewSession,
    LLMCall,
    Question,
    Report,
    Rubric,
    User,
)
from app.core.config import get_settings
from app.models.enums import InputModel, SessionState, StyleStatus, ValidationStatus
from app.schemas import (
    AnswerEvaluation,
    CriterionScore,
    GeneratedQuestion,
    InterviewConfig,
    InterviewContext,
    StyleVerdict,
)
from app.services import prompts
from app.services.evidence import EvidenceCheck, non_answer_reason, shares_no_terms, verify_evidence
from app.services.question_styles import question_type_for, style_rule_problem
from app.services.rubrics import RubricSpec, rubric_for
from app.services.state_machine import Event, next_state

LLM_ATTEMPTS = 2
STYLE_ATTEMPTS = 2


class InterviewError(Exception):
    """Base for errors the API turns into responses."""


class NotFound(InterviewError):
    pass


class Conflict(InterviewError):
    """The request is valid but not allowed in the session's current state."""


class InvalidInput(InterviewError):
    pass


class LLMUnavailable(InterviewError):
    """The LLM failed or kept returning invalid output. Nothing was made up."""


@dataclass
class SubmitResult:
    session: InterviewSession
    next_question: Question | None


# Loading and moving sessions


def get_session(db: Session, user: User, session_id: uuid.UUID, *, lock: bool = False) -> InterviewSession:
    """The user's session, or NotFound. Other users' sessions look the same as missing ones."""
    query = select(InterviewSession).where(
        InterviewSession.id == session_id, InterviewSession.owner_id == user.id
    )
    if lock:
        query = query.with_for_update().execution_options(populate_existing=True)
    session = db.scalar(query)
    if session is None:
        raise NotFound("Interview session not found.")
    return session


def _move(session: InterviewSession, event: Event) -> None:
    session.state = next_state(session.state, event)


def list_sessions(db: Session, user: User) -> list[InterviewSession]:
    query = (
        select(InterviewSession)
        .where(InterviewSession.owner_id == user.id)
        .order_by(InterviewSession.created_at.desc())
    )
    return list(db.scalars(query))


def create_session(db: Session, user: User, input_model: InputModel) -> InterviewSession:
    session = InterviewSession(owner_id=user.id, input_model=input_model)
    db.add(session)
    db.commit()
    return session


# Preparing the plan


def set_context(
    db: Session, user: User, session_id: uuid.UUID, context: InterviewContext
) -> InterviewSession:
    session = get_session(db, user, session_id, lock=True)
    if session.state not in (SessionState.PREPARING, SessionState.CONFIGURING):
        raise Conflict("The context can only change before the plan is confirmed.")
    if context.input_model is not session.input_model:
        raise InvalidInput(f"This session is a {session.input_model} interview.")
    if context.document_id is not None:
        document = db.scalar(
            select(Document).where(Document.id == context.document_id, Document.owner_id == user.id)
        )
        if document is None:
            raise InvalidInput("The document was not found.")

    session.context_json = context.model_dump(mode="json")
    if session.state is SessionState.PREPARING:
        _move(session, Event.CONTEXT_READY)
    db.commit()
    return session


def set_config(
    db: Session, user: User, session_id: uuid.UUID, config: InterviewConfig
) -> InterviewSession:
    session = get_session(db, user, session_id, lock=True)
    if session.state is SessionState.PREPARING:
        raise Conflict("Set the interview context first.")
    if session.state is not SessionState.CONFIGURING:
        raise Conflict("The configuration can only change before the plan is confirmed.")
    session.config_json = config.model_dump(mode="json")
    db.commit()
    return session


def _confirmed_plan(session: InterviewSession) -> tuple[InterviewContext, InterviewConfig]:
    """The saved context and config, re-validated. Raises Conflict if either is missing or invalid."""
    missing = [
        name
        for name, value in (("context", session.context_json), ("configuration", session.config_json))
        if not value
    ]
    if missing:
        raise Conflict(f"The plan is incomplete: set the {' and '.join(missing)} first.")
    try:
        return (
            InterviewContext.model_validate(session.context_json),
            InterviewConfig.model_validate(session.config_json),
        )
    except ValidationError as error:
        raise Conflict("The saved plan is no longer valid; set it again.") from error


def confirm_plan(db: Session, user: User, session_id: uuid.UUID) -> InterviewSession:
    session = get_session(db, user, session_id, lock=True)
    _confirmed_plan(session)
    _move(session, Event.PLAN_CONFIRMED)
    db.commit()
    return session


# LLM calls


ParsedT = TypeVar("ParsedT", bound=BaseModel)


def _record_llm_call(
    db: Session, *, session_id: uuid.UUID, request: LLMRequest, model: str, raw: str, status: ValidationStatus
) -> None:
    db.add(
        LLMCall(
            session_id=session_id,
            purpose=request.purpose,
            model=model,
            prompt_version=prompts.PROMPT_VERSION,
            raw_output=raw,
            validation_status=status,
        )
    )
    db.commit()


def _ask_llm(
    db: Session,
    llm: LLMClient,
    request: LLMRequest,
    schema: type[ParsedT],
    *,
    session_id: uuid.UUID,
    check: Callable[[ParsedT], None] = lambda parsed: None,
) -> ParsedT:
    """Ask the LLM until it returns output that passes the schema and `check`.

    Every attempt is stored raw in llm_calls, valid or not. After
    LLM_ATTEMPTS failures this raises LLMUnavailable; it never returns a
    value the model did not produce.
    """
    for _ in range(LLM_ATTEMPTS):
        try:
            response = llm.complete(request)
        except LLMError as error:
            _record_llm_call(
                db, session_id=session_id, request=request, model=llm.model,
                raw=f"[provider error] {error}", status=ValidationStatus.INVALID,
            )
            continue
        try:
            parsed = schema.model_validate_json(response.text)
            check(parsed)
        except (ValidationError, ValueError):
            _record_llm_call(
                db, session_id=session_id, request=request, model=response.model,
                raw=response.text, status=ValidationStatus.INVALID,
            )
            continue
        _record_llm_call(
            db, session_id=session_id, request=request, model=response.model,
            raw=response.text, status=ValidationStatus.VALID,
        )
        return parsed
    raise LLMUnavailable(
        f"The model could not {request.purpose.replace('_', ' ')} after {LLM_ATTEMPTS} tries. "
        "Nothing was scored or created; try again."
    )


def _rubric_row(db: Session, spec: RubricSpec) -> Rubric:
    """The database row for a rubric version, created on first use."""
    query = select(Rubric).where(Rubric.name == spec.name, Rubric.version == spec.version)
    rubric = db.scalar(query)
    if rubric is None:
        db.add(
            Rubric(
                name=spec.name,
                version=spec.version,
                criteria_json=spec.criteria_json(),
                max_score=spec.max_score,
            )
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
        rubric = db.scalar(query)
    return rubric


def _questions(db: Session, session_id: uuid.UUID) -> list[Question]:
    return list(db.scalars(select(Question).where(Question.session_id == session_id).order_by(Question.sequence)))


def _unanswered(db: Session, session_id: uuid.UUID) -> Question | None:
    query = (
        select(Question)
        .outerjoin(Answer, Answer.question_id == Question.id)
        .where(Question.session_id == session_id, Answer.id.is_(None))
        .order_by(Question.sequence)
    )
    return db.scalar(query)


@dataclass
class CheckedQuestion:
    generated: GeneratedQuestion
    style_status: StyleStatus
    style_note: str | None = None


def _style_problem(db: Session, llm: LLMClient, session_id: uuid.UUID, question: GeneratedQuestion) -> str | None:
    """Why the question misses its requested style, or None if it fits.

    Rules run first. The LLM check runs only when the rules pass and
    STYLE_CHECK asks for it; if that check itself fails, the rules' pass stands.
    """
    problem = style_rule_problem(question.type, question.prompt)
    if problem or get_settings().style_check == "rules":
        return problem
    request = prompts.style_check_request(question_prompt=question.prompt, requested=question.type)
    try:
        verdict = _ask_llm(db, llm, request, StyleVerdict, session_id=session_id)
    except LLMUnavailable:
        return None
    if verdict.style is not question.type:
        return f"reads as {verdict.style}: {verdict.reason}"
    return None


def _generate_question(
    db: Session, llm: LLMClient, session: InterviewSession, sequence: int
) -> CheckedQuestion:
    """Generate a question in the planned style.

    An off-style question is regenerated; if the last try is still off-style
    it is kept and flagged with the reason, so a strict check never blocks
    an interview.
    """
    context, config = _confirmed_plan(session)
    question_type = question_type_for(config.question_type, sequence)
    competencies = context.subtopics or [context.topic]
    competency = competencies[(sequence - 1) % len(competencies)]
    request = prompts.question_request(
        context=context,
        config=config,
        sequence=sequence,
        question_type=question_type,
        competency=competency,
        previous_prompts=[q.prompt for q in _questions(db, session.id)],
    )

    def matches_request(question: GeneratedQuestion) -> None:
        if question.type is not question_type or question.difficulty is not config.difficulty:
            raise ValueError("the question does not match the requested type or difficulty")

    for _ in range(STYLE_ATTEMPTS):
        generated = _ask_llm(db, llm, request, GeneratedQuestion, session_id=session.id, check=matches_request)
        problem = _style_problem(db, llm, session.id, generated)
        if problem is None:
            return CheckedQuestion(generated, StyleStatus.PASSED)
    return CheckedQuestion(generated, StyleStatus.FLAGGED, problem)


def _add_question(
    db: Session, session: InterviewSession, checked: CheckedQuestion, sequence: int, rubric_id: uuid.UUID
) -> Question:
    generated = checked.generated
    question = Question(
        session_id=session.id,
        sequence=sequence,
        type=generated.type,
        competency=generated.competency,
        difficulty=generated.difficulty,
        prompt=generated.prompt,
        rubric_id=rubric_id,
        source_chunk_ids=[str(chunk_id) for chunk_id in generated.source_chunk_ids],
        supporting_quote=generated.supporting_quote,
        answer_key_json=generated.answer_key.model_dump() if generated.answer_key else None,
        style_status=checked.style_status,
        style_note=checked.style_note,
    )
    db.add(question)
    return question


# Running the interview


def start(db: Session, user: User, session_id: uuid.UUID, llm: LLMClient) -> Question:
    session = get_session(db, user, session_id)
    _confirmed_plan(session)
    next_state(session.state, Event.START)  # Fail fast before calling the LLM.
    checked = _generate_question(db, llm, session, sequence=1)
    rubric_id = _rubric_row(db, rubric_for(checked.generated.type)).id  # Before the lock: it may commit.

    session = get_session(db, user, session_id, lock=True)
    _move(session, Event.START)  # Re-checked: a parallel request may have started it.
    question = _add_question(db, session, checked, sequence=1, rubric_id=rubric_id)
    db.commit()
    return question


def current_question(db: Session, user: User, session_id: uuid.UUID) -> Question | None:
    session = get_session(db, user, session_id)
    if session.state not in (SessionState.IN_PROGRESS, SessionState.PAUSED):
        return None
    return _unanswered(db, session.id)


def submit_answer(
    db: Session, user: User, session_id: uuid.UUID, question_id: uuid.UUID, text: str, llm: LLMClient
) -> SubmitResult:
    answer = _save_answer(db, user, session_id, question_id, text)
    if answer is None:
        # Already fully processed: return where the interview is now.
        session = get_session(db, user, session_id)
        return SubmitResult(session=session, next_question=current_question(db, user, session_id))

    if db.scalar(select(Evaluation).where(Evaluation.answer_id == answer.id)) is None:
        _evaluate(db, llm, answer)
    return _advance(db, user, session_id, llm)


def _save_answer(
    db: Session, user: User, session_id: uuid.UUID, question_id: uuid.UUID, text: str
) -> Answer | None:
    """Store the answer and move to EVALUATING.

    Returns the answer still waiting to be scored or advanced, or None when
    this exact answer was already fully processed.
    """
    session = get_session(db, user, session_id, lock=True)
    question = db.scalar(select(Question).where(Question.id == question_id, Question.session_id == session.id))
    if question is None:
        raise NotFound("That question is not part of this interview.")

    existing = db.scalar(select(Answer).where(Answer.question_id == question.id))
    if existing is not None:
        if existing.text != text:
            raise Conflict("This question has already been answered.")
        latest = _questions(db, session.id)[-1]
        if session.state is SessionState.EVALUATING and question.id == latest.id:
            return existing  # A retry after a failed evaluation or next question.
        return None

    if session.state is not SessionState.IN_PROGRESS:
        next_state(session.state, Event.SUBMIT_ANSWER)  # Raises with the reason.
    active = _unanswered(db, session.id)
    if active is None or active.id != question.id:
        raise Conflict("Answer the current question first.")

    answer = Answer(question_id=question.id, session_id=session.id, text=text)
    db.add(answer)
    _move(session, Event.SUBMIT_ANSWER)
    try:
        db.commit()
    except IntegrityError:
        # A double-click raced us and saved the same question's answer first.
        db.rollback()
        return _save_answer(db, user, session_id, question_id, text)
    return answer


def _evaluate(db: Session, llm: LLMClient, answer: Answer) -> None:
    question = db.get(Question, answer.question_id)
    rubric = db.get(Rubric, question.rubric_id)
    criteria = rubric.criteria_json
    rubric_label = f"{rubric.name}-v{rubric.version}"

    non_answer = non_answer_reason(answer.text)
    if non_answer is not None:
        # Nothing to grade: score zero without asking a model, which might invent credit.
        checked = EvidenceCheck(_ungraded(criteria, question.competency, non_answer), verified=0, removed=[])
        insufficient_reason = non_answer
        evaluator_version = f"rule|{rubric_label}|non-answer"
    else:
        request = prompts.evaluation_request(
            question_prompt=question.prompt,
            question_type=question.type,
            difficulty=question.difficulty,
            competency=question.competency,
            answer=answer.text,
            criteria=criteria,
            answer_key=question.answer_key_json,
        )

        def matches_rubric(evaluation: AnswerEvaluation) -> None:
            returned = {(c.name, c.max_score) for c in evaluation.criteria}
            if returned != {(c["name"], c["max_score"]) for c in criteria}:
                raise ValueError("the evaluation does not score exactly the rubric's criteria")

        evaluation = _ask_llm(db, llm, request, AnswerEvaluation, session_id=answer.session_id, check=matches_rubric)
        # Quotes not found in the answer are dropped, so only the candidate's own words are shown.
        checked = verify_evidence(evaluation, answer.text)
        insufficient_reason = _insufficient_reason(db, checked.evaluation, question, answer)
        if insufficient_reason and not checked.evaluation.insufficient_evidence:
            checked.evaluation = checked.evaluation.model_copy(update={"insufficient_evidence": True})
        evaluator_version = f"{llm.model}|{rubric_label}|prompt-{prompts.PROMPT_VERSION}"

    db.add(
        Evaluation(
            answer_id=answer.id,
            scores_json={
                **checked.evaluation.model_dump(mode="json", exclude={"criteria"}),
                "insufficient_reason": insufficient_reason,
                "evidence": {"quotes_verified": checked.verified, "quotes_removed": len(checked.removed)},
            },
            evidence_json=[c.model_dump(mode="json") for c in checked.evaluation.criteria],
            evaluator_version=evaluator_version,
        )
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # A parallel retry stored its evaluation first.


def _ungraded(criteria: list[dict], competency: str, reason: str) -> AnswerEvaluation:
    return AnswerEvaluation(
        criteria=[
            CriterionScore(name=c["name"], score=0, max_score=c["max_score"], reason=f"Not graded: {reason}.")
            for c in criteria
        ],
        missing_concepts=[competency],
        insufficient_evidence=True,
    )


def _insufficient_reason(
    db: Session, evaluation: AnswerEvaluation, question: Question, answer: Answer
) -> str | None:
    """Why this answer cannot support a confident score, or None."""
    if evaluation.insufficient_evidence:
        return "the evaluator judged the answer too thin to grade with confidence"
    if evaluation.score == 0:
        context = db.get(InterviewSession, answer.session_id).context_json or {}
        reference = " ".join(
            [question.prompt, question.competency, context.get("topic", ""), *context.get("subtopics", [])]
        )
        if shares_no_terms(answer.text, reference):
            return "the answer does not address the question or its topic"
    return None


def _advance(db: Session, user: User, session_id: uuid.UUID, llm: LLMClient) -> SubmitResult:
    """After an answer is scored: finish the interview or ask the next question."""
    session = get_session(db, user, session_id)
    _, config = _confirmed_plan(session)
    asked = len(_questions(db, session.id))

    if asked >= config.question_count:
        session = get_session(db, user, session_id, lock=True)
        if session.state is SessionState.EVALUATING:
            _move(session, Event.BUDGET_REACHED)
            _write_report(db, session, ended_early=False)
            db.commit()
        return SubmitResult(session=session, next_question=None)

    checked = _generate_question(db, llm, session, sequence=asked + 1)
    rubric_id = _rubric_row(db, rubric_for(checked.generated.type)).id  # Before the lock: it may commit.
    session = get_session(db, user, session_id, lock=True)
    if session.state is SessionState.EVALUATING and _unanswered(db, session.id) is None:
        _add_question(db, session, checked, sequence=asked + 1, rubric_id=rubric_id)
        _move(session, Event.NEXT_QUESTION)
        db.commit()
    return SubmitResult(session=session, next_question=_unanswered(db, session.id))


def pause(db: Session, user: User, session_id: uuid.UUID) -> InterviewSession:
    session = get_session(db, user, session_id, lock=True)
    _move(session, Event.PAUSE)
    db.commit()
    return session


def resume(db: Session, user: User, session_id: uuid.UUID) -> InterviewSession:
    session = get_session(db, user, session_id, lock=True)
    _move(session, Event.RESUME)
    db.commit()
    return session


def finish(db: Session, user: User, session_id: uuid.UUID) -> InterviewSession:
    session = get_session(db, user, session_id, lock=True)
    _move(session, Event.END_EARLY)
    _write_report(db, session, ended_early=True)
    db.commit()
    return session


# Reports


def _write_report(db: Session, session: InterviewSession, *, ended_early: bool) -> None:
    """Build the report from stored, validated evaluations only. M2 adds LLM feedback."""
    _, config = _confirmed_plan(session)
    entries = []
    competencies: dict[str, dict[str, int]] = {}
    for question in _questions(db, session.id):
        answer = db.scalar(select(Answer).where(Answer.question_id == question.id))
        evaluation = (
            db.scalar(select(Evaluation).where(Evaluation.answer_id == answer.id)) if answer else None
        )
        entry = {
            "sequence": question.sequence,
            "type": question.type.value,
            "competency": question.competency,
            "prompt": question.prompt,
            "answer": answer.text if answer else None,
            "evaluation": None,
            "answer_key": question.answer_key_json if answer else None,
        }
        if evaluation is not None:
            entry["evaluation"] = {**evaluation.scores_json, "criteria": evaluation.evidence_json}
            totals = competencies.setdefault(question.competency, {"score": 0, "max_score": 0, "questions": 0})
            totals["score"] += evaluation.scores_json["score"]
            totals["max_score"] += evaluation.scores_json["max_score"]
            totals["questions"] += 1
        entries.append(entry)

    scored = [e["evaluation"] for e in entries if e["evaluation"]]
    db.add(
        Report(
            session_id=session.id,
            summary_json={
                "label": "Rubric-based practice estimate",
                "score": sum(e["score"] for e in scored),
                "max_score": sum(e["max_score"] for e in scored),
                "planned_questions": config.question_count,
                "answered_questions": len(scored),
                "ended_early": ended_early,
                "competencies": competencies,
                "questions": entries,
            },
        )
    )


def get_report(db: Session, user: User, session_id: uuid.UUID) -> Report:
    session = get_session(db, user, session_id)
    if session.state is not SessionState.COMPLETED:
        raise Conflict("The report is ready once the interview is completed.")
    return db.scalar(select(Report).where(Report.session_id == session.id))


def question_counts(db: Session, session_id: uuid.UUID) -> tuple[int, int]:
    """(questions asked, questions answered) for a session."""
    asked = db.scalar(select(func.count()).select_from(Question).where(Question.session_id == session_id))
    answered = db.scalar(select(func.count()).select_from(Answer).where(Answer.session_id == session_id))
    return asked, answered
