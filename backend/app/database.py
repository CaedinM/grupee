"""Engine, session factory, declarative base, and the per-request session dependency."""
import os
import re

from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.engine.url import make_url
from sqlalchemy.exc import ArgumentError
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()


def _redact(url: str) -> str:
    """The value with any password starred out — safe to put in a log line.
    Deliberately loose about the surrounding shape: this runs on values that
    failed to parse, so it cannot assume a well-formed `scheme://user:pass@`."""
    return re.sub(r":[^:@]*@", ":***@", url)


def normalize_database_url(url: str) -> str:
    """Turn whatever the platform hands us into a URL SQLAlchemy accepts, or
    fail with a message that says which of the usual mistakes was made — the
    raw SQLAlchemy parse error names neither the variable nor its value."""
    url = url.strip().strip("'\"")  # stray quotes around a pasted value

    if "${{" in url or url.startswith("$"):
        raise RuntimeError(
            f"DATABASE_URL is an unresolved variable reference ({url!r}). On Railway the "
            "reference must name the database service exactly as it appears in the project "
            "— if the service is called 'Postgres' that is ${{Postgres.DATABASE_URL}}, but a "
            "service named e.g. 'wyat-db' needs ${{wyat-db.DATABASE_URL}}. A dangling "
            "reference is passed through as literal text."
        )

    # Railway and Heroku-style providers emit `postgres://`, a scheme SQLAlchemy
    # 2.0 dropped. Rewrite it to the driver we actually install.
    if url.startswith("postgres://"):
        url = "postgresql+psycopg2://" + url[len("postgres://") :]

    try:
        make_url(url)
    except ArgumentError as exc:
        raise RuntimeError(
            f"DATABASE_URL is not a valid SQLAlchemy URL: {_redact(url)!r} ({exc}). "
            "Expected something like postgresql://user:password@host:5432/railway"
        ) from exc

    return url


# Exported so alembic/env.py resolves the URL exactly the way the app does.
DATABASE_URL = normalize_database_url(os.getenv("DATABASE_URL", "sqlite:///./WhereTheyAt.db"))

IS_SQLITE = DATABASE_URL.startswith("sqlite")

if IS_SQLITE:
    # SQLite needs check_same_thread=False to be shared across FastAPI's threadpool.
    engine_kwargs = {"connect_args": {"check_same_thread": False}}
else:
    # Sizing for the polling load: each active user is ~1.3 location writes +
    # ~0.5 group reads per second, and the sync endpoints run on Starlette's
    # ~40-thread pool, so the 5+10 default would queue. pre_ping/recycle because
    # managed Postgres (Railway) drops idle connections out from under the pool.
    engine_kwargs = {
        "pool_size": 10,
        "max_overflow": 10,
        "pool_pre_ping": True,
        "pool_recycle": 1800,
    }

engine = create_engine(DATABASE_URL, **engine_kwargs)

if IS_SQLITE:
    # SQLite ignores ON DELETE CASCADE unless foreign keys are switched on per-connection.
    @event.listens_for(engine, "connect")
    def _enable_sqlite_fks(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    """Session-per-request dependency; always closes the session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
