from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.llm import LLMClient, get_llm
from app.models import User
from app.models.enums import AuthProvider

DEV_USER_ID = "local-dev"


def get_current_user(db: Annotated[Session, Depends(get_db)]) -> User:
    """Temporary until M4: every request acts as one local developer account.

    Refused in production, so the deployed demo can never run without sign-in.
    """
    if get_settings().app_env == "production":
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Sign-in is not available yet.")

    query = select(User).where(
        User.auth_provider == AuthProvider.DEV, User.provider_user_id == DEV_USER_ID
    )
    user = db.scalar(query)
    if user is None:
        db.add(
            User(
                auth_provider=AuthProvider.DEV,
                provider_user_id=DEV_USER_ID,
                display_name="Local developer",
            )
        )
        try:
            db.commit()
        except IntegrityError:
            # Another request created it at the same moment.
            db.rollback()
        user = db.scalar(query)
    return user


DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
LLM = Annotated[LLMClient, Depends(get_llm)]
