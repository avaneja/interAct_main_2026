import asyncio
import base64
import json
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.responses import RedirectResponse

from app.core.config import Settings
from app.core.oauth import AuthlibProviders, SignInFailed, get_sign_in_providers
from app.core.sessions import SESSION_COOKIE
from app.main import app
from app.models import User
from app.models.enums import AuthProvider
from app.services.accounts import Profile

ADA = Profile(AuthProvider.GITHUB, "4242", "ada@example.com", "Ada Lovelace")
PUBLIC = "http://localhost:5173"


class FakeProviders:
    """Stands in for Google and GitHub: no network, a fixed profile or failure per provider."""

    def __init__(self, **outcomes):
        self.outcomes = outcomes
        self.redirect_uris = []

    def configured(self):
        return list(self.outcomes)

    async def login_redirect(self, request, provider, redirect_uri):
        self.redirect_uris.append(redirect_uri)
        request.session["oauth_state"] = "state-123"
        return RedirectResponse(f"https://{provider}.example/authorize")

    async def fetch_profile(self, request, provider):
        outcome = self.outcomes[provider]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


@pytest.fixture
def client(anonymous_client):
    """These tests start signed out."""
    return anonymous_client


@pytest.fixture
def providers():
    fake = FakeProviders(github=ADA, google=SignInFailed("access_denied"))
    app.dependency_overrides[get_sign_in_providers] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_sign_in_providers, None)


def sign_in(client, provider="github", next_path=None):
    params = {"next": next_path} if next_path else {}
    client.get(f"/api/v1/auth/{provider}/login", params=params, follow_redirects=False)
    return client.get(f"/api/v1/auth/{provider}/callback", follow_redirects=False)


def session_data(client):
    payload = client.cookies[SESSION_COOKIE].split(".")[0]
    return json.loads(base64.b64decode(payload + "=" * (-len(payload) % 4)))


# Choosing a provider


def test_only_configured_providers_are_offered(client, providers):
    assert client.get("/api/v1/auth/providers").json() == {"providers": ["github", "google"], "dev_login": True}


@pytest.mark.parametrize("provider", ["facebook", "dev"])
def test_an_unknown_provider_is_not_found(client, providers, provider):
    assert client.get(f"/api/v1/auth/{provider}/login", follow_redirects=False).status_code == 404
    assert client.get(f"/api/v1/auth/{provider}/callback", follow_redirects=False).status_code == 404


def test_login_sends_the_user_to_the_provider_with_our_callback(client, providers):
    response = client.get("/api/v1/auth/github/login", follow_redirects=False)

    assert response.status_code in (302, 307)
    assert response.headers["location"] == "https://github.example/authorize"
    assert providers.redirect_uris == [f"{PUBLIC}/api/v1/auth/github/callback"]


# Completing sign-in


def test_callback_signs_the_user_in_and_returns_to_the_app(client, providers, db_engine):
    response = sign_in(client)

    assert response.status_code == 303
    assert response.headers["location"] == f"{PUBLIC}/"
    me = client.get("/api/v1/auth/me").json()
    assert (me["provider"], me["email"], me["display_name"]) == ("github", "ada@example.com", "Ada Lovelace")
    with Session(db_engine) as db:
        assert db.scalar(select(func.count()).select_from(User)) == 1


def test_signing_in_again_reuses_the_account(client, providers, db_engine):
    sign_in(client)
    first = client.get("/api/v1/auth/me").json()["id"]
    client.post("/api/v1/auth/logout")

    sign_in(client)

    assert client.get("/api/v1/auth/me").json()["id"] == first


def test_the_user_returns_to_the_page_they_asked_for(client, providers):
    response = sign_in(client, next_path="/history")

    assert response.headers["location"] == f"{PUBLIC}/history"


@pytest.mark.parametrize("next_path", ["//evil.example", "https://evil.example/x", "/\\evil.example", "history"])
def test_a_crafted_next_link_cannot_leave_interact(client, providers, next_path):
    response = sign_in(client, next_path=next_path)

    assert response.headers["location"] == f"{PUBLIC}/"


def test_a_failed_or_declined_sign_in_returns_to_the_sign_in_page(client, providers):
    response = sign_in(client, provider="google")

    assert response.status_code == 303
    assert response.headers["location"] == f"{PUBLIC}/sign-in?error=failed"
    assert client.get("/api/v1/auth/me").status_code == 401


