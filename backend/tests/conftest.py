import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.database import get_db
from app.core.llm import FakeLLM, get_llm
from app.main import app
from app.models import Base


@pytest.fixture
def db_engine():
    """A fresh in-memory SQLite database for each test.

    StaticPool keeps one shared connection, so the database survives across
    threads such as FastAPI's TestClient. SQLite ignores foreign keys unless
    asked, so they are switched on to match PostgreSQL.
    """
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection, _):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")

    yield engine
    engine.dispose()


@pytest.fixture
def db_session(db_engine):
    with Session(db_engine) as session:
        yield session


@pytest.fixture
def fake_llm():
    return FakeLLM()


@pytest.fixture
def client(db_engine, fake_llm):
    """The real app on a fresh in-memory database, with FakeLLM as the model."""
    Base.metadata.create_all(db_engine)

    def test_db():
        with Session(db_engine) as session:
            yield session

    app.dependency_overrides[get_db] = test_db
    app.dependency_overrides[get_llm] = lambda: fake_llm
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
