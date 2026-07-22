"""SQLAlchemy models.

Schema management: tables are created via Base.metadata.create_all() on startup.
# TODO: switch to Alembic migrations when the schema starts evolving in production.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    TypeDecorator,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def new_uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TZDateTime(TypeDecorator):
    """Store UTC datetimes and always read them back timezone-aware.

    Postgres keeps tzinfo natively; SQLite drops it, so we re-attach UTC on load.
    """

    impl = DateTime(timezone=True)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value

    def process_result_value(self, value, dialect):
        if value is not None and value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value


class User(Base):
    __tablename__ = "users"
    # Named to match the CREATE UNIQUE INDEX IF NOT EXISTS in main.py's
    # ensure_columns(), so fresh and migrated databases end up identical.
    __table_args__ = (Index("uq_users_clerk_id", "clerk_id", unique=True),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    # Clerk's user id (`sub` claim). Nullable only for rows created before auth
    # landed; every new row gets one and all writes require it to match.
    clerk_id: Mapped[str | None] = mapped_column(String, nullable=True)
    display_name: Mapped[str] = mapped_column(String, nullable=False)
    # Path to the uploaded avatar, relative to the API root (e.g. "/static/avatars/<id>-ab12.jpg").
    # Relative so the same row works across dev LAN IPs and production hosts.
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    # Designated out-of-band (direct DB update) — there is no endpoint to grant
    # admin, on purpose: any client can claim any user_id, so a self-serve
    # toggle would make everyone an admin.
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow, nullable=False)

    location: Mapped["Location | None"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class Location(Base):
    """Latest position only — one row per user, upserted on every report."""

    __tablename__ = "locations"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    heading: Mapped[float | None] = mapped_column(Float, nullable=True)
    battery: Mapped[int | None] = mapped_column(Integer, nullable=True)
    accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow, nullable=False)

    user: Mapped[User] = relationship(back_populates="location")


class Event(Base):
    __tablename__ = "events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String, nullable=False)
    boundary: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Festival schedule. Nullable because events predating the admin tool
    # (and the mini-migration in main.py) have no times.
    starts_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(TZDateTime, nullable=True)
    creator_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow, nullable=False)

    landmarks: Mapped[list["Landmark"]] = relationship(
        back_populates="event", cascade="all, delete-orphan"
    )


class Landmark(Base):
    __tablename__ = "landmarks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    event_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow, nullable=False)

    event: Mapped[Event] = relationship(back_populates="landmarks")


class Group(Base):
    __tablename__ = "groups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    code: Mapped[str] = mapped_column(String(4), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    event_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("events.id"), nullable=True
    )
    creator_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow, nullable=False)

    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="group", cascade="all, delete-orphan"
    )


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("user_id", "group_id", name="uq_membership_user_group"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    group_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("groups.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String, nullable=False, default="member")
    joined_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow, nullable=False)

    user: Mapped[User] = relationship(back_populates="memberships")
    group: Mapped[Group] = relationship(back_populates="memberships")
