"""Engine, session factory, declarative base, and the per-request session dependency."""
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()


def normalize_database_url(url: str) -> str:
    """Railway (and Heroku-style providers) hand out `postgres://`, a scheme
    SQLAlchemy 2.0 dropped. Rewrite it to the driver we actually install."""
    if url.startswith("postgres://"):
        return "postgresql+psycopg2://" + url[len("postgres://") :]
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
