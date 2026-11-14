"""Turning a sign-in provider's profile into an InterAct user.

Only four things are kept: the provider, the provider's id for the person,
a verified email and a display name. Everything else the provider sends
(avatars, locations, profile links) and every token is dropped here.
"""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import User
from app.models.enums import AuthProvider

MAX_EMAIL = 320
MAX_NAME = 200


@dataclass(frozen=True)
class Profile:
    provider: AuthProvider
    provider_user_id: str
    email: str | None
    display_name: str | None


class ProfileError(Exception):
    """The provider's profile lacks what InterAct needs to identify the person."""


def _clean_email(value: Any) -> str | None:
    if not isinstance(value, str) or "@" not in value:
        return None
    email = value.strip().lower()
    return email if len(email) <= MAX_EMAIL else None


def _clean_name(*candidates: Any) -> str | None:
    for value in candidates:
        if isinstance(value, str) and value.strip():
            return value.strip()[:MAX_NAME]
    return None


def google_profile(userinfo: dict[str, Any]) -> Profile:
    """From Google's userinfo response (scopes: email, profile)."""
    subject = userinfo.get("sub")
    if not subject:
        raise ProfileError("Google did not say who signed in.")
    verified = userinfo.get("email_verified") is True
    return Profile(
        provider=AuthProvider.GOOGLE,
        provider_user_id=str(subject),
        email=_clean_email(userinfo.get("email")) if verified else None,
        display_name=_clean_name(userinfo.get("name"), userinfo.get("given_name")),
    )


def github_profile(user: dict[str, Any], emails: list[dict[str, Any]]) -> Profile:
    """From GitHub's /user and /user/emails responses (scopes: read:user, user:email)."""
    account_id = user.get("id")
    if account_id is None:
        raise ProfileError("GitHub did not say who signed in.")
    primary = next((e for e in emails if e.get("primary") and e.get("verified")), None)
    return Profile(
        provider=AuthProvider.GITHUB,
        provider_user_id=str(account_id),
        email=_clean_email(primary.get("email")) if primary else None,
        display_name=_clean_name(user.get("name"), user.get("login")),
    )


def upsert_user(db: Session, profile: Profile) -> User:
    """The user for this provider account, created on first sign-in.

    A changed email or name is updated, so the stored copy stays current.
    """
    query = select(User).where(
        User.auth_provider == profile.provider, User.provider_user_id == profile.provider_user_id
    )
    user = db.scalar(query)
    if user is None:
        db.add(
            User(
                auth_provider=profile.provider,
                provider_user_id=profile.provider_user_id,
                email=profile.email,
                display_name=profile.display_name,
            )
        )
        try:
            db.commit()
        except IntegrityError:
            db.rollback()  # The same account signed in twice at once.
        return db.scalar(query)

    if (user.email, user.display_name) != (profile.email, profile.display_name):
        user.email = profile.email
        user.display_name = profile.display_name
        db.commit()
    return user
