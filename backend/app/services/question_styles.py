"""The six question styles from README section 2.3, and the mix policy for MIXED.

Each concrete style says what the question asks the candidate for and what
it must contain, so the generator can follow it and the style check can
test it. MIXED is not a style of its own: it picks concrete styles by the
mix policy below.
"""

import re
from dataclasses import dataclass

from app.models.enums import Difficulty
from app.models.enums import QuestionType as Q


@dataclass(frozen=True)
class Style:
    label: str
    asks_for: str
    must_include: str
    example: str


STYLES: dict[Q, Style] = {
    Q.DIRECT: Style(
        label="Direct / factual",
        asks_for="a definition, fact or short recall answer",
        must_include="one clear question about a single concept, with no case, story or scenario",
        example="Define overfitting.",
    ),
    Q.CONCEPTUAL: Style(
        label="Conceptual",
        asks_for="an explanation of why or how something works, or how two ideas relate",
        must_include="a why or how question that needs reasoning, not just a definition",
        example="Why can cross-validation provide a better estimate than one train/test split?",
    ),
    Q.CASE_BASED: Style(
        label="Case-based",
        asks_for="a diagnosis or judgement about a concrete case",
        must_include=(
            "a specific case with concrete details (numbers, observations or results) "
            "that the candidate has to analyse"
        ),
        example="A model achieves 98% accuracy on a highly imbalanced dataset. Diagnose the result.",
    ),
    Q.SCENARIO_BASED: Style(
        label="Scenario-based",
        asks_for="a decision about what the candidate would do and why",
        must_include=(
            "a realistic situation the candidate is in, with at least one constraint or "
            "trade-off, asking what they would do"
        ),
        example=(
            "Your deployed model begins underperforming after a data pipeline change. "
            "What do you investigate?"
        ),
    ),
    Q.APPLICATION: Style(
        label="Application / problem-solving",
        asks_for="a worked solution, design or plan",
        must_include="a concrete problem to solve or design, asking for steps, a design or a method",
        example="Design an evaluation strategy for an imbalanced binary classifier.",
    ),
}

DIFFICULTY_GUIDE: dict[Difficulty, str] = {
    Difficulty.BEGINNER: "core ideas a learner meets first; no edge cases or tricky trade-offs",
    Difficulty.INTERMEDIATE: "applying concepts and comparing options, with some trade-offs",
    Difficulty.ADVANCED: (
        "edge cases, subtle trade-offs and justification at the level of an experienced practitioner"
    ),
}

# Mix policy for MIXED: every style appears equally often, and each round
# moves from recall to application. Question counts (5, 10, 15) are
# multiples of five, so the split is always exact.
MIX_ORDER: list[Q] = [Q.DIRECT, Q.CONCEPTUAL, Q.CASE_BASED, Q.SCENARIO_BASED, Q.APPLICATION]


def style_rule_problem(question_type: Q, prompt: str) -> str | None:
    """A quick check for clear style misses. Returns the problem, or None.

    These rules only catch obvious mismatches, so they cannot reject a
    reasonable question; the optional LLM check judges the finer cases.
    """
    text = prompt.lower()
    words = len(re.findall(r"\w+", text))
    second_person = re.search(r"\byou(r|'re)?\b", text)
    if question_type is Q.DIRECT:
        if words > 40:
            return "too long for a direct question"
        if second_person and re.search(r"\d", text):
            return "reads like a case or scenario, not a direct question"
    elif question_type is Q.CONCEPTUAL:
        if not re.search(r"\b(why|how|explain|compare|contrast|relationship|differ)\w*", text):
            return "does not ask why or how, or how ideas relate"
    elif question_type is Q.CASE_BASED:
        if not re.search(r"\d", text) and len(re.findall(r"[.!?]", prompt)) < 2:
            return "has no concrete case details to analyse"
    elif question_type is Q.SCENARIO_BASED:
        if not second_person:
            return "does not put the candidate in a situation"
        if not re.search(r"\b(would|should|will|do|can)\s+you\b|\byour (first|next) step", text):
            return "does not ask what the candidate would do"
    elif question_type is Q.APPLICATION:
        if not re.search(
            r"\b(design|propose|outline|plan|build|implement|develop|write|create|devise|sketch|describe how)\w*",
            text,
        ):
            return "does not ask for a design, plan or method"
    return None


def question_type_for(config_type: Q, sequence: int) -> Q:
    """The concrete style for question `sequence` (1-based) under the configured type."""
    if config_type is not Q.MIXED:
        return config_type
    return MIX_ORDER[(sequence - 1) % len(MIX_ORDER)]


def mix_plan(config_type: Q, question_count: int) -> list[Q]:
    return [question_type_for(config_type, sequence) for sequence in range(1, question_count + 1)]
