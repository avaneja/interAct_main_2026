from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    """Backend configuration, read from environment variables and backend/.env.

    Environment variables take precedence over the .env file. Unknown keys in
    the .env file are rejected so a misspelled setting fails loudly.
    """

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
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
