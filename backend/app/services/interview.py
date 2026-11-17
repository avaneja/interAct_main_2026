"""The interview service: every rule from README section 5, in one place.

Routes call these functions and only translate between HTTP and Python. The
rules this module enforces:

- A session cannot start until a valid context and config are confirmed.
- Only one unanswered question exists per session.
- Submitting the same answer twice creates no second answer, score or question;
  a different answer to an answered question is rejected.
- State is committed before a function returns, and an answer is committed
  before any LLM call that depends on it.
- Answers are scored when the interview is finished, not after each answer,
  so the conversation never waits for scoring. After the last planned
  answer the interview is in its wrap-up (in progress, no question waiting)
  until it is finished. A score already stored is kept if a later one
  fails, so finishing again continues where scoring stopped.
- When the LLM fails or returns invalid output after a limited number of
  tries, no score is written; resubmitting the same answer retries.
- Every LLM reply is stored raw in llm_calls, apart from the validated rows.
- Scores stay within the rubric: every criterion must match the rubric's name
  and maximum, and totals are computed. Evidence quotes not found in the
  answer are removed and counted.
- An answer that cannot support a confident score is flagged with the reason:
  non-answers are scored zero without a model call, and the model's own flag
  and an off-topic check cover the rest.
- Sentences in an answer that try to instruct the grader are removed before
  grading, and the report says so.
- A question that misses its requested style is regenerated once, then kept
  and flagged with the reason.
- The next planned question is written in the background while the
  candidate answers (prepare_next_question) and kept on the session until
  it is asked; if it is not ready, it is written when needed.
- After each reply the interviewer reacts to it and either asks a follow-up
  (at most MAX_FOLLOW_UPS per planned question) or moves on with a
  transition. Follow-ups do not count toward the question budget; each
  planned question is scored together with its follow-ups. If the model
  fails at this step, the interview simply moves on without a reaction.

LLM calls happen without holding a row lock. Each one is committed to
llm_calls on its own, and the session is locked again and re-checked before
the result is applied.
"""

import re
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
from app.models.enums import AuthProvider, InputModel, SessionState, StyleStatus, ValidationStatus
from app.schemas import (
    AnswerEvaluation,
    CriterionScore,
    DeliverySignals,
    GeneratedQuestion,
    InterviewConfig,
    InterviewContext,
    InterviewerTurn,
    SmallTalk,
    StyleVerdict,
    SuggestedSubtopics,
)
from app.services import prompts
from app.services.delivery import delivery_record
from app.services.evidence import (
    REMOVED_MARKER,
    EvidenceCheck,
    asks_for_answer_or_score,
    non_answer_reason,
    remove_grader_instructions,
    shares_no_terms,
    verify_evidence,
)
from app.services.question_styles import competency_for, question_type_for, style_rule_problem
from app.services.reporting import build_report
from app.services.rubrics import RubricSpec, rubric_for
from app.services.state_machine import Event, next_state

LLM_ATTEMPTS = 2
STYLE_ATTEMPTS = 2
MAX_FOLLOW_UPS = 2


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
    # What the interviewer says about the answer just given.
    reaction: str | None = None


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


_VAGUE = re.compile(
    r"\b(all|every|everything|any|anything|general|generic|basics?|overall|whole|entire|misc\w*|various)\b",
    re.IGNORECASE,
)


def needs_subtopics(context: InterviewContext) -> bool:
    """True if a topic interview has no subtopics, or only vague ones like "All DSA topics"."""
    if context.input_model is not InputModel.TOPIC:
        return False
    topic = context.topic.casefold()
    return all(_VAGUE.search(subtopic) or subtopic.casefold() == topic for subtopic in context.subtopics)


def _suggest_subtopics(db: Session, llm: LLMClient, session_id: uuid.UUID, context: InterviewContext) -> InterviewContext:
    """The context with concrete subtopics from the model, or unchanged if the model fails."""
    try:
        suggested = _ask_llm(db, llm, prompts.subtopics_request(context=context), SuggestedSubtopics, session_id=session_id)
    except LLMUnavailable:
        return context
    return context.model_copy(update={"subtopics": suggested.subtopics})


