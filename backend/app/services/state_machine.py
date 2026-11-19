"""The interview state machine from README section 5.

Code moves a session by naming what happened (an Event), never by setting a
state directly. Any move not in TRANSITIONS raises InvalidTransition, which
the API reports as a conflict. Preconditions such as "the plan must be
confirmed before starting" are checked by the caller before an event is
applied.
"""

from enum import StrEnum

from app.models.enums import SessionState as S


class Event(StrEnum):
    CONTEXT_READY = "CONTEXT_READY"
    PLAN_CONFIRMED = "PLAN_CONFIRMED"
    START = "START"
    SUBMIT_ANSWER = "SUBMIT_ANSWER"
    # The interviewer's next step: a follow-up, the next planned question, or the wrap-up.
    NEXT_QUESTION = "NEXT_QUESTION"
    PAUSE = "PAUSE"
    RESUME = "RESUME"
    # Score every answer and write the report: after the wrap-up, or early.
    FINISH = "FINISH"


TRANSITIONS: dict[tuple[S, Event], S] = {
    (S.PREPARING, Event.CONTEXT_READY): S.CONFIGURING,
    (S.CONFIGURING, Event.PLAN_CONFIRMED): S.READY,
    (S.READY, Event.START): S.IN_PROGRESS,
    (S.IN_PROGRESS, Event.SUBMIT_ANSWER): S.EVALUATING,
    (S.EVALUATING, Event.NEXT_QUESTION): S.IN_PROGRESS,
    (S.IN_PROGRESS, Event.PAUSE): S.PAUSED,
    (S.PAUSED, Event.RESUME): S.IN_PROGRESS,
    (S.IN_PROGRESS, Event.FINISH): S.COMPLETED,
    # Ending the call never has to wait: not while the interviewer is thinking, nor while paused.
    (S.EVALUATING, Event.FINISH): S.COMPLETED,
    (S.PAUSED, Event.FINISH): S.COMPLETED,
}


class InvalidTransition(Exception):
    def __init__(self, state: S, event: Event):
        self.state = state
        self.event = event
        allowed = ", ".join(allowed_events(state)) or "none, the interview is finished"
        super().__init__(f"Cannot {event} while the session is {state}. Allowed: {allowed}.")


def next_state(state: S, event: Event) -> S:
    """Return the state after `event`, or raise InvalidTransition."""
    try:
        return TRANSITIONS[(state, event)]
    except KeyError:
        raise InvalidTransition(state, event) from None


def allowed_events(state: S) -> list[Event]:
    return [event for (source, event) in TRANSITIONS if source == state]


def is_finished(state: S) -> bool:
    return not allowed_events(state)
