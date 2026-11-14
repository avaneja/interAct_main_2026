import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.api.deps import get_current_user
from app.core.config import get_settings
from app.models import Base, User
from app.models.enums import AuthProvider


@pytest.fixture
def db(db_engine, db_session):
    Base.metadata.create_all(db_engine)
    return db_session


@pytest.fixture
def app_env(monkeypatch):
    def set_env(value):
        monkeypatch.setenv("APP_ENV", value)
        monkeypatch.setenv("SESSION_SECRET", "x" * 40)  # Production requires a real secret.
        get_settings.cache_clear()

    yield set_env
    get_settings.cache_clear()


def test_the_temporary_user_is_created_once_and_reused(db):
    first = get_current_user(db)
    second = get_current_user(db)

    assert first.id == second.id
    assert first.auth_provider is AuthProvider.DEV
    assert db.scalar(select(func.count()).select_from(User)) == 1


def test_the_temporary_user_is_refused_in_production(db, app_env):
    app_env("production")

    with pytest.raises(HTTPException) as error:
        get_current_user(db)

    assert error.value.status_code == 503
    assert db.scalar(select(func.count()).select_from(User)) == 0
