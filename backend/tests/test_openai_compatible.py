import json

import httpx2 as httpx
import pytest

from app.core.config import get_settings
from app.core.llm import LLMError, LLMRequest, get_llm
from app.core.openai_compatible import OpenAICompatibleLLM

REQUEST = LLMRequest(purpose="generate_question", system="Be an interviewer.", user="Ask about overfitting.")


def chat_reply(content, model="llama3.1:8b"):
    return httpx.Response(200, json={"model": model, "choices": [{"message": {"role": "assistant", "content": content}}]})


class FakeServer:
    """Plays back a list of responses (or exceptions) and records each request."""

    def __init__(self, *outcomes):
        self.outcomes = list(outcomes)
        self.requests = []

    def __call__(self, request):
        self.requests.append(request)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def make_llm(server, **options):
    waits = []
    llm = OpenAICompatibleLLM(
        base_url="http://localhost:11434/v1",
        model="llama3.1:8b",
        transport=httpx.MockTransport(server),
        sleep=waits.append,
        **options,
    )
    return llm, waits


def test_sends_a_chat_completion_and_returns_the_text():
    server = FakeServer(chat_reply('{"type": "DIRECT"}'))
    llm, waits = make_llm(server, temperature=0.3)

    response = llm.complete(REQUEST)

    assert response.text == '{"type": "DIRECT"}'
    assert response.model == "llama3.1:8b"
    assert waits == []
    sent = server.requests[0]
    assert str(sent.url) == "http://localhost:11434/v1/chat/completions"
    assert json.loads(sent.content) == {
        "model": "llama3.1:8b",
        "messages": [
            {"role": "system", "content": "Be an interviewer."},
            {"role": "user", "content": "Ask about overfitting."},
        ],
        "temperature": 0.3,
        "response_format": {"type": "json_object"},
    }


def test_sends_the_api_key_only_when_one_is_set():
    with_key = FakeServer(chat_reply("{}"))
    make_llm(with_key, api_key="gsk-secret")[0].complete(REQUEST)
    without_key = FakeServer(chat_reply("{}"))
    make_llm(without_key)[0].complete(REQUEST)

    assert with_key.requests[0].headers["authorization"] == "Bearer gsk-secret"
    assert "authorization" not in without_key.requests[0].headers


def test_strips_a_leading_thinking_block():
    server = FakeServer(chat_reply('<think>\nLet me plan this.\n</think>\n\n{"type": "DIRECT"}'))

    assert make_llm(server)[0].complete(REQUEST).text == '{"type": "DIRECT"}'


@pytest.mark.parametrize("failure", [
    httpx.ConnectError("refused"),
    httpx.ReadTimeout("slow"),
    httpx.Response(503),
    httpx.Response(429),
])
def test_retries_temporary_failures_then_succeeds(failure):
    server = FakeServer(failure, chat_reply("{}"))
    llm, waits = make_llm(server)

    assert llm.complete(REQUEST).text == "{}"
    assert len(server.requests) == 2
    assert waits == [0.5]


def test_waits_longer_after_each_failure():
    server = FakeServer(httpx.Response(502), httpx.Response(502), httpx.Response(502), chat_reply("{}"))
    llm, waits = make_llm(server, max_retries=3)

    llm.complete(REQUEST)

    assert waits == [0.5, 1.0, 2.0]


def test_follows_retry_after_up_to_a_limit():
    server = FakeServer(
        httpx.Response(429, headers={"Retry-After": "3"}),
        httpx.Response(429, headers={"Retry-After": "120"}),
        chat_reply("{}"),
    )
    llm, waits = make_llm(server)

    llm.complete(REQUEST)

    assert waits == [3.0, 10.0]


@pytest.mark.parametrize("failure, message", [
    (httpx.ConnectError("refused"), "Cannot reach the LLM at http://localhost:11434/v1"),
    (httpx.ReadTimeout("slow"), "did not answer within 60 seconds"),
    (httpx.Response(503), r"busy or failing \(HTTP 503\) after 2 retries"),
])
def test_gives_up_after_the_retry_limit(failure, message):
    server = FakeServer(failure, failure, failure)
    llm, waits = make_llm(server)

    with pytest.raises(LLMError, match=message):
        llm.complete(REQUEST)
    assert len(server.requests) == 3
    assert waits == [0.5, 1.0]


