"""Scoring rubrics. A version is never edited once used: change a rubric by
adding a new version, so earlier scores stay comparable.

Every score level has a written anchor, so the evaluator, human raters and
the research analysis all read the same definition of each score.
"""

from dataclasses import dataclass
from typing import Any

from app.models.enums import QuestionType


@dataclass(frozen=True)
class Criterion:
    name: str
    description: str
    levels: tuple[str, ...]  # levels[score] describes that score, from 0 up.

    @property
    def max_score(self) -> int:
        return len(self.levels) - 1


@dataclass(frozen=True)
class RubricSpec:
    name: str
    version: str
    criteria: tuple[Criterion, ...]

    @property
    def max_score(self) -> int:
        return sum(criterion.max_score for criterion in self.criteria)

    def criteria_json(self) -> list[dict[str, Any]]:
        return [
            {
                "name": c.name,
                "max_score": c.max_score,
                "description": c.description,
                "levels": {str(score): text for score, text in enumerate(c.levels)},
            }
            for c in self.criteria
        ]


CORRECTNESS = Criterion(
    name="correctness",
    description="The facts, terms and claims in the answer are accurate.",
    levels=(
        "wrong, or does not answer the question",
        "partly right, with a significant error",
        "right, with a minor slip or imprecise term",
        "fully accurate and precise",
    ),
)

RECALL = RubricSpec(
    name="recall",
    version="1",
    criteria=(
        CORRECTNESS,
        Criterion(
            name="completeness",
            description="The answer covers what the question asks for.",
            levels=(
                "misses the main point",
                "gives the main point but leaves out an important part",
                "covers everything the question asks for",
            ),
        ),
    ),
)

REASONING = RubricSpec(
    name="reasoning",
    version="1",
    criteria=(
        CORRECTNESS,
        Criterion(
            name="completeness",
            description="The answer covers the key points the question needs.",
            levels=(
                "misses the main point",
                "makes one relevant point",
                "covers most key points",
                "covers all key points",
            ),
        ),
        Criterion(
            name="reasoning",
            description="The answer explains why, and weighs trade-offs where they matter.",
            levels=(
                "no justification",
                "some reasons, but with gaps or unsupported claims",
                "clear, justified reasoning that weighs the trade-offs",
            ),
        ),
        Criterion(
            name="specificity",
            description=(
                "The answer uses the details of the question (its case, situation or problem) "
                "and gives concrete steps or examples."
            ),
            levels=(
                "generic; could answer a different question",
                "some specific details or steps",
                "specific to this question and actionable",
            ),
        ),
    ),
)

RUBRICS: tuple[RubricSpec, ...] = (RECALL, REASONING)


def rubric_for(question_type: QuestionType) -> RubricSpec:
    """Direct questions test recall; every other style also tests reasoning."""
    return RECALL if question_type is QuestionType.DIRECT else REASONING
