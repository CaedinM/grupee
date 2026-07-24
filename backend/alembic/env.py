"""Alembic environment.

The connection URL is NOT read from alembic.ini — it comes from DATABASE_URL via
`app.database`, so migrations always target the same database the app does (and no
credentials ever land in a committed file). Import app.models for its side effect:
that is what populates Base.metadata for autogenerate.
"""
from logging.config import fileConfig

from sqlalchemy import create_engine, pool

from alembic import context
from app import models  # noqa: F401 — registers every model on Base.metadata
from app.database import DATABASE_URL, Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata

# batch mode renders ALTERs as copy-and-move table rebuilds, which is the only
# way SQLite can apply them — harmless on Postgres, so future migrations written
# against prod still run on a local dev database.
RENDER_AS_BATCH = DATABASE_URL.startswith("sqlite")


def run_migrations_offline() -> None:
    """Emit SQL to stdout instead of running it (`alembic upgrade head --sql`)."""
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=RENDER_AS_BATCH,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # NullPool: migrations are a short-lived one-shot process, so don't hold the
    # app's pool settings open against the database.
    connectable = create_engine(DATABASE_URL, poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=RENDER_AS_BATCH,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
