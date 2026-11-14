"""The signed, HTTP-only cookie that keeps a user signed in.

Starlette's SessionMiddleware signs the cookie with SESSION_SECRET, so a
changed cookie is ignored. The cookie is always HttpOnly (page scripts cannot
read it), SameSite=Lax (other sites cannot send it with requests that change
data), and Secure in production (HTTPS only). It holds only the signed-in
user's id and, during sign-in, the OAuth state: never tokens or profile data.
"""

from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware

from app.core.config import Settings

SESSION_COOKIE = "interact_session"
SESSION_USER = "user_id"


def add_session_cookie(app: FastAPI, settings: Settings) -> None:
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret.get_secret_value(),
        session_cookie=SESSION_COOKIE,
        max_age=settings.session_max_age_days * 24 * 60 * 60,
        same_site="lax",
        https_only=settings.app_env == "production",
    )
