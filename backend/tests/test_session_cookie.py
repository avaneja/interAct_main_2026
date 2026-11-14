import base64
import json

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import DEV_SESSION_SECRET, Settings
from app.core.sessions import SESSION_COOKIE, add_session_cookie


def make_client(**settings):
    app = FastAPI()
    add_session_cookie(app, Settings(_env_file=None, **settings))

    @app.post("/sign-in")
    def sign_in(request: Request):
        request.session["user_id"] = "user-123"
        return {}

    @app.get("/whoami")
    def whoami(request: Request):
        return {"user_id": request.session.get("user_id")}

    return TestClient(app, base_url="https://testserver")


def cookie_header(client):
    return client.post("/sign-in").headers["set-cookie"]


def test_the_cookie_keeps_the_user_signed_in():
    client = make_client()
    client.post("/sign-in")

    assert client.get("/whoami").json() == {"user_id": "user-123"}


def test_the_cookie_is_http_only_lax_and_lasts_14_days():
    header = cookie_header(make_client()).lower()

    assert header.startswith(f"{SESSION_COOKIE}=")
    assert "httponly" in header
    assert "samesite=lax" in header
    assert "path=/" in header
    assert f"max-age={14 * 24 * 60 * 60}" in header
    assert "secure" not in header  # Plain HTTP works in development.


def test_the_cookie_is_https_only_in_production():
    header = cookie_header(make_client(app_env="production", session_secret="s" * 40)).lower()

    assert "secure" in header


def test_the_cookie_holds_only_the_user_id():
    value = cookie_header(make_client()).split(";")[0].split("=", 1)[1]
    payload = value.split(".")[0]

    data = json.loads(base64.b64decode(payload + "=" * (-len(payload) % 4)))

    assert data == {"user_id": "user-123"}


def test_a_changed_cookie_is_ignored():
    genuine = make_client()
    genuine.post("/sign-in")
    value = genuine.cookies[SESSION_COOKIE]
    forged = base64.b64encode(json.dumps({"user_id": "someone-else"}).encode()).decode()
    attacker = make_client()  # Sends only the forged cookie.
    attacker.cookies.set(SESSION_COOKIE, forged + value[value.index("."):])

    assert attacker.get("/whoami").json() == {"user_id": None}


def test_a_cookie_signed_with_another_secret_is_ignored():
    first = make_client(session_secret="a" * 40)
    first.post("/sign-in")
    second = make_client(session_secret="b" * 40)
    second.cookies.set(SESSION_COOKIE, first.cookies[SESSION_COOKIE])

    assert second.get("/whoami").json() == {"user_id": None}


def test_development_runs_without_a_secret():
    assert Settings(_env_file=None).session_secret.get_secret_value() == DEV_SESSION_SECRET


@pytest.mark.parametrize("secret", ["", "too-short", DEV_SESSION_SECRET])
def test_production_refuses_a_missing_short_or_placeholder_secret(secret):
    with pytest.raises(ValidationError, match="SESSION_SECRET"):
        Settings(_env_file=None, app_env="production", session_secret=secret)


def test_the_session_secret_never_prints():
    settings = Settings(_env_file=None, session_secret="a-very-private-session-secret-value")

    assert "a-very-private-session-secret-value" not in repr(settings)
