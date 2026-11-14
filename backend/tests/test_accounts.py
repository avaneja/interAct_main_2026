from dataclasses import fields

import pytest
from sqlalchemy import func, inspect, select

from app.models import Base, User
from app.models.enums import AuthProvider
from app.services.accounts import Profile, ProfileError, github_profile, google_profile, upsert_user

GOOGLE_USERINFO = {
    "sub": "109876543210",
    "email": "Ada.Lovelace@Example.com",
    "email_verified": True,
    "name": "Ada Lovelace",
    "given_name": "Ada",
    "picture": "https://example.com/ada.png",
    "locale": "en-GB",
}

GITHUB_USER = {
    "id": 4242,
    "login": "ada",
    "name": "Ada Lovelace",
    "email": "public@example.com",
    "avatar_url": "https://example.com/ada.png",
    "location": "London",
    "bio": "Analyst",
}

GITHUB_EMAILS = [
    {"email": "old@example.com", "primary": False, "verified": True},
    {"email": "Ada@Example.com", "primary": True, "verified": True},
]


# Only four things are kept


def test_the_profile_has_exactly_four_fields():
    assert [f.name for f in fields(Profile)] == ["provider", "provider_user_id", "email", "display_name"]


def test_google_profile_keeps_id_verified_email_and_name_only():
    profile = google_profile(GOOGLE_USERINFO)

    assert profile == Profile(AuthProvider.GOOGLE, "109876543210", "ada.lovelace@example.com", "Ada Lovelace")


def test_an_unverified_google_email_is_not_kept():
    profile = google_profile({**GOOGLE_USERINFO, "email_verified": False})

    assert profile.email is None


def test_github_profile_uses_the_verified_primary_email():
    profile = github_profile(GITHUB_USER, GITHUB_EMAILS)

    assert profile == Profile(AuthProvider.GITHUB, "4242", "ada@example.com", "Ada Lovelace")


def test_github_without_a_verified_primary_email_keeps_no_email():
    emails = [{"email": "ada@example.com", "primary": True, "verified": False}]

    assert github_profile(GITHUB_USER, emails).email is None


def test_github_falls_back_to_the_login_name():
    assert github_profile({"id": 1, "login": "ada", "name": None}, []).display_name == "ada"


@pytest.mark.parametrize("make", [
    lambda: google_profile({"email": "a@example.com"}),
    lambda: github_profile({"login": "ada"}, []),
])
def test_a_profile_without_an_account_id_is_refused(make):
    with pytest.raises(ProfileError):
        make()


def test_over_long_values_are_trimmed_or_dropped():
    profile = google_profile({"sub": "1", "email": "a" * 320 + "@x.com", "email_verified": True, "name": "N" * 500})

    assert profile.email is None
    assert len(profile.display_name) == 200


# Storing the user


@pytest.fixture
def db(db_engine, db_session):
    Base.metadata.create_all(db_engine)
    return db_session


def test_the_users_table_has_no_column_for_anything_else(db_engine):
    Base.metadata.create_all(db_engine)

    columns = {c["name"] for c in inspect(db_engine).get_columns("users")}

    assert columns == {"id", "auth_provider", "provider_user_id", "email", "display_name",
                       "default_avatar_key", "created_at"}


def test_first_sign_in_creates_the_user_and_later_ones_reuse_it(db):
    first = upsert_user(db, google_profile(GOOGLE_USERINFO))
    again = upsert_user(db, google_profile(GOOGLE_USERINFO))

    assert first.id == again.id
    assert db.scalar(select(func.count()).select_from(User)) == 1


def test_a_changed_name_or_email_is_updated(db):
    user = upsert_user(db, google_profile(GOOGLE_USERINFO))

    upsert_user(db, google_profile({**GOOGLE_USERINFO, "name": "Ada King", "email": "ada@new.example"}))

    db.refresh(user)
    assert (user.email, user.display_name) == ("ada@new.example", "Ada King")


def test_the_same_id_on_another_provider_is_another_user(db):
    google = upsert_user(db, Profile(AuthProvider.GOOGLE, "42", None, "A"))
    github = upsert_user(db, Profile(AuthProvider.GITHUB, "42", None, "A"))

    assert google.id != github.id
