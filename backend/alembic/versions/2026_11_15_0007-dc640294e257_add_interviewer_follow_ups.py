"""add interviewer follow-ups

Questions get a follow-up number (0 for a planned question) and the
interviewer's lead-in; answers get the interviewer's reaction to them. The uniqueness rule becomes one row per planned
question and follow-up number. Downgrading deletes follow-up questions,
with their answers, because the old rule allows only one row per number.

Revision ID: dc640294e257
Revises: 2f52b4807cdc
Create Date: 2026-11-15 00:07:37.820449

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'dc640294e257'
down_revision: Union[str, Sequence[str], None] = '2f52b4807cdc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Batch mode rebuilds the table on SQLite, which cannot change constraints in place.
    with op.batch_alter_table("questions") as batch:
        batch.add_column(sa.Column("follow_up", sa.Integer(), server_default="0", nullable=False))
        batch.add_column(sa.Column("lead_in", sa.Text(), nullable=True))
        batch.drop_constraint(op.f("uq_questions_session_id_sequence"), type_="unique")
        batch.create_unique_constraint(
            op.f("uq_questions_session_id_sequence_follow_up"), ["session_id", "sequence", "follow_up"]
        )
        batch.create_check_constraint(op.f("ck_questions_follow_up_not_negative"), "follow_up >= 0")
    op.add_column("answers", sa.Column("reaction", sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("answers") as batch:
        batch.drop_column("reaction")
    follow_ups = "SELECT id FROM questions WHERE follow_up > 0"
    op.execute(
        f"DELETE FROM evaluations WHERE answer_id IN (SELECT id FROM answers WHERE question_id IN ({follow_ups}))"
    )
    op.execute(f"DELETE FROM answers WHERE question_id IN ({follow_ups})")
    op.execute("DELETE FROM questions WHERE follow_up > 0")
    with op.batch_alter_table("questions") as batch:
        batch.drop_constraint(op.f("ck_questions_follow_up_not_negative"), type_="check")
        batch.drop_constraint(op.f("uq_questions_session_id_sequence_follow_up"), type_="unique")
        batch.create_unique_constraint(op.f("uq_questions_session_id_sequence"), ["session_id", "sequence"])
        batch.drop_column("lead_in")
        batch.drop_column("follow_up")
