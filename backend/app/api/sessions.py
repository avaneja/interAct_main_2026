"""Sessions API. Each route calls the interview service and shapes the response."""

import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import ValidationError

from app.api.deps import LLM, CurrentUser, DbSession
from app.models import InterviewSession
from app.models.enums import SessionState
from app.schemas import InterviewConfig, InterviewContext, QuestionView
from app.schemas.api import AnswerResult, AnswerSubmit, PlannedQuestion, ReportView, SessionCreate, SessionView
from app.services import interview as svc
from app.services.question_styles import competency_for, mix_plan

router = APIRouter(prefix="/api/v1/sessions", tags=["sessions"])


def _plan(session: InterviewSession) -> list[PlannedQuestion] | None:
    if not session.context_json or not session.config_json:
        return None
    try:
        context = InterviewContext.model_validate(session.context_json)
        config = InterviewConfig.model_validate(session.config_json)
    except ValidationError:
        return None
    return [
        PlannedQuestion(
            sequence=sequence,
            question_type=question_type,
            competency=competency_for(context.topic, context.subtopics, sequence),
        )
        for sequence, question_type in enumerate(mix_plan(config.question_type, config.question_count), start=1)
    ]


def _view(db: DbSession, session: InterviewSession) -> SessionView:
    asked, answered = svc.question_counts(db, session.id)
    return SessionView(
        id=session.id,
        input_model=session.input_model,
        state=session.state,
        context=session.context_json,
        config=session.config_json,
        questions_asked=asked,
        questions_answered=answered,
        plan=_plan(session),
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_session(body: SessionCreate, db: DbSession, user: CurrentUser) -> SessionView:
    return _view(db, svc.create_session(db, user, body.input_model))


@router.get("")
def list_sessions(db: DbSession, user: CurrentUser) -> list[SessionView]:
    """The user's interview history, newest first."""
    return [_view(db, session) for session in svc.list_sessions(db, user)]


@router.get("/{session_id}")
def get_session(session_id: uuid.UUID, db: DbSession, user: CurrentUser) -> SessionView:
    return _view(db, svc.get_session(db, user, session_id))


@router.put("/{session_id}/context")
def set_context(
    session_id: uuid.UUID, body: InterviewContext, db: DbSession, user: CurrentUser
) -> SessionView:
    return _view(db, svc.set_context(db, user, session_id, body))


@router.put("/{session_id}/config")
def set_config(
    session_id: uuid.UUID, body: InterviewConfig, db: DbSession, user: CurrentUser
) -> SessionView:
    return _view(db, svc.set_config(db, user, session_id, body))


@router.post("/{session_id}/confirm")
def confirm_plan(session_id: uuid.UUID, db: DbSession, user: CurrentUser) -> SessionView:
    return _view(db, svc.confirm_plan(db, user, session_id))


@router.post("/{session_id}/start")
def start(session_id: uuid.UUID, db: DbSession, user: CurrentUser, llm: LLM) -> QuestionView:
    return QuestionView.model_validate(svc.start(db, user, session_id, llm))


@router.get("/{session_id}/current-question")
def current_question(session_id: uuid.UUID, db: DbSession, user: CurrentUser) -> QuestionView:
    question = svc.current_question(db, user, session_id)
    if question is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No question is waiting for an answer.")
    return QuestionView.model_validate(question)


@router.post("/{session_id}/answers")
def submit_answer(
    session_id: uuid.UUID, body: AnswerSubmit, db: DbSession, user: CurrentUser, llm: LLM
) -> AnswerResult:
    return _answer_result(svc.submit_answer(db, user, session_id, body.question_id, body.text, llm))


def _answer_result(result: svc.SubmitResult) -> AnswerResult:
    return AnswerResult(
        state=result.session.state,
        next_question=QuestionView.model_validate(result.next_question) if result.next_question else None,
        completed=result.session.state is SessionState.COMPLETED,
    )


@router.post("/{session_id}/retry")
def retry(session_id: uuid.UUID, db: DbSession, user: CurrentUser, llm: LLM) -> AnswerResult:
    """Finish scoring the last answer after a model failure, then continue the interview."""
    return _answer_result(svc.retry(db, user, session_id, llm))


@router.post("/{session_id}/pause")
def pause(session_id: uuid.UUID, db: DbSession, user: CurrentUser) -> SessionView:
    return _view(db, svc.pause(db, user, session_id))


@router.post("/{session_id}/resume")
def resume(session_id: uuid.UUID, db: DbSession, user: CurrentUser) -> SessionView:
    return _view(db, svc.resume(db, user, session_id))


@router.post("/{session_id}/finish")
def finish(session_id: uuid.UUID, db: DbSession, user: CurrentUser) -> SessionView:
    return _view(db, svc.finish(db, user, session_id))


@router.get("/{session_id}/report")
def get_report(session_id: uuid.UUID, db: DbSession, user: CurrentUser) -> ReportView:
    report = svc.get_report(db, user, session_id)
    return ReportView(session_id=report.session_id, generated_at=report.generated_at, summary=report.summary_json)
