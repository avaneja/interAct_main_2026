import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.llm import LLMClient, get_llm
from app.core.sessions import SESSION_USER
from app.models import User

DbSession = Annotated[Session, Depends(get_db)]


def get_optional_user(request: Request, db: DbSession) -> User | None:
    """The user named in the signed session cookie, or None when signed out."""
    try:
        user_id = uuid.UUID(request.session.get(SESSION_USER, ""))
    except ValueError:
        return None
    return db.get(User, user_id)


def get_current_user(user: Annotated[User | None, Depends(get_optional_user)]) -> User:
    """The signed-in user; every request without one gets 401."""
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "You are not signed in.")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[User | None, Depends(get_optional_user)]
LLM = Annotated[LLMClient, Depends(get_llm)]