def test_sign_in_starts_a_fresh_session_holding_only_the_user_id(client, providers):
    client.get("/api/v1/auth/github/login", follow_redirects=False)
    assert "oauth_state" in session_data(client)

    client.get("/api/v1/auth/github/callback", follow_redirects=False)

    data = session_data(client)
    assert list(data) == ["user_id"]
    assert data["user_id"] == client.get("/api/v1/auth/me").json()["id"]


# Me and sign-out


def test_me_needs_a_signed_in_user(client):
    response = client.get("/api/v1/auth/me")

    assert response.status_code == 401
    assert response.json() == {"detail": "You are not signed in."}


def test_a_session_for_a_deleted_user_counts_as_signed_out(client, providers, db_engine):
    sign_in(client)
    with Session(db_engine) as db:
        db.delete(db.scalar(select(User)))
        db.commit()

    assert client.get("/api/v1/auth/me").status_code == 401


def test_logout_signs_the_user_out(client, providers):
    sign_in(client)

    response = client.post("/api/v1/auth/logout")

    assert response.status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401


# The real Authlib providers, without network


def real_providers():
    return AuthlibProviders(Settings(
        _env_file=None,
        google_client_id="google-client", google_client_secret="google-secret",
        github_client_id="github-client", github_client_secret="github-secret",
    ))


@pytest.mark.parametrize("provider, host, scope", [
    ("google", "accounts.google.com", "email profile"),
    ("github", "github.com", "read:user user:email"),
])
def test_the_real_login_redirect_asks_only_for_the_minimal_scopes(client, provider, host, scope):
    app.dependency_overrides[get_sign_in_providers] = real_providers
    try:
        response = client.get(f"/api/v1/auth/{provider}/login", follow_redirects=False)
    finally:
        app.dependency_overrides.pop(get_sign_in_providers, None)

    location = urlparse(response.headers["location"])
    query = parse_qs(location.query)
    assert location.netloc == host
    assert query["client_id"] == [f"{provider}-client"]
    assert query["redirect_uri"] == [f"{PUBLIC}/api/v1/auth/{provider}/callback"]
    assert query["scope"] == [scope]
    assert query["state"][0]
    assert "secret" not in response.headers["location"]


def fake_reply(data, status=200):
    return httpx.Response(status, json=data, request=httpx.Request("GET", "https://provider.example"))


def patch_client(providers, provider, replies, monkeypatch):
    client = providers.client(provider)

    async def authorize_access_token(request):
        return {"access_token": "token-should-never-be-stored", "token_type": "bearer"}

    async def get(url, token):
        assert token["access_token"] == "token-should-never-be-stored"
        return replies[url]

    monkeypatch.setattr(client, "authorize_access_token", authorize_access_token)
    monkeypatch.setattr(client, "get", get)


def test_the_real_google_flow_reads_only_the_profile(monkeypatch):
    providers = real_providers()
    patch_client(providers, "google", {"oauth2/v3/userinfo": fake_reply(
        {"sub": "1", "email": "a@b.com", "email_verified": True, "name": "A", "picture": "x"})}, monkeypatch)

    profile = asyncio.run(providers.fetch_profile(None, "google"))

    assert profile == Profile(AuthProvider.GOOGLE, "1", "a@b.com", "A")
    assert "token" not in repr(profile)


def test_the_real_github_flow_reads_the_profile_and_primary_email(monkeypatch):
    providers = real_providers()
    patch_client(providers, "github", {
        "user": fake_reply({"id": 7, "login": "ada", "name": None}),
        "user/emails": fake_reply([{"email": "ada@b.com", "primary": True, "verified": True}]),
    }, monkeypatch)

    profile = asyncio.run(providers.fetch_profile(None, "github"))

    assert profile == Profile(AuthProvider.GITHUB, "7", "ada@b.com", "ada")


def test_a_provider_error_becomes_a_failed_sign_in(monkeypatch):
    providers = real_providers()
    patch_client(providers, "github", {"user": fake_reply({"message": "Bad credentials"}, status=401),
                                       "user/emails": fake_reply([], status=401)}, monkeypatch)

    with pytest.raises(SignInFailed):
        asyncio.run(providers.fetch_profile(None, "github"))
