"""record where pages start in each chunk

A chunk can cover several pages; knowing where each starts lets a topic
or a verified quote be placed on its own page instead of the whole span.
Chunks saved before this have none and keep showing their span.

Revision ID: 0677b33b138f
Revises: b3fa5a7a12b7
Create Date: 2026-11-19 06:06:10.415941

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = '0677b33b138f'
down_revision: Union[str, Sequence[str], None] = 'b3fa5a7a12b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "document_chunks",
        sa.Column(
            "page_starts",
            sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("document_chunks") as batch:
        batch.drop_column("page_starts")