def set_context(
    db: Session, user: User, session_id: uuid.UUID, context: InterviewContext, llm: LLMClient | None = None
) -> InterviewSession:
    """Save what the interview is about. With a model, missing or vague subtopics
    are replaced by concrete ones it suggests; the candidate can change them."""
    session = get_session(db, user, session_id)
    _check_context(db, user, session, context)
    if llm is not None and needs_subtopics(context):
        context = _suggest_subtopics(db, llm, session.id, context)  # Without a lock: it calls the model.

    session = get_session(db, user, session_id, lock=True)
    _check_context(db, user, session, context)
    session.context_json = context.model_dump(mode="json")
    if session.state is SessionState.PREPARING:
        _move(session, Event.CONTEXT_READY)
    db.commit()
    return session


def _check_context(db: Session, user: User, session: InterviewSession, context: InterviewContext) -> None:
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
            prompt_version=request.prompt_version,
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
    """Every question asked so far, follow-ups included, in the order asked."""
    query = select(Question).where(Question.session_id == session_id).order_by(Question.sequence, Question.follow_up)
    return list(db.scalars(query))


def _planned_asked(db: Session, session_id: uuid.UUID) -> int:
    query = select(func.count()).select_from(Question).where(
        Question.session_id == session_id, Question.follow_up == 0
    )
    return db.scalar(query)


def _unanswered(db: Session, session_id: uuid.UUID) -> Question | None:
    query = (
        select(Question)
        .outerjoin(Answer, Answer.question_id == Question.id)
        .where(Question.session_id == session_id, Answer.id.is_(None))
        .order_by(Question.sequence, Question.follow_up)
    )
    return db.scalar(query)


def _exchange(db: Session, question: Question) -> list[tuple[Question, Answer]]:
    """A planned question and its follow-ups, each with its answer, for those answered so far."""
    query = (
        select(Question, Answer)
        .join(Answer, Answer.question_id == Question.id)
        .where(Question.session_id == question.session_id, Question.sequence == question.sequence)
        .order_by(Question.follow_up)
    )
    return [(asked, given) for asked, given in db.execute(query).all()]


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
    competency = competency_for(context.topic, context.subtopics, sequence)
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


def _prepared(session: InterviewSession, sequence: int) -> CheckedQuestion | None:
    """The question prepared in the background for `sequence`, if there is a usable one."""
    prepared = session.prepared_json
    if not prepared or prepared.get("sequence") != sequence:
        return None
    try:
        return CheckedQuestion(
            GeneratedQuestion.model_validate(prepared["question"]),
            StyleStatus(prepared["style_status"]),
            prepared.get("style_note"),
        )
    except (KeyError, ValueError, ValidationError):
        return None