@pytest.mark.parametrize("status, message", [
    (401, "rejected the API key"),
    (403, "rejected the API key"),
    (404, "ollama pull llama3.1:8b"),
    (400, "refused the request \\(HTTP 400\\)"),
])
def test_refused_requests_fail_at_once_with_a_fix(status, message):
    server = FakeServer(httpx.Response(status, text="nope"))
    llm, waits = make_llm(server)

    with pytest.raises(LLMError, match=message):
        llm.complete(REQUEST)
    assert len(server.requests) == 1
    assert waits == []


@pytest.mark.parametrize("response", [
    httpx.Response(200, text="<html>not json</html>"),
    httpx.Response(200, json={"choices": []}),
    httpx.Response(200, json={"error": "something"}),
    chat_reply(""),
    chat_reply(None),
])
def test_unexpected_or_empty_replies_raise(response):
    with pytest.raises(LLMError):
        make_llm(FakeServer(response))[0].complete(REQUEST)


def test_the_api_key_never_appears_in_errors():
    server = FakeServer(httpx.Response(401))
    llm, _ = make_llm(server, api_key="gsk-very-secret")

    with pytest.raises(LLMError) as error:
        llm.complete(REQUEST)

    assert "gsk-very-secret" not in str(error.value)
    assert "gsk-very-secret" not in repr(llm.__dict__.get("model"))


def test_get_llm_builds_the_adapter_from_settings(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_BASE_URL", "https://api.groq.com/openai/v1/")
    monkeypatch.setenv("LLM_MODEL", "llama-3.1-8b-instant")
    monkeypatch.setenv("LLM_TIMEOUT_SECONDS", "30")
    get_settings.cache_clear()
    try:
        llm = get_llm()
    finally:
        get_settings.cache_clear()

    assert isinstance(llm, OpenAICompatibleLLM)
    assert llm.base_url == "https://api.groq.com/openai/v1"
    assert llm.model == "llama-3.1-8b-instant"


def test_asks_reasoning_models_for_low_reasoning_only_when_set():
    with_effort = FakeServer(chat_reply("{}"))
    make_llm(with_effort, reasoning_effort="low")[0].complete(REQUEST)
    without = FakeServer(chat_reply("{}"))
    make_llm(without)[0].complete(REQUEST)

    assert json.loads(with_effort.requests[0].content)["reasoning_effort"] == "low"
    assert "reasoning_effort" not in json.loads(without.requests[0].content)


def test_the_reasoning_setting_reaches_the_adapter(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_REASONING_EFFORT", "low")
    get_settings.cache_clear()
    try:
        assert get_llm()._reasoning_effort == "low"
    finally:
        get_settings.cache_clear()


def request_for(purpose):
    return LLMRequest(purpose=purpose, system="s", user="u")


def test_each_kind_of_work_can_go_to_its_own_model():
    from app.core.llm import model_routes

    routes = model_routes("gpt-oss-20b", conversation="qwen-27b", grading="gpt-oss-120b", questions="", documents="")
    server = FakeServer(*(chat_reply("{}", model="whatever") for _ in range(4)))
    llm, _ = make_llm(server, routes=routes)

    for purpose in ("interviewer_turn", "evaluate_answer", "generate_question", "map_topics"):
        llm.complete(request_for(purpose))

    sent = [json.loads(r.content)["model"] for r in server.requests]
    assert sent == ["qwen-27b", "gpt-oss-120b", "llama3.1:8b", "llama3.1:8b"]
    assert llm.model_for("closing") == "qwen-27b" and llm.model_for("prepare_turn") == "qwen-27b"
    assert llm.model_for("evaluate_document_answer") == "gpt-oss-120b"


def test_every_prompt_purpose_belongs_to_exactly_one_kind_of_work():
    from app.core.llm import ROUTES
    from app.services.prompts import PROMPT_VERSIONS

    kinds = [kind for purpose in PROMPT_VERSIONS for kind, purposes in ROUTES.items() if purpose in purposes]
    assert len(kinds) == len(PROMPT_VERSIONS)


def test_the_model_routes_come_from_the_settings(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("LLM_MODEL", "openai/gpt-oss-20b")
    monkeypatch.setenv("LLM_MODEL_CONVERSATION", "qwen/qwen3.8-27b")
    monkeypatch.setenv("LLM_MODEL_GRADING", "openai/gpt-oss-120b")
    get_settings.cache_clear()
    try:
        llm = get_llm()
        assert llm.model_for("warm_up") == "qwen/qwen3.8-27b"
        assert llm.model_for("evaluate_answer") == "openai/gpt-oss-120b"
        assert llm.model_for("map_topics") == "openai/gpt-oss-20b"
    finally:
        get_settings.cache_clear()
