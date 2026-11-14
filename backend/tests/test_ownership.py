"""M4 "done when": one user cannot access another user's sessions."""

import base64
import json

import pytest
from fastapi.testclient import TestClient
from starlette.responses import RedirectResponse

from app.core.config import get_settings
from app.core.oauth import get_sign_in_providers
from app.core.sessions import SESSION_COOKIE
from app.main import app
from app.models.enums import AuthProvider
from app.services.accounts import Profile

ADA = Profile(AuthProvider.GITHUB, "1", "ada@example.com", "Ada")
BOB = Profile(AuthProvider.GOOGLE, "2", "bob@example.com", "Bob")
ANSWER = "A detailed answer about the topic " * 7
CONTEXT = {"input_model": "TOPIC", "topic": "Operating systems", "subtopics": ["processes"]}
CONFIG = {"question_type": "DIRECT", "difficulty": "beginner", "question_count": 5}


class TwoAccounts:
    def configured(self):
        return ["github", "google"]

    async def login_redirect(self, request, provider, redirect_uri):
        return RedirectResponse("https://provider.example/authorize")

    async def fetch_profile(self, request, provider):
        return ADA if provider == "github" else BOB


@pytest.fixture
def ada(anonymous_client):
    app.dependency_overrides[get_sign_in_providers] = TwoAccounts
    anonymous_client.get("/api/v1/auth/github/callback", follow_redirects=False)
    return anonymous_client


@pytest.fixture
def bob(ada):
    # A second browser: the same app and database, its own cookies.
    with TestClient(app) as browser:
        browser.get("/api/v1/auth/google/callback", follow_redirects=False)
        yield browser


@pytest.fixture
def adas_session(ada):
    sid = ada.post("/api/v1/sessions", json={"input_model": "TOPIC"}).json()["id"]
    ada.put(f"/api/v1/sessions/{sid}/context", json=CONTEXT)
    ada.put(f"/api/v1/sessions/{sid}/config", json=CONFIG)
    ada.post(f"/api/v1/sessions/{sid}/confirm")
    question = ada.post(f"/api/v1/sessions/{sid}/start").json()
    ada.post(f"/api/v1/sessions/{sid}/answers", json={"question_id": question["id"], "text": ANSWER})
    return sid, ada.get(f"/api/v1/sessions/{sid}/current-question").json()["id"]


def every_session_request(sid, question_id):
    return [
        ("GET", f"/api/v1/sessions/{sid}", None),
        ("PUT", f"/api/v1/sessions/{sid}/context", CONTEXT),
        ("PUT", f"/api/v1/sessions/{sid}/config", CONFIG),
        ("POST", f"/api/v1/sessions/{sid}/confirm", None),
        ("POST", f"/api/v1/sessions/{sid}/start", None),
        ("GET", f"/api/v1/sessions/{sid}/current-question", None),
        ("POST", f"/api/v1/sessions/{sid}/answers", {"question_id": question_id, "text": "Bob's answer"}),
        ("POST", f"/api/v1/sessions/{sid}/retry", None),
        ("POST", f"/api/v1/sessions/{sid}/pause", None),
        ("POST", f"/api/v1/sessions/{sid}/resume", None),
        ("POST", f"/api/v1/sessions/{sid}/finish", None),
        ("GET", f"/api/v1/sessions/{sid}/report", None),
    ]


def test_another_user_cannot_read_or_change_a_session(ada, bob, adas_session):
    sid, question_id = adas_session
    before = ada.get(f"/api/v1/sessions/{sid}").json()

    for method, path, body in every_session_request(sid, question_id):
        response = bob.request(method, path, json=body)
        assert response.status_code == 404, f"{method} {path} gave {response.status_code}"

    after = ada.get(f"/api/v1/sessions/{sid}").json()
    assert after == before
    assert ada.get(f"/api/v1/sessions/{sid}/current-question").json()["id"] == question_id


def test_another_users_session_looks_the_same_as_a_missing_one(ada, bob, adas_session):
    sid, _ = adas_session

    theirs = bob.get(f"/api/v1/sessions/{sid}")
    missing = bob.get("/api/v1/sessions/00000000-0000-4000-8000-000000000000")

    assert (theirs.status_code, theirs.json()) == (missing.status_code, missing.json())


def test_history_lists_only_your_own_sessions(ada, bob, adas_session):
    sid, _ = adas_session
    bobs = bob.post("/api/v1/sessions", json={"input_model": "TOPIC"}).json()["id"]

    assert [s["id"] for s in ada.get("/api/v1/sessions").json()] == [sid]
    assert [s["id"] for s in bob.get("/api/v1/sessions").json()] == [bobs]


def test_each_browser_sees_its_own_account(ada, bob):
    assert ada.get("/api/v1/auth/me").json()["display_name"] == "Ada"
    assert bob.get("/api/v1/auth/me").json()["display_name"] == "Bob"


def test_signed_out_requests_are_refused_everywhere(anonymous_client):
    sid = "00000000-0000-4000-8000-000000000000"
    requests = every_session_request(sid, sid) + [
        ("GET", "/api/v1/sessions", None),
        ("POST", "/api/v1/sessions", {"input_model": "TOPIC"}),
    ]

    for method, path, body in requests:
        response = anonymous_client.request(method, path, json=body)
        assert response.status_code == 401, f"{method} {path} gave {response.status_code}"
        assert response.json() == {"detail": "You are not signed in."}


def test_signing_out_ends_access(ada, adas_session):
    sid, _ = adas_session

    ada.post("/api/v1/auth/logout")

    assert ada.get(f"/api/v1/sessions/{sid}").status_code == 401


# The development sign-in


@pytest.fixture
def settings_env(monkeypatch):
    def set_env(**values):
        for name, value in values.items():
            monkeypatch.setenv(name, value)
        get_settings.cache_clear()

    yield set_env
    get_settings.cache_clear()


def test_development_sign_in_works_in_development(anonymous_client):
    assert anonymous_client.post("/api/v1/auth/dev/login").status_code == 204
    assert anonymous_client.get("/api/v1/auth/me").json()["provider"] == "dev"


def test_development_sign_in_keeps_only_the_user_id_in_the_cookie(anonymous_client):
    anonymous_client.post("/api/v1/auth/dev/login")

    payload = anonymous_client.cookies[SESSION_COOKIE].split(".")[0]
    data = json.loads(base64.b64decode(payload + "=" * (-len(payload) % 4)))
    assert data == {"user_id": anonymous_client.get("/api/v1/auth/me").json()["id"]}


@pytest.mark.parametrize("env", [
    {"APP_ENV": "production", "SESSION_SECRET": "s" * 40, "DEV_LOGIN": "true"},
    {"APP_ENV": "test"},
    {"APP_ENV": "development", "DEV_LOGIN": "false"},
])
def test_development_sign_in_is_refused_outside_development(anonymous_client, settings_env, env):
    settings_env(**env)

    assert anonymous_client.post("/api/v1/auth/dev/login").status_code == 404
    assert anonymous_client.get("/api/v1/auth/providers").json()["dev_login"] is False
    assert anonymous_client.get("/api/v1/auth/me").status_code == 401
