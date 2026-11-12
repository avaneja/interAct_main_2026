from sqlalchemy import String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAtMixin, IdMixin, enum_type
from app.models.enums import AuthProvider


class User(IdMixin, CreatedAtMixin, Base):
    """A signed-in person. Only the minimum profile from the OAuth provider is kept."""

    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("auth_provider", "provider_user_id"),)

    auth_provider: Mapped[AuthProvider] = mapped_column(enum_type(AuthProvider))
    provider_user_id: Mapped[str] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(320))
    display_name: Mapped[str | None] = mapped_column(String(200))
    default_avatar_key: Mapped[str | None] = mapped_column(String(64))
