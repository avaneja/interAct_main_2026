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


@dataclass(frozen=True)
class LLMResponse:
    text: str
    model: str


class LLMError(Exception):
    """The provider could not produce a reply (unreachable, timed out, refused)."""


class LLMClient(Protocol):
    model: str

    def complete(self, request: LLMRequest) -> LLMResponse: ...


class FakeLLM:
    """A predictable stand-in for a real model, for tests and local development.

    Queued replies are returned first, in order; a queued exception is raised
    instead. With nothing queued, it builds a valid reply from the request's
    hints. Every request is kept in `requests` so tests can inspect them.
    """

    model = "fake-llm"

    def __init__(self, *replies: str | Exception):
        self._queue: list[str | Exception] = list(replies)
        self.requests: list[LLMRequest] = []

    def queue(self, *replies: str | Exception) -> None:
        self._queue.extend(replies)

    def complete(self, request: LLMRequest) -> LLMResponse:
        self.requests.append(request)
        if self._queue:
            reply = self._queue.pop(0)
            if isinstance(reply, Exception):
                raise reply
            return LLMResponse(text=reply, model=self.model)
        return LLMResponse(text=json.dumps(self._default_reply(request)), model=self.model)

    def _default_reply(self, request: LLMRequest) -> dict[str, Any]:
        hints = request.hints
        if request.purpose == "generate_question":
            return {
                "type": hints["question_type"],
                "competency": hints["competency"],
                "difficulty": hints["difficulty"],
                "prompt": (
                    f"Question {hints['sequence']}: explain {hints['competency']} "
                    f"and give an example from {hints['topic']}."
                ),
            }
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
    )
