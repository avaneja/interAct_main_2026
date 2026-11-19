"""M10 deployment: one service serves the API and the web app; production settings are checked."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings
from app.core.frontend import IMMUTABLE, serve_frontend

PRODUCTION = {"app_env": "production", "session_secret": "s" * 40,
              "public_url": "https://interact.example", "llm_provider": "openai_compatible"}


@pytest.fixture
def dist(tmp_path):
    root = tmp_path / "dist"
    (root / "assets").mkdir(parents=True)
    (root / "vendor" / "mediapipe").mkdir(parents=True)
    (root / "index.html").write_text("<html>app</html>")
    (root / "assets" / "index-abc123.js").write_text("console.log('app')")
    (root / "vendor" / "mediapipe" / "vision.wasm").write_bytes(b"\0asm")
    (tmp_path / "secret.txt").write_text("not for the browser")
    return root


@pytest.fixture
def site(dist):
    app = FastAPI()

    @app.get("/api/v1/health")
    def health():
        return {"status": "ok"}

    serve_frontend(app, dist)
    return TestClient(app)


def test_the_web_app_is_served_with_the_api(site):
    assert site.get("/").text == "<html>app</html>"
    assert site.get("/api/v1/health").json() == {"status": "ok"}


def test_app_routes_get_index_html_so_the_browser_router_takes_over(site):
    for path in ("/new", "/sessions/123/report", "/history"):
        response = site.get(path)
        assert response.text == "<html>app</html>", path
        assert response.headers["cache-control"] == "no-cache"


def test_build_files_are_served_and_hashed_ones_cached_for_good(site):
    script = site.get("/assets/index-abc123.js")
    assert script.text == "console.log('app')" and script.headers["cache-control"] == IMMUTABLE
    assert site.get("/vendor/mediapipe/vision.wasm").content == b"\0asm"


def test_unknown_api_paths_stay_404s_not_the_web_app(site):
    response = site.get("/api/v1/nothing-here")
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_files_outside_the_build_are_never_served(site):
    for path in ("/../secret.txt", "/%2e%2e/secret.txt", "/assets/../../secret.txt"):
        assert "not for the browser" not in site.get(path).text, path


def test_a_build_without_index_html_is_refused(tmp_path):
    with pytest.raises(RuntimeError, match="index.html"):
        serve_frontend(FastAPI(), tmp_path)


@pytest.mark.parametrize("given", [
    "postgresql://user:pw@ep-cool-1.eu-central-1.aws.neon.tech/interact?sslmode=require",
    "postgres://user:pw@ep-cool-1.eu-central-1.aws.neon.tech/interact?sslmode=require",
])
def test_hosted_database_urls_use_the_psycopg_driver(given):
    url = Settings(_env_file=None, database_url=given).database_url
    assert url == "postgresql+psycopg://user:pw@ep-cool-1.eu-central-1.aws.neon.tech/interact?sslmode=require"


def test_a_complete_production_configuration_is_accepted():
    settings = Settings(_env_file=None, **PRODUCTION)
    assert settings.dev_login_allowed() is False


@pytest.mark.parametrize("change, message", [
    ({"public_url": "http://interact.example"}, "PUBLIC_URL"),
    ({"llm_provider": "fake"}, "LLM_PROVIDER"),
    ({"session_secret": "short"}, "SESSION_SECRET"),
])
def test_production_refuses_unsafe_settings(change, message):
    with pytest.raises(ValidationError, match=message):
        Settings(_env_file=None, **{**PRODUCTION, **change})


def test_development_needs_none_of_the_production_settings():
    Settings(_env_file=None, app_env="development", public_url="http://localhost:5173", llm_provider="fake")


def test_a_file_lost_with_a_temporary_disk_fails_with_a_clear_message(db_engine, db_session, tmp_path):
    from app.core.llm import FakeLLM
    from app.core.storage import FileStorage
    from app.models import Base, User
    from app.models.enums import AuthProvider, DocumentStatus
    from app.services import documents

    Base.metadata.create_all(db_engine)
    user = User(auth_provider=AuthProvider.GOOGLE, provider_user_id="1", display_name="Ada")
    db_session.add(user)
    db_session.commit()
    storage = FileStorage(tmp_path)
    document = documents.upload(db_session, user, storage, "notes.txt", b"Folds are held out once. " * 40, 2**20)
    storage.path(document.storage_key).unlink()

    documents.process(db_session, document, storage, FakeLLM())

    assert document.status is DocumentStatus.FAILED
    assert document.summary_json["error"] == "The uploaded file is no longer stored on the server. Upload it again."
