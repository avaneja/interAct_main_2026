"""The LLM interface that every provider implements, and a deterministic fake.

A provider only turns a request into raw text. Parsing and validating that
text is the caller's job, so the raw reply can be stored before anything is
trusted. LLM_PROVIDER picks FakeLLM ("fake", used by the tests) or the
OpenAI-compatible adapter for Ollama and hosted providers
("openai_compatible").
"""

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

from app.core.config import get_settings


@dataclass(frozen=True)
class LLMRequest:
    purpose: str
    system: str
    user: str
    # A structured copy of the inputs. FakeLLM reads it to build replies;
    # real providers ignore it and only see `system` and `user`.
    hints: Mapping[str, Any] = field(default_factory=dict)
    # Recorded with every call, so results can be traced to the exact prompt.
    prompt_version: str = ""


@dataclass(frozen=True)
class LLMResponse:
    text: str
    model: str


class LLMError(Exception):
    """The provider could not produce a reply (unreachable, timed out, refused)."""


class LLMClient(Protocol):
    model: str

    def complete(self, request: LLMRequest) -> LLMResponse: ...

    def model_for(self, purpose: str) -> str:
        """The model that handles requests of this purpose."""
        ...


# Kinds of work that can each go to their own model (LLM_MODEL_<KIND>; see config.py).
ROUTES: dict[str, frozenset[str]] = {
    "conversation": frozenset({"interviewer_turn", "warm_up", "closing", "prepare_turn"}),
    "questions": frozenset({"generate_question", "generate_document_question", "classify_style", "suggest_subtopics"}),
    "grading": frozenset({"evaluate_answer", "evaluate_document_answer"}),
    "documents": frozenset({"map_topics"}),
}


def model_routes(default: str, **by_kind: str) -> dict[str, str]:
    """Purpose -> model for every purpose with its own model set; others use `default`."""
    return {
        purpose: model
        for kind, purposes in ROUTES.items()
        if (model := by_kind.get(kind, "")) and model != default
        for purpose in purposes
    }


# One fake question per style, each written to pass that style's rule check.
FAKE_QUESTIONS = {
    "DIRECT": "Question {n}: What is {competency}?",
    "CONCEPTUAL": "Question {n}: Why does {competency} matter in {topic}, and how does it work?",
    "CASE_BASED": (
        "Question {n}: A team reports 92% accuracy but only 35% recall when handling "
        "{competency} in {topic}. Diagnose the result."
    ),
    "SCENARIO_BASED": (
        "Question {n}: You own {competency} on a {topic} project and the release is tomorrow. "
        "What would you do first, and why?"
    ),
    "APPLICATION": "Question {n}: Design a step-by-step plan to apply {competency} in {topic}.",
}


