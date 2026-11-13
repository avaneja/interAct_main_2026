"""LLM adapter for any OpenAI-compatible chat completions API.

Ollama, Groq, Gemini and OpenRouter all expose this API, so switching
between the local and hosted modes is configuration only (LLM_BASE_URL,
LLM_MODEL, LLM_API_KEY).

This adapter retries only failures that may pass on their own: network
errors, timeouts, HTTP 429 and 5xx. Requests the provider refuses (a bad key,
an unknown model) fail at once with a message that says how to fix them.
Whether the reply is valid JSON for the task is checked by the caller, which
has its own retry for invalid output.
"""

import re
import time
from collections.abc import Callable

import httpx2 as httpx

from app.core.llm import LLMError, LLMRequest, LLMResponse

RETRYABLE_STATUS = {429, 500, 502, 503, 504}
MAX_BACKOFF_SECONDS = 10.0
# Reasoning models such as Qwen3 may put their thinking before the answer.
THINKING_BLOCK = re.compile(r"^\s*<think>.*?</think>\s*", re.DOTALL)


class OpenAICompatibleLLM:
    def __init__(
        self,
        *,
        base_url: str,
        model: str,
        api_key: str = "",
        timeout_seconds: float = 60.0,
        max_retries: int = 2,
        temperature: float = 0.2,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self._api_key = api_key
        self._timeout = httpx.Timeout(timeout_seconds, connect=min(5.0, timeout_seconds))
        self._timeout_seconds = timeout_seconds
        self._max_retries = max_retries
        self._temperature = temperature
        self._transport = transport
        self._sleep = sleep

    def complete(self, request: LLMRequest) -> LLMResponse:
        body = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": request.system},
                {"role": "user", "content": request.user},
            ],
            "temperature": self._temperature,
            "response_format": {"type": "json_object"},
        }
        headers = {"Authorization": f"Bearer {self._api_key}"} if self._api_key else {}

        with httpx.Client(base_url=self.base_url, timeout=self._timeout, transport=self._transport) as client:
            for attempt in range(self._max_retries + 1):
                last_attempt = attempt == self._max_retries
                try:
                    response = client.post("/chat/completions", json=body, headers=headers)
                except httpx.TimeoutException:
                    if last_attempt:
                        raise LLMError(
                            f"The LLM did not answer within {self._timeout_seconds:g} seconds."
                        ) from None
                    self._sleep(self._backoff(attempt))
                    continue
                except httpx.TransportError:
                    if last_attempt:
                        raise LLMError(
                            f"Cannot reach the LLM at {self.base_url}. Is the server running?"
                        ) from None
                    self._sleep(self._backoff(attempt))
                    continue

                if response.status_code in RETRYABLE_STATUS and not last_attempt:
                    self._sleep(self._retry_after(response) or self._backoff(attempt))
                    continue
                return self._parse(response)

        raise AssertionError("unreachable")  # The loop always returns or raises.

    def _parse(self, response: httpx.Response) -> LLMResponse:
        status = response.status_code
        if status in (401, 403):
            raise LLMError("The LLM provider rejected the API key (LLM_API_KEY).")
        if status == 404:
            raise LLMError(
                f"The model '{self.model}' was not found at {self.base_url}. "
                f"For Ollama, download it first with: ollama pull {self.model}"
            )
        if status in RETRYABLE_STATUS:
            raise LLMError(
                f"The LLM provider is busy or failing (HTTP {status}) after {self._max_retries} retries."
            )
        if status >= 400:
            raise LLMError(f"The LLM provider refused the request (HTTP {status}): {response.text[:200]}")

        try:
            data = response.json()
            content = data["choices"][0]["message"]["content"]
        except (ValueError, KeyError, IndexError, TypeError):
            raise LLMError("The LLM provider returned a response in an unexpected format.") from None
        if not isinstance(content, str) or not content.strip():
            raise LLMError("The LLM provider returned an empty reply.")

        return LLMResponse(text=THINKING_BLOCK.sub("", content), model=data.get("model") or self.model)

    def _backoff(self, attempt: int) -> float:
        return min(0.5 * 2**attempt, MAX_BACKOFF_SECONDS)

    def _retry_after(self, response: httpx.Response) -> float | None:
        value = response.headers.get("retry-after", "")
        try:
            return min(max(float(value), 0.0), MAX_BACKOFF_SECONDS)
        except ValueError:
            return None
