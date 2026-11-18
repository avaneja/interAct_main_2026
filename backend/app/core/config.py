import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
DEV_SESSION_SECRET = "development-only-session-secret-do-not-use-in-production"
# INTERACT_ENV_FILE names another settings file; set it to "" to read none.
# The tests do that, so a developer's own backend/.env never changes them.
ENV_FILE = os.environ.get("INTERACT_ENV_FILE", str(BACKEND_DIR / ".env")) or None


class Settings(BaseSettings):
    """Backend configuration, read from environment variables and backend/.env.

    Environment variables take precedence over the .env file. Unknown keys in
    the .env file are rejected so a misspelled setting fails loudly.
    """

    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="forbid",
    )

    app_env: Literal["development", "test", "production"] = "development"
    database_url: str = "postgresql+psycopg://interact:interact@localhost:5432/interact"
    llm_provider: Literal["fake", "openai_compatible"] = "fake"
    llm_base_url: str = "http://localhost:11434/v1"
    llm_model: str = "interact-llama3.1:8b"
    llm_api_key: SecretStr = SecretStr("ollama")
    llm_timeout_seconds: float = Field(default=60.0, gt=0, le=600)
    llm_max_retries: int = Field(default=2, ge=0, le=5)
    llm_temperature: float = Field(default=0.2, ge=0, le=2)
    style_check: Literal["rules", "rules_and_llm"] = "rules_and_llm"
    # Uploaded documents (Model B). Kept outside anything served to the browser.
    upload_dir: Path = BACKEND_DIR / "uploads"
    max_upload_mb: int = Field(default=20, ge=1, le=100)

    @field_validator("upload_dir", mode="before")
    @classmethod
    def default_upload_dir(cls, value: object) -> object:
        return BACKEND_DIR / "uploads" if value in ("", None) else value
    # Where people open the app. OAuth providers send users back to
    # {public_url}/api/v1/auth/{provider}/callback, so it must match the
    # callback registered with each provider.
    public_url: str = "http://localhost:5173"
    # OAuth apps. A provider is offered only when both its values are set.
    # Secrets stay on the server: they never reach the browser or the logs.
    google_client_id: str = ""
    google_client_secret: SecretStr = SecretStr("")
    github_client_id: str = ""
    github_client_secret: SecretStr = SecretStr("")

    # Signs the session cookie. Required in production; development uses a
    # fixed placeholder so the app runs without setup.
    session_secret: SecretStr = SecretStr("")
    session_max_age_days: int = Field(default=14, ge=1, le=90)

    @field_validator("session_secret")
    @classmethod
    def default_session_secret(cls, value: SecretStr) -> SecretStr:
        return value if value.get_secret_value() else SecretStr(DEV_SESSION_SECRET)

    @model_validator(mode="after")
    def require_real_secret_in_production(self) -> "Settings":
        secret = self.session_secret.get_secret_value()
        if self.app_env == "production" and (secret == DEV_SESSION_SECRET or len(secret) < 32):
            raise ValueError("SESSION_SECRET must be a random value of at least 32 characters in production")
        return self

    # Development-only sign-in as a local test user, for working without OAuth
    # apps. Production always refuses it, whatever this says.
    dev_login: bool = True

    def dev_login_allowed(self) -> bool:
        return self.dev_login and self.app_env == "development"

    def oauth_providers(self) -> list[str]:
        """The sign-in providers whose OAuth app is configured."""
        configured = []
        if self.google_client_id and self.google_client_secret.get_secret_value():
            configured.append("google")
        if self.github_client_id and self.github_client_secret.get_secret_value():
            configured.append("github")
        return configured


@lru_cache
def get_settings() -> Settings:
    return Settings()
