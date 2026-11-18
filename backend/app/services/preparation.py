"""Model A clarification: a short chat that turns a free-form request into a scope.

The candidate writes what they want to practise. A planner model works out
the topic, goal, level and subtopics from the whole chat and asks only what
is still missing. The rules this module enforces (README 2.1):

- The chat belongs to a topic interview that is still being prepared.
- Every message is saved in order: the candidate's request, replies and
  skips, and the planner's questions and summaries.
- At most MAX_QUESTIONS clarification questions, never a repeat: a question
  too close to an earlier one ends the questions instead. Once the goal,
  level and subtopics are all known, no more are asked; while no subtopics
  are known, the candidate is asked which areas to focus on.
- The candidate may skip a question, or say they have said enough, which
  ends the questions.
- Each turn updates a structured draft context on the session, not just the
  transcript. The draft is not confirmed: the session stays PREPARING until
  the candidate confirms the scope (PUT /context, which may edit it).
- When the questions end, the scope is summarised from the draft, in code,
  so the summary says exactly what will be planned.
- If the model fails, the candidate's message is kept and sending the same
  text again retries without saving it twice.
"""

import re
import uuid
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.llm import LLMClient
from app.models import InterviewSession, PreparationMessage, User
from app.models.enums import InputModel, MessageRole, SessionState
from app.schemas import InterviewContext, PreparationTurn
from app.services import prompts
from app.services.interview import Conflict, InvalidInput, _ask_llm, get_session

MAX_QUESTIONS = 4
# Questions sharing this much of the shorter one's key words with an earlier one count as repeats.
REPEAT_OVERLAP = 0.6
AREAS_QUESTION = "Which areas of {topic} would you like to focus on?"
_ABOUT_AREAS = re.compile(r"\b(areas?|focus|subtopics?|topics?|parts?)\b", re.IGNORECASE)
SKIPPED = "(skipped this question: do not ask about this again)"

_WORDS = re.compile(r"[a-z0-9']+")
_FILLER = {
    "a", "an", "the", "you", "your", "you're", "are", "is", "do", "does", "did", "what", "which", "would", "like",
    "to", "for", "on", "in", "of", "and", "or", "me", "i", "it", "any", "there", "at", "right", "now", "current",
    "currently", "so", "far", "can", "could", "tell", "about", "please", "how", "be", "with", "this", "that",
}


@dataclass
class Preparation:
    messages: list[PreparationMessage]
    context: InterviewContext | None
    question: str | None
    done: bool
    questions_asked: int


def _messages(db: Session, session_id: uuid.UUID) -> list[PreparationMessage]:
    query = (
        select(PreparationMessage)
        .where(PreparationMessage.session_id == session_id)
        .order_by(PreparationMessage.position)
    )
    return list(db.scalars(query))


def _draft(session: InterviewSession) -> InterviewContext | None:
    if not session.context_json:
        return None
    try:
        return InterviewContext.model_validate(session.context_json)
    except ValueError:
        return None


def _view(db: Session, session: InterviewSession) -> Preparation:
    messages = _messages(db, session.id)
    last = messages[-1] if messages else None
    return Preparation(
        messages=messages,
        context=_draft(session),
        question=last.content if last is not None and last.kind == "question" else None,
        done=last is not None and last.kind == "summary",
        questions_asked=sum(1 for message in messages if message.kind == "question"),
    )


def _preparing(db: Session, user: User, session_id: uuid.UUID, *, lock: bool = False) -> InterviewSession:
    session = get_session(db, user, session_id, lock=lock)
    if session.input_model is not InputModel.TOPIC:
        raise Conflict("Clarification is for topic interviews.")
    if session.state is not SessionState.PREPARING:
        raise Conflict("The scope is already confirmed; edit the topic instead.")
    return session


def get_preparation(db: Session, user: User, session_id: uuid.UUID) -> Preparation:
    session = get_session(db, user, session_id)
    if session.input_model is not InputModel.TOPIC:
        raise Conflict("Clarification is for topic interviews.")
    return _view(db, session)


def _add(db: Session, session_id: uuid.UUID, role: MessageRole, kind: str, content: str) -> None:
    position = (
        db.scalar(
            select(func.max(PreparationMessage.position)).where(PreparationMessage.session_id == session_id)
        )
        or 0
    ) + 1
    db.add(PreparationMessage(session_id=session_id, position=position, role=role, kind=kind, content=content))


def _words(text: str) -> set[str]:
    return {word for word in _WORDS.findall(text.lower()) if word not in _FILLER}


