import pytest
from pydantic import ValidationError

from app.core.config import BACKEND_DIR, Settings

SETTING_NAMES = [name.upper() for name in Settings.model_fields]


@pytest.fixture(autouse=True)
def clear_setting_env_vars(monkeypatch):
    """Keep the developer's own shell variables out of these tests."""
    for name in SETTING_NAMES:
        monkeypatch.delenv(name, raising=False)


def test_defaults_point_at_local_services():
    settings = Settings(_env_file=None)

    assert settings.app_env == "development"
    assert settings.database_url.startswith("postgresql+psycopg://")
    assert settings.llm_base_url == "http://localhost:11434/v1"


def test_environment_variables_override_defaults(monkeypatch):
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("LLM_MODEL", "qwen3:8b")

    settings = Settings(_env_file=None)

    assert settings.app_env == "test"
    assert settings.llm_model == "qwen3:8b"


def test_reads_values_from_env_file(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("LLM_MODEL=from-file\n")

    assert Settings(_env_file=env_file).llm_model == "from-file"


def test_misspelled_key_in_env_file_is_rejected(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("DATABSE_URL=postgresql+psycopg://typo\n")

    with pytest.raises(ValidationError):
        Settings(_env_file=env_file)


def test_unknown_app_env_is_rejected(monkeypatch):
    monkeypatch.setenv("APP_ENV", "staging")

    with pytest.raises(ValidationError):
        Settings(_env_file=None)


def test_api_key_is_hidden_when_printed(monkeypatch):
    monkeypatch.setenv("LLM_API_KEY", "sk-very-secret")

    settings = Settings(_env_file=None)

    assert "sk-very-secret" not in repr(settings)
    assert "sk-very-secret" not in str(settings.model_dump())
    assert settings.llm_api_key.get_secret_value() == "sk-very-secret"


def test_env_example_lists_every_setting():
    example = (BACKEND_DIR / ".env.example").read_text()
    keys = {
        line.split("=", 1)[0]
        for line in example.splitlines()
        if line and not line.startswith("#")
    }

    assert keys == set(SETTING_NAMES)


def test_env_example_is_a_valid_configuration():
    Settings(_env_file=BACKEND_DIR / ".env.example")
