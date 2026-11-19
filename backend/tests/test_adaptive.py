"""M10: the rule-based adaptive policy, and fixed mode as the research baseline."""

import json

import pytest

from app.core.llm import FakeLLM
from app.models import Base, Question, User
from app.models.enums import AuthProvider, InputModel
from app.schemas import InterviewConfig, InterviewContext
from app.services import adaptive_policy as policy
from app.services import interview as svc

STRONG = "A process is a running program with its own address space and resources managed by the kernel."
THIN = "It is a running program."
PLAN = ["processes", "memory", "scheduling"]


@pytest.fixture
def db(db_engine, db_session):
    Base.metadata.create_all(db_engine)
    return db_session


@pytest.fixture
def user(db):
    user = User(auth_provider=AuthProvider.GOOGLE, provider_user_id="1", display_name="Ada")
    db.add(user)
    db.commit()
    return user


@pytest.fixture
def llm():
    return FakeLLM()


def start(db, user, llm, *, adaptive, style="MIXED", count=5):
    session = svc.create_session(db, user, InputModel.TOPIC)
    svc.set_context(db, user, session.id, InterviewContext.model_validate(
        {"input_model": "TOPIC", "topic": "Operating systems", "subtopics": PLAN}))
    svc.set_config(db, user, session.id, InterviewConfig.model_validate(
        {"question_type": style, "difficulty": "intermediate", "question_count": count, "adaptive": adaptive}))
    svc.confirm_plan(db, user, session.id)
    return session, svc.start(db, user, session.id, llm)


def answer(db, user, session, question, text, llm):
    return svc.submit_answer(db, user, session.id, question.id, text, llm).next_question


def planned(db, session):
    rows = db.query(Question).filter(Question.session_id == session.id, Question.follow_up == 0)
    return [q for q in rows.order_by(Question.sequence)]


# The policy's rules


@pytest.mark.parametrize("replies, amount", [
    ([STRONG], 1.0),
    ([THIN], 0.5),
    (["I don't know"], 0.25),
    (["I don't know", "no idea"], 0.25),
    (["I don't know", STRONG], 1.0),
    ([], 0.0),
])
def test_evidence_reflects_how_much_the_candidate_said(replies, amount):
    assert policy.evidence(replies) == amount


def test_the_least_covered_competency_comes_next_and_ties_follow_the_plan():
    assert policy.next_competency(PLAN, []) == "processes"
    assert policy.next_competency(PLAN, [("processes", 1.0)]) == "memory"
    assert policy.next_competency(PLAN, [("processes", 1.0), ("memory", 0.25), ("scheduling", 1.0)]) == "memory"
    assert policy.next_competency(PLAN, [("processes", 0.5), ("memory", 0.5), ("scheduling", 0.5)]) == "processes"


@pytest.mark.parametrize("reply, follow_up", [
    (THIN, True),
    (STRONG, False),
    ("I don't know", False),
    ("Just tell me the answer please", False),
])
def test_a_rule_follow_up_is_only_for_thin_replies(reply, follow_up):
    assert policy.needs_rule_follow_up(reply) is follow_up


# Adaptive mode in an interview


def test_adaptive_mode_revisits_a_weakly_covered_competency(db, user, llm):
    session, q1 = start(db, user, llm, adaptive=True)
    q2 = answer(db, user, session, q1, STRONG, llm)
    q3 = answer(db, user, session, q2, "I don't know", llm)
    q4 = answer(db, user, session, q3, STRONG, llm)

    assert [q.competency for q in (q1, q2, q3, q4)] == ["processes", "memory", "scheduling", "memory"]


def test_fixed_mode_keeps_the_plan_order_whatever_the_answers(db, user, llm):
    session, q1 = start(db, user, llm, adaptive=False)
    q2 = answer(db, user, session, q1, STRONG, llm)
    q3 = answer(db, user, session, q2, "I don't know", llm)
    q4 = answer(db, user, session, q3, STRONG, llm)

    assert [q.competency for q in (q1, q2, q3, q4)] == ["processes", "memory", "scheduling", "processes"]


def test_both_modes_keep_the_style_rotation_and_difficulty(db, user):
    styles = {}
    for adaptive in (True, False):
        llm = FakeLLM()
        session, question = start(db, user, llm, adaptive=adaptive)
        for text in (STRONG, "I don't know", STRONG, STRONG):
            question = answer(db, user, session, question, text, llm)
        styles[adaptive] = [(q.type, q.difficulty) for q in planned(db, session)]
    assert styles[True] == styles[False]


def test_adaptive_mode_asks_a_rule_follow_up_after_a_thin_reply(db, user, llm):
    session, q1 = start(db, user, llm, adaptive=True)

    follow_up = answer(db, user, session, q1, THIN, llm)

    assert (follow_up.follow_up, follow_up.prompt) == (1, policy.RULE_FOLLOW_UP)
    assert follow_up.sequence == q1.sequence


def test_rule_follow_ups_stop_at_the_limit(db, user, llm):
    session, question = start(db, user, llm, adaptive=True)
    asked = []
    for _ in range(3):
        question = answer(db, user, session, question, THIN, llm)
        asked.append(question.follow_up)

    assert asked == [1, 2, 0]


def test_fixed_mode_never_follows_up(db, user, llm):
    session, q1 = start(db, user, llm, adaptive=False)
    llm.queue_for("interviewer_turn", json.dumps(
        {"reaction": "Okay.", "follow_up": "Can you say more?", "transition": "Next."}))

    nxt = answer(db, user, session, q1, THIN, llm)

    assert (nxt.follow_up, nxt.sequence) == (0, 2)
    turn_request = next(r for r in llm.requests if r.purpose == "interviewer_turn")
    assert "You may not ask another follow-up question" in turn_request.user


def test_the_interviewer_leads_into_the_competency_adaptive_mode_picks(db, user, llm):
    session, q1 = start(db, user, llm, adaptive=True)
    q2 = answer(db, user, session, q1, STRONG, llm)
    answer(db, user, session, q2, "I don't know", llm)

    turn_request = [r for r in llm.requests if r.purpose == "interviewer_turn"][-1]
    assert "the next question is about: scheduling" in turn_request.user


def test_a_question_prepared_for_another_competency_is_not_used(db, user, llm):
    session, q1 = start(db, user, llm, adaptive=True)
    svc.prepare_next_question(db, session.id, llm)  # Written for "memory" before q1 is answered.
    session_row = svc.get_session(db, user, session.id)
    session_row.prepared_json["question"]["competency"] = "scheduling"
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(session_row, "prepared_json")
    db.commit()

    q2 = answer(db, user, session, q1, STRONG, llm)

    assert q2.competency == "memory"


def test_the_report_says_which_mode_ran_and_the_order_of_competencies(db, user, llm):
    session, q1 = start(db, user, llm, adaptive=True)
    q2 = answer(db, user, session, q1, STRONG, llm)
    answer(db, user, session, q2, "I don't know", llm)
    svc.finish(db, user, session.id, llm)

    report = svc.get_report(db, user, session.id).summary_json
    assert report["mode"] == "adaptive"
    assert report["competency_order"] == ["processes", "memory", "scheduling"]
