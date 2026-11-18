"""store the last page of each chunk

A chunk can run across a page break, so it keeps its last page as well
as its first; citations can then say "pages 3-4".

Revision ID: 2a77df7185db
Revises: 9a65bdebfcb4
Create Date: 2026-11-19 04:29:38.354787

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2a77df7185db'
down_revision: Union[str, Sequence[str], None] = '9a65bdebfcb4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("document_chunks", sa.Column("page_end", sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("document_chunks") as batch:
        batch.drop_column("page_end")
