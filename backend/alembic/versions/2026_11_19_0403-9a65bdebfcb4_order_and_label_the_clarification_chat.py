"""order and label the clarification chat

Clarification messages get their position in the chat (timestamps can
tie) and a kind: the candidate's request, reply or skip, or the planner's
question or summary. Messages saved before this have none of these and
are deleted; nothing wrote them before M8.

Revision ID: 9a65bdebfcb4
Revises: 0ece89f209ee
Create Date: 2026-11-19 04:03:11.476332

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9a65bdebfcb4'
down_revision: Union[str, Sequence[str], None] = '0ece89f209ee'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("DELETE FROM preparation_messages")
    # Batch mode rebuilds the table on SQLite, which cannot add constraints in place.
    with op.batch_alter_table("preparation_messages") as batch:
        batch.add_column(sa.Column("position", sa.Integer(), nullable=False))
        batch.add_column(sa.Column("kind", sa.String(length=16), nullable=False))
        batch.create_unique_constraint(
            op.f("uq_preparation_messages_session_id_position"), ["session_id", "position"]
        )
        batch.create_check_constraint(op.f("ck_preparation_messages_position_positive"), "position >= 1")
        batch.create_check_constraint(
            op.f("ck_preparation_messages_kind_known"),
            "kind IN ('request', 'reply', 'skip', 'question', 'summary')",
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("preparation_messages") as batch:
        batch.drop_constraint(op.f("ck_preparation_messages_kind_known"), type_="check")
        batch.drop_constraint(op.f("ck_preparation_messages_position_positive"), type_="check")
        batch.drop_constraint(op.f("uq_preparation_messages_session_id_position"), type_="unique")
        batch.drop_column("kind")
        batch.drop_column("position")