def prepare_next_question(db: Session, session_id: uuid.UUID, llm: LLMClient) -> None:
    """Write the next planned question ahead of time, while the candidate answers.

    Runs after the response, in the background. It changes nothing the
    candidate can see: the question is kept on the session and only asked
    when the interview moves on. A model failure is ignored; the question is
    then written when it is needed.
    """
    session = db.get(InterviewSession, session_id)
    if session is None or session.state is not SessionState.IN_PROGRESS:
        return
    try:
        _, config = _confirmed_plan(session)
    except Conflict:
        return
    planned = _planned_asked(db, session.id)
    sequence = planned + 1
    if sequence > config.question_count or _prepared(session, sequence) is not None:
        return
    try:
        checked = _generate_question(db, llm, session, sequence)  # Without a lock: it calls the model.
    except LLMUnavailable:
        return
    query = (
        select(InterviewSession)
        .where(InterviewSession.id == session_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    session = db.scalar(query)
    if _planned_asked(db, session.id) != planned:
        return  # The interview moved on while this was being written.
    session.prepared_json = {
        "sequence": sequence,
        "question": checked.generated.model_dump(mode="json"),
        "style_status": checked.style_status.value,
        "style_note": checked.style_note,
    }
    db.commit()


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
    db: Session,
    user: User,
    session_id: uuid.UUID,
    question_id: uuid.UUID,
    text: str,
    llm: LLMClient,
    delivery: DeliverySignals | None = None,
) -> SubmitResult:
    answer = _save_answer(db, user, session_id, question_id, text, delivery)
    if answer is None:
        # Already fully processed: return where the interview is now, with the same reaction.
        session = get_session(db, user, session_id)
        given = db.scalar(select(Answer).where(Answer.question_id == question_id))
        return SubmitResult(
            session=session,
            next_question=current_question(db, user, session_id),
            reaction=given.reaction if given else None,
        )

    return _advance(db, user, session_id, llm)


def _save_answer(
    db: Session,
    user: User,
    session_id: uuid.UUID,
    question_id: uuid.UUID,
    text: str,
    delivery: DeliverySignals | None = None,
) -> Answer | None:
    """Store the answer and move to EVALUATING.

    Returns the answer still waiting for the interview to move on, or None
    when this exact answer was already fully processed.
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
            return existing  # A retry after a failed next step.
        return None

    if session.state is not SessionState.IN_PROGRESS:
        next_state(session.state, Event.SUBMIT_ANSWER)  # Raises with the reason.
    active = _unanswered(db, session.id)
    if active is None or active.id != question.id:
        raise Conflict("Answer the current question first.")

    answer = Answer(
        question_id=question.id,
        session_id=session.id,
        text=text,
        delivery_json=delivery_record(text, delivery) if delivery else None,
    )
    db.add(answer)
    _move(session, Event.SUBMIT_ANSWER)
    try:
        db.commit()
    except IntegrityError:
        # A double-click raced us and saved the same question's answer first.
        db.rollback()
        return _save_answer(db, user, session_id, question_id, text, delivery)
    return answer


def _score_answers(db: Session, llm: LLMClient, session: InterviewSession) -> None:
    """Score every answer that has no score yet, in question order.

    Each score is committed as soon as it is made, so if the model fails
    part way, the scores already made are kept and a retry continues.
    """
    query = (
        select(Answer)
        .join(Question, Question.id == Answer.question_id)
        .outerjoin(Evaluation, Evaluation.answer_id == Answer.id)
        # Follow-up answers are scored as part of their planned question's answer.
        .where(Answer.session_id == session.id, Question.follow_up == 0, Evaluation.id.is_(None))
        .order_by(Question.sequence)
    )
    for answer in list(db.scalars(query)):
        _evaluate(db, llm, answer)


def _evaluate(db: Session, llm: LLMClient, answer: Answer) -> None:
    """Score a planned question's answer together with the candidate's replies to its follow-ups."""
    question = db.get(Question, answer.question_id)
    rubric = db.get(Rubric, question.rubric_id)
    criteria = rubric.criteria_json
    rubric_label = f"{rubric.name}-v{rubric.version}"
    follow_ups = [(asked, given) for asked, given in _exchange(db, question) if asked.follow_up > 0]

    # Sentences that try to instruct the grader never reach the model.
    graded_text, instructions_removed = remove_grader_instructions(answer.text)
    replies = [graded_text]
    for asked, given in follow_ups:
        graded_reply, removed = remove_grader_instructions(given.text)
        instructions_removed += removed
        replies.append(graded_reply)
        graded_text += f"\n\nFollow-up question: {asked.prompt}\nCandidate's reply: {graded_reply}"
    # Everything the candidate said, for checking quotes: never the interviewer's own words.
    candidate_text = "\n".join([answer.text, *(given.text for _, given in follow_ups)])

    reasons = [non_answer_reason(reply.replace(REMOVED_MARKER, "")) for reply in replies]
    non_answer = reasons[0] if all(reasons) else None
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
            answer=graded_text,
            criteria=criteria,
            answer_key=question.answer_key_json,
        )

        def matches_rubric(evaluation: AnswerEvaluation) -> None:
            returned = {(c.name, c.max_score) for c in evaluation.criteria}
            if returned != {(c["name"], c["max_score"]) for c in criteria}:
                raise ValueError("the evaluation does not score exactly the rubric's criteria")

        evaluation = _ask_llm(db, llm, request, AnswerEvaluation, session_id=answer.session_id, check=matches_rubric)
        # Quotes not found in the answer are dropped, so only the candidate's own words are shown.
        checked = verify_evidence(evaluation, candidate_text)
        insufficient_reason = _insufficient_reason(db, checked.evaluation, question, answer, candidate_text)
        if insufficient_reason and not checked.evaluation.insufficient_evidence:
            checked.evaluation = checked.evaluation.model_copy(update={"insufficient_evidence": True})
        evaluator_version = f"{llm.model}|{rubric_label}|{request.prompt_version}"

    db.add(
        Evaluation(
            answer_id=answer.id,
            scores_json={
                **checked.evaluation.model_dump(mode="json", exclude={"criteria"}),
                "insufficient_reason": insufficient_reason,
                "instructions_removed": instructions_removed,
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
    db: Session, evaluation: AnswerEvaluation, question: Question, answer: Answer, candidate_text: str
) -> str | None:
    """Why this answer cannot support a confident score, or None."""
    if evaluation.insufficient_evidence:
        return "the evaluator judged the answer too thin to grade with confidence"
    if evaluation.score == 0:
        context = db.get(InterviewSession, answer.session_id).context_json or {}
        reference = " ".join(
            [question.prompt, question.competency, context.get("topic", ""), *context.get("subtopics", [])]
        )
        if shares_no_terms(candidate_text, reference):
            return "the answer does not address the question or its topic"
    return None


def _first_name(user: User) -> str | None:
    # The development sign-in's "Local test user" is not a person's name.
    if user.auth_provider is AuthProvider.DEV:
        return None
    name = (user.display_name or "").strip()
    return name.split()[0] if name else None


def _interviewer_turn(
    db: Session,
    llm: LLMClient,
    session: InterviewSession,
    user: User,
    latest: Question,
    next_focus: str | None,
) -> InterviewerTurn:
    """What the interviewer says after the latest reply. Never raises: on a model
    failure the interview just moves on without a reaction."""
    context, _ = _confirmed_plan(session)
    follow_ups_left = MAX_FOLLOW_UPS - latest.follow_up
    exchange = [(asked.prompt, given.text) for asked, given in _exchange(db, latest)]
    request = prompts.interviewer_turn_request(
        topic=context.topic,
        candidate_name=_first_name(user),
        exchange=exchange,
        follow_ups_left=follow_ups_left,
        next_focus=next_focus,
        asks_for_help=asks_for_answer_or_score(exchange[-1][1]),
    )
    try:
        turn = _ask_llm(db, llm, request, InterviewerTurn, session_id=session.id)
    except LLMUnavailable:
        return InterviewerTurn()
    # The limits hold even if the model ignores them.
    if follow_ups_left <= 0:
        turn.follow_up = None
    if next_focus is None:
        turn.transition = ""
    return turn


def _spoken(*parts: str) -> str | None:
    return " ".join(part.strip() for part in parts if part and part.strip()) or None


def _advance(db: Session, user: User, session_id: uuid.UUID, llm: LLMClient) -> SubmitResult:
    """After a reply: the interviewer reacts, then asks a follow-up, asks the next
    planned question, or, after the last one, moves to the wrap-up."""
    session = get_session(db, user, session_id)
    context, config = _confirmed_plan(session)
    latest = _questions(db, session.id)[-1]
    planned = _planned_asked(db, session.id)
    last = planned >= config.question_count
    next_focus = None if last else competency_for(context.topic, context.subtopics, planned + 1)

    turn = _interviewer_turn(db, llm, session, user, latest, next_focus)
    reaction = _spoken(turn.reaction)
    replied_to = db.scalar(select(Answer).where(Answer.question_id == latest.id))

    def keep_reaction() -> None:
        # Stored with the step it belongs to, so a repeated submit gets the same reply.
        if replied_to.reaction is None:
            replied_to.reaction = reaction

    if turn.follow_up:
        session = get_session(db, user, session_id, lock=True)
        if session.state is SessionState.EVALUATING and _unanswered(db, session.id) is None:
            db.add(
                Question(
                    session_id=session.id,
                    sequence=latest.sequence,
                    follow_up=latest.follow_up + 1,
                    type=latest.type,
                    competency=latest.competency,
                    difficulty=latest.difficulty,
                    prompt=turn.follow_up,
                    lead_in=reaction,
                    rubric_id=latest.rubric_id,
                )
            )
            keep_reaction()
            _move(session, Event.NEXT_QUESTION)
            db.commit()
        return SubmitResult(session=session, next_question=_unanswered(db, session.id), reaction=replied_to.reaction)

    if last:
        # The wrap-up: no question waits; finishing scores everything and writes the report.
        session = get_session(db, user, session_id, lock=True)
        if session.state is SessionState.EVALUATING:
            keep_reaction()
            _move(session, Event.NEXT_QUESTION)
            db.commit()
        return SubmitResult(session=session, next_question=None, reaction=replied_to.reaction)

    # Usually written in the background while the candidate answered; otherwise now.
    checked = _prepared(session, planned + 1) or _generate_question(db, llm, session, sequence=planned + 1)
    rubric_id = _rubric_row(db, rubric_for(checked.generated.type)).id  # Before the lock: it may commit.
    session = get_session(db, user, session_id, lock=True)
    if session.state is SessionState.EVALUATING and _unanswered(db, session.id) is None:
        question = _add_question(db, session, checked, sequence=planned + 1, rubric_id=rubric_id)
        question.lead_in = _spoken(turn.reaction, turn.transition)
        session.prepared_json = None
        keep_reaction()
        _move(session, Event.NEXT_QUESTION)
        db.commit()
    return SubmitResult(session=session, next_question=_unanswered(db, session.id), reaction=replied_to.reaction)


def retry(db: Session, user: User, session_id: uuid.UUID, llm: LLMClient) -> SubmitResult:
    """Finish the step a model failure interrupted: the interviewer's next step after the last answer.

    The same as resubmitting the last answer, for a client that no longer has
    its text. Safe to call twice: a second call finds nothing left to do.
    """
    session = get_session(db, user, session_id)
    if session.state is not SessionState.EVALUATING:
        raise Conflict("Nothing is waiting to be retried.")
    return _advance(db, user, session_id, llm)


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


def finish(db: Session, user: User, session_id: uuid.UUID, llm: LLMClient) -> InterviewSession:
    """Finish the interview: score every answer, then write the report.

    Called after the wrap-up, or earlier to end early. If scoring fails, the
    interview stays open and finishing again continues it.
    """
    session = get_session(db, user, session_id)
    next_state(session.state, Event.FINISH)  # Fail fast before calling the model.
    _, config = _confirmed_plan(session)
    _score_answers(db, llm, session)
    session = get_session(db, user, session_id, lock=True)
    _move(session, Event.FINISH)
    _, answered = question_counts(db, session.id)
    _write_report(db, session, ended_early=answered < config.question_count)
    db.commit()
    return session


def in_wrap_up(db: Session, session: InterviewSession) -> bool:
    """True after the last planned answer, before the interview is finished."""
    if session.state is not SessionState.IN_PROGRESS or not session.config_json:
        return False
    _, answered = question_counts(db, session.id)
    return answered >= session.config_json["question_count"] and _unanswered(db, session.id) is None


# Small talk around the questions: not scored.

WARM_UP_FALLBACK = "Thanks for sharing that. Let's get into the questions."
CLOSING_FALLBACK = "Sorry, I didn't quite catch that. Do you have any other questions for me?"
ANY_OTHER_QUESTIONS = "Do you have any other questions?"
_SENTENCES = re.compile(r"(?<=[.!?])\s+")


def _warm_up_words(reply: str) -> str:
    """The warm-up reply without questions, since the call moves on to the interview
    questions straight after it, ending by saying so."""
    kept = [sentence for sentence in _SENTENCES.split(reply.strip()) if sentence and not sentence.endswith("?")]
    if not kept:
        return WARM_UP_FALLBACK
    words = " ".join(kept)
    if "question" not in words.lower():
        words += " Let's get into the questions."
    return words


def _closing_words(reply: str, done: bool) -> str:
    """The closing reply, ending with an invitation to ask more unless the call is over."""
    if not done and not reply.rstrip().endswith("?"):
        return f"{reply.rstrip()} {ANY_OTHER_QUESTIONS}"
    return reply
_NOTHING_MORE = re.compile(
    r"^\W*(no|nope|nah|none|nothing|not really|i'?m good|i'?m fine|that'?s (all|it|everything)|"
    r"no(,)? (thanks|thank you|more questions|questions)|thanks?( you)?|bye|goodbye)\b",
    re.IGNORECASE,
)


@dataclass
class ChatReply:
    reply: str
    done: bool


def chat(db: Session, user: User, session_id: uuid.UUID, stage: str, text: str, llm: LLMClient) -> ChatReply:
    """The interviewer's reply in the warm-up ("tell me about yourself") or the closing
    ("any questions for me?"). Nothing here is scored, and a model failure never
    stops the interview: a plain fallback line is used instead."""
    session = get_session(db, user, session_id)
    context, _ = _confirmed_plan(session)
    name = _first_name(user)
    if stage == "warm_up":
        if session.state is not SessionState.IN_PROGRESS:
            raise Conflict("The warm-up is part of a running interview.")
        request = prompts.warm_up_request(topic=context.topic, candidate_name=name, introduction=text)
        try:
            reply = _ask_llm(db, llm, request, SmallTalk, session_id=session.id)
        except LLMUnavailable:
            return ChatReply(WARM_UP_FALLBACK, done=True)
        return ChatReply(_warm_up_words(reply.reply), done=True)

    if not in_wrap_up(db, session):
        raise Conflict("Questions for the interviewer come after the last question.")
    nothing_more = bool(_NOTHING_MORE.match(text))
    request = prompts.closing_request(topic=context.topic, candidate_name=name, question=text)
    try:
        reply = _ask_llm(db, llm, request, SmallTalk, session_id=session.id)
    except LLMUnavailable:
        if nothing_more:
            return ChatReply(f"Thanks for your time{', ' + name if name else ''}. Goodbye.", done=True)
        return ChatReply(CLOSING_FALLBACK, done=False)
    done = reply.done or nothing_more
    return ChatReply(_closing_words(reply.reply, done), done=done)


# Reports


def _write_report(db: Session, session: InterviewSession, *, ended_early: bool) -> None:
    db.add(Report(session_id=session.id, summary_json=build_report(db, session, ended_early=ended_early)))


def get_report(db: Session, user: User, session_id: uuid.UUID) -> Report:
    session = get_session(db, user, session_id)
    if session.state is not SessionState.COMPLETED:
        raise Conflict("The report is ready once the interview is completed.")
    return db.scalar(select(Report).where(Report.session_id == session.id))


def question_counts(db: Session, session_id: uuid.UUID) -> tuple[int, int]:
    """(planned questions asked, planned questions answered) for a session. Follow-ups are not counted."""
    answered = db.scalar(
        select(func.count())
        .select_from(Answer)
        .join(Question, Question.id == Answer.question_id)
        .where(Answer.session_id == session_id, Question.follow_up == 0)
    )
    return _planned_asked(db, session_id), answered
