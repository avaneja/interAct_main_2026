"""Checks the candidate local models in Ollama. Run with: pytest -m ollama

These call real models, so they are slow and skipped by default. Each one is
skipped when Ollama is not running or the model has not been downloaded.
They only check that a model answers through the adapter with a JSON object;
how well it follows the interview schemas is measured by the model
comparison later in M2.
"""

import json

import httpx2 as httpx
import pytest

from app.core.llm import LLMRequest
from app.core.openai_compatible import OpenAICompatibleLLM

OLLAMA = "http://localhost:11434"
CANDIDATES = ["interact-qwen3:8b", "interact-llama3.1:8b"]


def downloaded_models():
    try:
        tags = httpx.get(f"{OLLAMA}/api/tags", timeout=3).json()
    except (httpx.HTTPError, ValueError):
        return None
    return {model["name"] for model in tags.get("models", [])}


@pytest.mark.ollama
@pytest.mark.parametrize("model", CANDIDATES)
def test_candidate_model_answers_with_json(model):
    available = downloaded_models()
    if available is None:
        pytest.skip("Ollama is not running at localhost:11434")
    if model not in available:
        pytest.skip(f"{model} is not downloaded; run: ollama pull {model}")

    llm = OpenAICompatibleLLM(base_url=f"{OLLAMA}/v1", model=model, timeout_seconds=180)
    reply = llm.complete(
        LLMRequest(
            purpose="smoke_test",
            system='Reply with a JSON object only, with the keys "topic" and "question".',
            user="Write one short interview question about overfitting.",
        )
    )

    data = json.loads(reply.text)
    assert isinstance(data, dict)
    assert data.get("question")
