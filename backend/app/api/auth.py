"""Sign-in with Google or GitHub, the signed-in user, and sign-out."""

import uuid
from typing import Annotated
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from starlette.responses import RedirectResponse, Response

from app.api.deps import CurrentUser, DbSession
from app.core.config import get_settings
from app.core.oauth import SignInFailed, SignInProviders, get_sign_in_providers
from app.core.sessions import SESSION_USER
from app.models.enums import AuthProvider
from app.services.accounts import Profile, upsert_user

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

Providers = Annotated[SignInProviders, Depends(get_sign_in_providers)]
SESSION_NEXT = "next"
DEV_ACCOUNT_ID = "local-dev"


class Me(BaseModel):
    id: uuid.UUID
    provider: AuthProvider
    email: str | None
    display_name: str | None
    default_avatar_key: str | None


class SignInOptions(BaseModel):
    providers: list[str]
    dev_login: bool


def _safe_next(path: str | None) -> str:
    """Only paths inside InterAct, so a crafted link cannot send users to another site."""
    if path and path.startswith("/") and not path.startswith("//") and "\\" not in path:
        return path
    return "/"


def _frontend(path: str, **query: str) -> str:
    return get_settings().public_url.rstrip("/") + path + (f"?{urlencode(query)}" if query else "")


@router.get("/providers")
def sign_in_options(providers: Providers) -> SignInOptions:
    """Which sign-in buttons to show. Never includes secrets."""
    return SignInOptions(providers=providers.configured(), dev_login=get_settings().dev_login_allowed())


@router.post("/dev/login", status_code=status.HTTP_204_NO_CONTENT)
def dev_login(request: Request, db: DbSession) -> None:
    """Sign in as a local test user. Development only; production always refuses."""
    if not get_settings().dev_login_allowed():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Development sign-in is not available.")
    user = upsert_user(db, Profile(AuthProvider.DEV, DEV_ACCOUNT_ID, None, "Local test user"))
    request.session.clear()
    request.session[SESSION_USER] = str(user.id)


@router.get("/{provider}/login")
async def login(provider: str, request: Request, providers: Providers, next: str | None = None) -> Response:
    if provider not in providers.configured():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Sign-in with {provider} is not available.")
    request.session[SESSION_NEXT] = _safe_next(next)
    redirect_uri = _frontend(f"/api/v1/auth/{provider}/callback")
    return await providers.login_redirect(request, provider, redirect_uri)


@router.get("/{provider}/callback")
async def callback(provider: str, request: Request, providers: Providers, db: DbSession) -> RedirectResponse:
    if provider not in providers.configured():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Sign-in with {provider} is not available.")
    next_path = _safe_next(request.session.get(SESSION_NEXT))
    try:
        profile = await providers.fetch_profile(request, provider)
    except SignInFailed:
        request.session.clear()
        return RedirectResponse(_frontend("/sign-in", error="failed"), status.HTTP_303_SEE_OTHER)

    user = upsert_user(db, profile)
    # A fresh session on sign-in, so a session planted before it cannot be reused.
    request.session.clear()
    request.session[SESSION_USER] = str(user.id)
    return RedirectResponse(_frontend(next_path), status.HTTP_303_SEE_OTHER)


@router.get("/me")
def me(user: CurrentUser) -> Me:
    return Me(
        id=user.id,
        provider=user.auth_provider,
        email=user.email,
        display_name=user.display_name,
        default_avatar_key=user.default_avatar_key,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request) -> None:
    request.session.clear()