def is_repeat(question: str, earlier: list[str]) -> bool:
    """True if `question` says much the same as one of the earlier questions."""
    words = _words(question)
    for previous in earlier:
        other = _words(previous)
        if not words or not other:
            if question.strip().casefold() == previous.strip().casefold():
                return True
            continue
        if len(words & other) / min(len(words), len(other)) >= REPEAT_OVERLAP:
            return True
    return False


def _conversation(messages: list[PreparationMessage]) -> list[tuple[str, str]]:
    return [
        ("Planner" if message.role is MessageRole.ASSISTANT else "Candidate", message.content)
        for message in messages
        if message.kind != "summary"
    ]


def _scope(turn: PreparationTurn) -> InterviewContext:
    """The draft context from the planner's turn; raises ValueError if it is not a valid one."""
    return InterviewContext(
        input_model=InputModel.TOPIC,
        topic=turn.topic,
        goal=turn.goal,
        level=turn.level,
        subtopics=turn.subtopics,
    )


def summarise(context: InterviewContext) -> str:
    """What will be planned, in one or two spoken sentences, from the draft itself."""
    parts = [f"Here's the plan: an interview on {context.topic}"]
    if context.subtopics:
        areas = context.subtopics
        listed = areas[0] if len(areas) == 1 else f"{', '.join(areas[:-1])} and {areas[-1]}"
        parts.append(f", focusing on {listed}")
    if context.level:
        parts.append(f", at {context.level.value} level")
    if context.goal:
        goal = context.goal.rstrip(".")
        if goal.split(" ", 1)[0] in ("A", "An", "The", "My"):
            goal = goal[0].lower() + goal[1:]
        parts.append(f", to prepare for {goal}")
    text = "".join(parts) + "."
    if not context.subtopics:
        text += " I'll suggest the main areas to cover when you confirm."
    return text + " Change anything you like, then confirm."


def send_message(
    db: Session,
    user: User,
    session_id: uuid.UUID,
    text: str,
    llm: LLMClient,
    *,
    skip: bool = False,
    enough: bool = False,
) -> Preparation:
    """Save the candidate's turn, then let the planner update the draft and ask
    its next question or summarise the scope."""
    session = _preparing(db, user, session_id, lock=True)
    messages = _messages(db, session.id)
    last = messages[-1] if messages else None
    text = text.strip()

    if last is None:
        if not text:
            raise InvalidInput("Describe the interview you want to practise.")
        _add(db, session.id, MessageRole.USER, "request", text)
    elif last.role is MessageRole.USER:
        # The planner failed after this message. Sending it again retries; anything new is added.
        if text and text != last.content:
            _add(db, session.id, MessageRole.USER, "reply", text)
        elif not text and not skip and not enough:
            raise InvalidInput("Write a reply, or skip the question.")
    elif skip and last.kind == "question":
        _add(db, session.id, MessageRole.USER, "skip", SKIPPED)
    elif text:
        _add(db, session.id, MessageRole.USER, "reply", text)
    elif not enough:
        raise InvalidInput("Write a reply, or skip the question.")
    db.commit()

    messages = _messages(db, session.id)
    asked = [message.content for message in messages if message.kind == "question"]
    questions_left = 0 if enough else max(0, MAX_QUESTIONS - len(asked))
    draft = _draft(session)
    request = prompts.prepare_turn_request(
        conversation=_conversation(messages), draft=draft, questions_left=questions_left
    )
    # Without a lock: this calls the model. LLMUnavailable leaves the candidate's message saved.
    turn = _ask_llm(db, llm, request, PreparationTurn, session_id=session.id, check=_scope)

    session = _preparing(db, user, session_id, lock=True)
    context = _scope(turn)
    session.context_json = context.model_dump(mode="json")

    # Once the goal, level and areas are known there is nothing left to clarify.
    complete = bool(context.goal and context.level and context.subtopics)
    question = turn.question if questions_left > 0 and not complete else None
    if question is not None and is_repeat(question, asked):
        question = None
    if question is None and questions_left > 0 and not context.subtopics and not any(map(_ABOUT_AREAS.search, asked)):
        # Small models often stop before asking what to focus on, the question that shapes the plan most.
        question = AREAS_QUESTION.format(topic=context.topic)
    if question is not None:
        _add(db, session.id, MessageRole.ASSISTANT, "question", question)
    else:
        _add(db, session.id, MessageRole.ASSISTANT, "summary", summarise(context))
    db.commit()
    return _view(db, session)
