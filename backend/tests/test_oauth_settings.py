import pytest

from app.core.config import BACKEND_DIR, Settings

PROVIDER_VARIABLES = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"]


@pytest.fixture(autouse=True)
def no_provider_env(monkeypatch):
    for name in PROVIDER_VARIABLES:
        monkeypatch.delenv(name, raising=False)


def test_no_provider_is_offered_until_its_app_is_configured():
    assert Settings(_env_file=None).oauth_providers() == []


@pytest.mark.parametrize("variables, expected", [
    ({"GOOGLE_CLIENT_ID": "g-id", "GOOGLE_CLIENT_SECRET": "g-secret"}, ["google"]),
    ({"GITHUB_CLIENT_ID": "h-id", "GITHUB_CLIENT_SECRET": "h-secret"}, ["github"]),
    ({"GOOGLE_CLIENT_ID": "g-id"}, []),  # A client id alone is not enough.
    ({"GITHUB_CLIENT_SECRET": "h-secret"}, []),
])
def test_a_provider_needs_both_its_client_id_and_secret(monkeypatch, variables, expected):
    for name, value in variables.items():
        monkeypatch.setenv(name, value)

    assert Settings(_env_file=None).oauth_providers() == expected


def test_client_secrets_never_appear_when_settings_are_printed(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "google-very-secret")
    monkeypatch.setenv("GITHUB_CLIENT_SECRET", "github-very-secret")

    settings = Settings(_env_file=None)

    for text in (repr(settings), str(settings.model_dump())):
        assert "google-very-secret" not in text
        assert "github-very-secret" not in text


def test_the_committed_example_holds_no_secrets():
    example = dict(
        line.split("=", 1)
        for line in (BACKEND_DIR / ".env.example").read_text().splitlines()
        if line and not line.startswith("#")
    )

    assert example["GOOGLE_CLIENT_SECRET"] == ""
    assert example["GITHUB_CLIENT_SECRET"] == ""
