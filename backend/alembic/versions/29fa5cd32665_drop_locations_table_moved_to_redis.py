"""drop locations table (moved to Redis)

Live positions now live in Redis (app/redis_client.py), keyed per user with a
staleness TTL — the main database no longer stores location at all. This drops
the now-unused `locations` table.

Autogenerate also flagged a NUMERIC->TZDateTime "type change" on
events.starts_at/ends_at; that is cosmetic (those columns were added by the old
ensure_columns() as `TIMESTAMP WITH TIME ZONE`, which SQLite reports with NUMERIC
affinity) and has been dropped from this revision so it doesn't rebuild the
events table for nothing.

Revision ID: 29fa5cd32665
Revises: 9b84bb2b671e
Create Date: 2026-07-24 12:47:19.293933
"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "29fa5cd32665"
down_revision: Union[str, Sequence[str], None] = "9b84bb2b671e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_table("locations")


def downgrade() -> None:
    """Downgrade schema — recreate the table as the baseline defined it. Any
    positions that lived here are gone; they're disposable, latest-only data."""
    op.create_table(
        "locations",
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("heading", sa.Float(), nullable=True),
        sa.Column("battery", sa.Integer(), nullable=True),
        sa.Column("accuracy", sa.Float(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
