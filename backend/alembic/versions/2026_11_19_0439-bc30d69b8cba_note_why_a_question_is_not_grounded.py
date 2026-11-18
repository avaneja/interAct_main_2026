"""note why a question is not grounded

A document question whose supporting quote is not found in its source
keeps the reason, shown in the report.

Revision ID: bc30d69b8cba
Revises: 2a77df7185db
Create Date: 2026-11-19 04:39:26.330859

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bc30d69b8cba'
down_revision: Union[str, Sequence[str], None] = '2a77df7185db'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("questions", sa.Column("grounding_note", sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("questions") as batch:
        batch.drop_column("grounding_note")
