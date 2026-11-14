import itertools
import re

import pytest

from app.core.config import BACKEND_DIR
from app.models.enums import SessionState as S
from app.services.state_machine import (
    TRANSITIONS,
    Event,
    InvalidTransition,
    allowed_events,
    is_finished,
    next_state,
)

README = BACKEND_DIR.parent / "README.md"


def readme_state_diagram_edges():
    """The (from, to) arrows of the stateDiagram block in README section 5."""
    block = re.search(r"```mermaid\s*\nstateDiagram-v2\n(.*?)```", README.read_text(), re.S)
    assert block, "README no longer has a stateDiagram-v2 block"
    edges = re.findall(r"^\s*(\w+)\s*-->\s*(\w+)", block.group(1), re.M)
    return {(S(source), S(target)) for source, target in edges}


def test_code_matches_the_readme_diagram_exactly():
    code_edges = {(source, target) for (source, _), target in TRANSITIONS.items()}

    assert code_edges == readme_state_diagram_edges()


def test_each_event_has_one_meaning_per_state():
    assert len(TRANSITIONS) == len(set(TRANSITIONS))
    assert set(Event) == {event for (_, event) in TRANSITIONS}


@pytest.mark.parametrize(("state", "event"), list(TRANSITIONS))
def test_every_allowed_move_works(state, event):
    assert next_state(state, event) is TRANSITIONS[(state, event)]


@pytest.mark.parametrize(
    ("state", "event"),
    [pair for pair in itertools.product(S, Event) if pair not in TRANSITIONS],
)
def test_every_other_move_is_rejected(state, event):
    with pytest.raises(InvalidTransition) as error:
        next_state(state, event)

    assert error.value.state is state
    assert error.value.event is event


def test_a_full_interview_walks_from_preparing_to_completed():
    state = S.PREPARING
    for event in [
        Event.CONTEXT_READY,
        Event.PLAN_CONFIRMED,
        Event.START,
        Event.SUBMIT_ANSWER,
        Event.NEXT_QUESTION,
        Event.PAUSE,
        Event.RESUME,
        Event.SUBMIT_ANSWER,
        Event.NEXT_QUESTION,  # The wrap-up after the last answer.
        Event.FINISH,
    ]:
        state = next_state(state, event)

    assert state is S.COMPLETED


def test_cannot_start_before_the_plan_is_confirmed():
    with pytest.raises(InvalidTransition):
        next_state(S.CONFIGURING, Event.START)


def test_cannot_answer_twice_while_the_first_answer_is_being_scored():
    with pytest.raises(InvalidTransition):
        next_state(S.EVALUATING, Event.SUBMIT_ANSWER)


def test_a_paused_interview_must_resume_before_answering():
    with pytest.raises(InvalidTransition):
        next_state(S.PAUSED, Event.SUBMIT_ANSWER)


def test_completed_is_final():
    assert is_finished(S.COMPLETED)
    assert allowed_events(S.COMPLETED) == []
    assert not any(is_finished(state) for state in S if state is not S.COMPLETED)


def test_rejection_message_says_what_is_allowed():
    with pytest.raises(InvalidTransition, match="Allowed: PLAN_CONFIRMED"):
        next_state(S.CONFIGURING, Event.START)

    with pytest.raises(InvalidTransition, match="the interview is finished"):
        next_state(S.COMPLETED, Event.RESUME)
