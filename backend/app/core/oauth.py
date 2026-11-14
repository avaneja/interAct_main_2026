"""Google and GitHub sign-in through Authlib.

The routes use the SignInProviders interface, so tests can replace the real
providers with a fake. Provider endpoints are fixed here instead of being
discovered at start-up, so the app needs no network to start. Access tokens
are used once to read the profile and then dropped; nothing stores them.
"""

from typing import Protocol

from authlib.integrations.starlette_client import OAuth, OAuthError
from fastapi import Request
from starlette.responses import Response

from app.core.config import Settings, get_settings
from app.services.accounts import Profile, ProfileError, github_profile, google_profile

PROVIDERS = {
    "google": {
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "access_token_url": "https://oauth2.googleapis.com/token",
        "api_base_url": "https://www.googleapis.com/",
        "client_kwargs": {"scope": "email profile"},
    },
    "github": {
        "authorize_url": "https://github.com/login/oauth/authorize",
        "access_token_url": "https://github.com/login/oauth/access_token",
        "api_base_url": "https://api.github.com/",
        "client_kwargs": {"scope": "read:user user:email"},
    },
}


class SignInFailed(Exception):
    """Sign-in did not complete: the user declined, the state did not match, or the provider failed."""


class SignInProviders(Protocol):
    def configured(self) -> list[str]: ...

    async def login_redirect(self, request: Request, provider: str, redirect_uri: str) -> Response: ...

    async def fetch_profile(self, request: Request, provider: str) -> Profile: ...


class AuthlibProviders:
    def __init__(self, settings: Settings):
        self._oauth = OAuth()
        self._configured = settings.oauth_providers()
        secrets = {
            "google": (settings.google_client_id, settings.google_client_secret),
            "github": (settings.github_client_id, settings.github_client_secret),
        }
        for name in self._configured:
            client_id, client_secret = secrets[name]
            self._oauth.register(
                name,
                client_id=client_id,
                client_secret=client_secret.get_secret_value(),
                **PROVIDERS[name],
            )

    def configured(self) -> list[str]:
        return list(self._configured)

    def client(self, provider: str):
        return self._oauth.create_client(provider)

    async def login_redirect(self, request: Request, provider: str, redirect_uri: str) -> Response:
        return await self.client(provider).authorize_redirect(request, redirect_uri)

    async def fetch_profile(self, request: Request, provider: str) -> Profile:
        client = self.client(provider)
        try:
            token = await client.authorize_access_token(request)
            if provider == "google":
                userinfo = await client.get("oauth2/v3/userinfo", token=token)
                userinfo.raise_for_status()
                return google_profile(userinfo.json())
            user = await client.get("user", token=token)
            emails = await client.get("user/emails", token=token)
            user.raise_for_status()
            return github_profile(user.json(), emails.json() if emails.is_success else [])
        except (OAuthError, ProfileError) as error:
            raise SignInFailed(str(error)) from error
        except Exception as error:  # Network failures and unexpected provider replies.
            raise SignInFailed(f"{provider} could not be reached") from error


_cached: tuple[Settings, AuthlibProviders] | None = None


def get_sign_in_providers() -> SignInProviders:
    """FastAPI dependency for the configured sign-in providers, built once per settings."""
    global _cached
    settings = get_settings()
    if _cached is None or _cached[0] is not settings:
        _cached = (settings, AuthlibProviders(settings))
    return _cached[1]
