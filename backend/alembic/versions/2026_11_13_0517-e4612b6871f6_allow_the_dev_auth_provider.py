"""allow the dev auth provider

Adds "dev" to the allowed users.auth_provider values, for the temporary local
user that stands in for sign-in until M4.

Revision ID: e4612b6871f6
Revises: 526c1dafc681
Create Date: 2026-11-13 05:17:05.120223

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e4612b6871f6'
down_revision: Union[str, Sequence[str], None] = '526c1dafc681'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CONSTRAINT = "ck_users_authprovider"


def _allow(providers: list[str]) -> None:
    allowed = ", ".join(f"'{p}'" for p in providers)
    # Batch mode rebuilds the table on SQLite, which cannot alter constraints.
    with op.batch_alter_table("users") as batch:
        batch.drop_constraint(op.f(CONSTRAINT), type_="check")
        batch.create_check_constraint(op.f(CONSTRAINT), f"auth_provider IN ({allowed})")


def upgrade() -> None:
    """Upgrade schema."""
    _allow(["google", "github", "dev"])


def downgrade() -> None:
    """Downgrade schema.

    Deletes the temporary dev user first, and with it everything it owns.
    """
    op.execute(sa.text("DELETE FROM users WHERE auth_provider = 'dev'"))
    _allow(["google", "github"])
