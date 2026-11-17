"""store delivery and focus numbers

Answers keep how they were given: timing, pace, filler words and, with
consent, focus estimates. Numbers only, never media.

Revision ID: 0ece89f209ee
Revises: dfec14eae4c8
Create Date: 2026-11-18 00:16:28.217936

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '0ece89f209ee'
down_revision: Union[str, Sequence[str], None] = 'dfec14eae4c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "answers",
        sa.Column(
            "delivery_json",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("answers") as batch:
        batch.drop_column("delivery_json")
