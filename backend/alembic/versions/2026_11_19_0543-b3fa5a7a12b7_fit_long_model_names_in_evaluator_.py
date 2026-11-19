"""fit long model names in evaluator versions

evaluations.evaluator_version holds "<model>|<rubric>|<prompt version>".
At 50 characters, grading a document answer with the local model
(51 characters) failed on PostgreSQL; hosted model names are longer
still. Downgrading shortens values that no longer fit.

Revision ID: b3fa5a7a12b7
Revises: bc30d69b8cba
Create Date: 2026-11-19 05:43:29.180266

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b3fa5a7a12b7'
down_revision: Union[str, Sequence[str], None] = 'bc30d69b8cba'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("evaluations") as batch:
        batch.alter_column(
            "evaluator_version", existing_type=sa.String(length=50), type_=sa.String(length=255), existing_nullable=False
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("UPDATE evaluations SET evaluator_version = substr(evaluator_version, 1, 50)")
    with op.batch_alter_table("evaluations") as batch:
        batch.alter_column(
            "evaluator_version", existing_type=sa.String(length=255), type_=sa.String(length=50), existing_nullable=False
        )