class FakeLLM:
    """A predictable stand-in for a real model, for tests and local development.

    Replies queued for a request's purpose come first, then replies queued
    for any purpose, in order; a queued exception is raised instead. With
    nothing queued, it builds a valid reply from the request's hints. Every
    request is kept in `requests` so tests can inspect them.
    """

    model = "fake-llm"
    # Queue this to get the usual default reply at that point in a queue.
    DEFAULT = "<default reply>"

    def __init__(self, *replies: str | Exception):
        self._queue: list[str | Exception] = list(replies)
        self._by_purpose: dict[str, list[str | Exception]] = {}
        self.requests: list[LLMRequest] = []

    def model_for(self, purpose: str) -> str:
        return self.model

    def queue(self, *replies: str | Exception) -> None:
        self._queue.extend(replies)

    def queue_for(self, purpose: str, *replies: str | Exception) -> None:
        """Queue replies for one purpose only, such as "evaluate_answer"."""
        self._by_purpose.setdefault(purpose, []).extend(replies)

    def complete(self, request: LLMRequest) -> LLMResponse:
        self.requests.append(request)
        queue = self._by_purpose.get(request.purpose) or self._queue
        if queue:
            reply = queue.pop(0)
            if isinstance(reply, Exception):
                raise reply
            if reply != self.DEFAULT:
                return LLMResponse(text=reply, model=self.model)
        return LLMResponse(text=json.dumps(self._default_reply(request)), model=self.model)

    def _default_reply(self, request: LLMRequest) -> dict[str, Any]:
        hints = request.hints
        if request.purpose == "generate_question":
            template = FAKE_QUESTIONS.get(hints["question_type"], FAKE_QUESTIONS["CONCEPTUAL"])
            return {
                "type": hints["question_type"],
                "competency": hints["competency"],
                "difficulty": hints["difficulty"],
                "prompt": template.format(
                    n=hints["sequence"], competency=hints["competency"], topic=hints["topic"]
                ),
            }
        if request.purpose == "generate_document_question":
            # Cites the first passage and quotes its first sentence, so the quote always checks out.
            template = FAKE_QUESTIONS.get(hints["question_type"], FAKE_QUESTIONS["CONCEPTUAL"])
            passage = hints["passages"][0]
            sentence = re.split(r"(?<=[.!?])\s+", passage["text"].strip())[0]
            return {
                "type": hints["question_type"],
                "competency": hints["competency"],
                "difficulty": hints["difficulty"],
                "prompt": template.format(n=hints["sequence"], competency=hints["competency"], topic="the document"),
                "source": passage["id"],
                "supporting_quote": sentence,
                "answer_key": {"key_points": [sentence]},
            }
        if request.purpose == "classify_style":
            # The fake always agrees, so tests queue a reply to simulate a mismatch.
            return {"style": hints["question_type"], "reason": "Fake style check."}
        if request.purpose == "evaluate_document_answer":
            # The usual fake grade; the answer's first sentence counts as a point the document supports.
            reply = self._default_reply(LLMRequest("evaluate_answer", "", "", request.hints))
            first = re.split(r"(?<=[.!?])\s+", hints["answer"].strip())[0]
            reply["document_supported"] = [{"point": "A point from the document.", "quote": first}] if first else []
            reply["outside_knowledge"] = []
            return reply
        if request.purpose == "evaluate_answer":
            # More words earn more credit, so tests can steer scores by answer length.
            words = len(re.findall(r"\w+", hints["answer"]))
            share = min(words, 40) / 40
            criteria = [
                {
                    "name": criterion["name"],
                    "score": round(criterion["max_score"] * share),
                    "max_score": criterion["max_score"],
                    "reason": f"Fake evaluation based on a {words}-word answer.",
                }
                for criterion in hints["criteria"]
            ]
            return {
                "score": sum(c["score"] for c in criteria),
                "max_score": sum(c["max_score"] for c in criteria),
                "criteria": criteria,
                "missing_concepts": [] if share == 1 else [hints["competency"]],
                "insufficient_evidence": words == 0,
                "better_answer_outline": [
                    f"Define {hints['competency']} precisely.",
                    "Give a concrete example.",
                    "Weigh one trade-off.",
                ],
            }
        if request.purpose == "warm_up":
            return {"reply": "Thanks for sharing that. Let's get started with the questions."}
        if request.purpose == "closing":
            # A candidate who writes "no" is done; anything else is answered and asked again.
            if re.match(r"\W*(no|nope|that's all)\b", hints["text"], re.IGNORECASE):
                return {"reply": "Thank you for your time. Goodbye.", "done": True}
            return {"reply": "Good question. Your report will show what to revise. Any other questions?",
                    "done": False}
        if request.purpose == "suggest_subtopics":
            topic = hints["topic"]
            return {"subtopics": [f"{topic} fundamentals", f"{topic} in practice", f"common {topic} pitfalls",
                                  f"{topic} trade-offs"]}
        if request.purpose == "map_topics":
            # One topic per three chunks, named after the first words of its first chunk.
            chunks = hints["chunks"]
            topics = []
            for start in range(0, len(chunks), 3):
                group = chunks[start : start + 3]
                name = " ".join(group[0]["text"].split()[:4]) or f"Part {start // 3 + 1}"
                topics.append({"name": name, "summary": f"What the document says about {name}.",
                               "chunk_ids": [chunk["id"] for chunk in group]})
            return {"summary": f"A document in {len(chunks)} parts.", "topics": topics}
        if request.purpose == "prepare_turn":
            # Keeps the draft, or takes the topic from the request; asks two questions, then stops.
            draft = hints["draft"] or {}
            topic = draft.get("topic") or re.sub(
                r"^\W*(please\s+)?(interview|quiz|test)\s+me\s+(on|about)\s+", "", hints["request"], flags=re.IGNORECASE
            )[:80].strip(" .") or "General practice"
            questions = ["What role or goal are you preparing for?", "Which areas would you like to focus on?"]
            asked = hints["asked"]
            return {
                "topic": topic,
                "goal": draft.get("goal"),
                "level": draft.get("level"),
                "subtopics": draft.get("subtopics", []),
                "question": questions[asked] if hints["questions_left"] > 0 and asked < len(questions) else None,
            }
        if request.purpose == "interviewer_turn":
            # The fake never asks a follow-up, so tests queue a reply to get one.
            return {
                "reaction": "Thank you, that is a clear answer.",
                "follow_up": None,
                "transition": "" if hints["last_question"] else "Let's move on.",
            }
        raise LLMError(f"FakeLLM has no default reply for purpose '{request.purpose}'")


def get_llm() -> LLMClient:
    """FastAPI dependency for the provider named by LLM_PROVIDER."""
    settings = get_settings()
    if settings.llm_provider == "fake":
        return FakeLLM()

    from app.core.openai_compatible import OpenAICompatibleLLM

    return OpenAICompatibleLLM(
        base_url=settings.llm_base_url,
        model=settings.llm_model,
        api_key=settings.llm_api_key.get_secret_value(),
        timeout_seconds=settings.llm_timeout_seconds,
        max_retries=settings.llm_max_retries,
        temperature=settings.llm_temperature,
        reasoning_effort=settings.llm_reasoning_effort,
        routes=model_routes(
            settings.llm_model,
            conversation=settings.llm_model_conversation,
            questions=settings.llm_model_questions,
            grading=settings.llm_model_grading,
            documents=settings.llm_model_documents,
        ),
    )
