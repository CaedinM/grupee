"""SQLAlchemy models.

Schema management is Alembic (`backend/alembic/`) — these classes are the source
of truth autogenerate diffs against, but nothing here reaches the database until
a revision is generated and `alembic upgrade head` runs.
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
    # Explicitly named (rather than left to the ix_ convention) because the
    # index predates Alembic — databases built by the old create_all path carry
    # this name, and the baseline revision keeps it.
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

    # Live position lives in Redis, not here — see app/redis_client.py. There is
    # deliberately no locations table or User.location relationship.
    memberships: Mapped[list["Membership"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


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
    sets: Mapped[list["Set"]] = relationship(
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
    # Optional geofence for the landmark itself, stored the same way as
    # events.boundary — a polygon of [lat, lng] vertices, or NULL for none.
    boundary: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow, nullable=False)

    event: Mapped[Event] = relationship(back_populates="landmarks")
    sets: Mapped[list["Set"]] = relationship(
        back_populates="landmark", passive_deletes=True
    )


class Set(Base):
    """One artist's performance slot: who plays which stage, and when.

    Tied to an event, and (usually) to a landmark of kind "stage". Deleting the
    event cascades its sets away; deleting a stage only unlinks it (landmark_id
    goes NULL) so the schedule survives a landmark being moved or re-added.
    """

    __tablename__ = "sets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    event_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True
    )
    landmark_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("landmarks.id", ondelete="SET NULL"), nullable=True, index=True
    )
    artist: Mapped[str] = mapped_column(String, nullable=False)
    start_time: Mapped[datetime] = mapped_column(TZDateTime, nullable=False)
    end_time: Mapped[datetime] = mapped_column(TZDateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow, nullable=False)

    event: Mapped[Event] = relationship(back_populates="sets")
    landmark: Mapped["Landmark | None"] = relationship(back_populates="sets")


class SetAttendance(Base):
    """A set a user is credited with having actually seen.

    The one durable trace of position data. Positions themselves stay ephemeral
    (Redis, no history), so this can't be computed after the fact — `attendance.py`
    derives it at ping time from the live socket and persists only the conclusion:
    "this user was inside this stage's geofence for long enough while this set was
    playing". No coordinates are stored here.

    `event_id` is denormalized off the set so the per-event read is one join
    shallower. `dwell_seconds`/`first_seen_at` are kept for debugging the
    threshold — they're what tell a false credit from a real one.
    """

    __tablename__ = "set_attendances"
    # The real idempotency guard: two sockets for the same user (say, mid
    # reconnect on different workers) can race the Redis dwell state, so the
    # insert relies on this constraint rather than on having read first.
    __table_args__ = (
        UniqueConstraint("user_id", "set_id", name="uq_set_attendance_user_set"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    set_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("sets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    event_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # When the dwell that earned this credit started, and how much of it had
    # accumulated when the threshold was crossed.
    first_seen_at: Mapped[datetime] = mapped_column(TZDateTime, nullable=False)
    dwell_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    credited_at: Mapped[datetime] = mapped_column(TZDateTime, default=utcnow, nullable=False)


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
