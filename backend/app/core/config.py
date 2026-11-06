from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr
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
    llm_base_url: str = "http://localhost:11434/v1"
    llm_model: str = "llama3.1:8b"
    llm_api_key: SecretStr = SecretStr("ollama")


@lru_cache
def get_settings() -> Settings:
    return Settings()
