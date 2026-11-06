import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db


def test_sqlite_test_database_accepts_queries(db_session):
    assert db_session.execute(text("SELECT 1")).scalar_one() == 1


def test_sqlite_test_database_enforces_foreign_keys(db_session):
    assert db_session.execute(text("PRAGMA foreign_keys")).scalar_one() == 1


def test_get_db_yields_a_session_and_closes_it():
    dependency = get_db()
    session = next(dependency)

    assert isinstance(session, Session)

    with pytest.raises(StopIteration):
        next(dependency)
    assert not session.in_transaction()


@pytest.mark.postgres
def test_configured_postgres_database_is_reachable():
    engine = create_engine(get_settings().database_url)
    try:
        with engine.connect() as connection:
            version = connection.execute(text("SHOW server_version")).scalar_one()
    except OperationalError as error:
        pytest.skip(f"PostgreSQL is not reachable: {error.orig}")
    finally:
        engine.dispose()

    assert int(version.split(".")[0]) >= 16
