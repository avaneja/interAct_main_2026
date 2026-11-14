"""prepare the next question ahead

Sessions keep the next planned question, written in the background while
the candidate answers, until it is asked.

Revision ID: dfec14eae4c8
Revises: dc640294e257
Create Date: 2026-11-15 02:25:44.300807

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = 'dfec14eae4c8'
down_revision: Union[str, Sequence[str], None] = 'dc640294e257'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "sessions",
        sa.Column(
            "prepared_json",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("sessions") as batch:
        batch.drop_column("prepared_json")
