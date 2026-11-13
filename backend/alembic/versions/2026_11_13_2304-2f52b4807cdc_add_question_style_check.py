"""add question style check

Records whether each generated question matches its requested style.
Existing questions are marked UNCHECKED.

Revision ID: 2f52b4807cdc
Revises: e4612b6871f6
Create Date: 2026-11-13 23:04:19.468695

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2f52b4807cdc'
down_revision: Union[str, Sequence[str], None] = 'e4612b6871f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Batch mode rebuilds the table on SQLite, which cannot add a CHECK or drop a column in place.
    with op.batch_alter_table("questions") as batch:
        batch.add_column(sa.Column('style_status', sa.Enum('PASSED', 'FLAGGED', 'UNCHECKED', name='stylestatus', native_enum=False, create_constraint=True), server_default='UNCHECKED', nullable=False))
        batch.add_column(sa.Column('style_note', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("questions") as batch:
        # The CHECK must go first, or the rebuilt SQLite table would still refer to the column.
        batch.drop_constraint(op.f("ck_questions_stylestatus"), type_="check")
        batch.drop_column('style_note')
        batch.drop_column('style_status')
