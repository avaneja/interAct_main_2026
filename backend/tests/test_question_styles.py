from collections import Counter

import pytest

from app.core.config import BACKEND_DIR
from app.models.enums import Difficulty, QuestionType
from app.schemas import InterviewConfig, InterviewContext
from app.services import prompts
from app.services.question_styles import DIFFICULTY_GUIDE, MIX_ORDER, STYLES, mix_plan, question_type_for

CONCRETE = [t for t in QuestionType if t is not QuestionType.MIXED]


def test_every_concrete_style_is_defined_and_mixed_is_not():
    assert set(STYLES) == set(CONCRETE)
    assert set(MIX_ORDER) == set(CONCRETE)
    assert set(DIFFICULTY_GUIDE) == set(Difficulty)


def test_style_examples_come_from_the_readme():
    readme = (BACKEND_DIR.parent / "README.md").read_text()

    for style in STYLES.values():
        assert style.example in readme


@pytest.mark.parametrize("question_type", CONCRETE)
def test_a_concrete_type_is_used_for_every_question(question_type):
    assert mix_plan(question_type, 10) == [question_type] * 10


@pytest.mark.parametrize("count", [5, 10, 15])
def test_mixed_uses_every_style_equally(count):
    plan = mix_plan(QuestionType.MIXED, count)

    assert QuestionType.MIXED not in plan
    assert Counter(plan) == {style: count // 5 for style in CONCRETE}


def test_mixed_moves_from_recall_to_application_each_round():
    plan = mix_plan(QuestionType.MIXED, 10)

    assert plan[:5] == plan[5:] == [
        QuestionType.DIRECT,
        QuestionType.CONCEPTUAL,
        QuestionType.CASE_BASED,
        QuestionType.SCENARIO_BASED,
        QuestionType.APPLICATION,
    ]
    assert all(a is not b for a, b in zip(plan, plan[1:]))


def test_question_type_for_is_one_based():
    assert question_type_for(QuestionType.MIXED, 1) is QuestionType.DIRECT
    assert question_type_for(QuestionType.MIXED, 6) is QuestionType.DIRECT


@pytest.mark.parametrize("question_type", CONCRETE)
def test_the_prompt_carries_the_style_rules(question_type):
    context = InterviewContext.model_validate(
        {"input_model": "TOPIC", "topic": "Operating systems", "goal": "internship", "level": "beginner"}
    )
    config = InterviewConfig.model_validate(
        {"question_type": "MIXED", "difficulty": "advanced", "question_count": 10}
    )

    request = prompts.question_request(
        context=context, config=config, sequence=3, question_type=question_type,
        competency="scheduling", previous_prompts=["What is a process?"],
    )

    style = STYLES[question_type]
    assert f"Style: {style.label}" in request.user
    assert style.must_include in request.user
    assert style.example in request.user
    assert DIFFICULTY_GUIDE[Difficulty.ADVANCED] in request.user
    assert "- What is a process?" in request.user
    assert f'"type": "{question_type.value}"' in request.user
    assert request.hints["question_type"] == question_type.value
