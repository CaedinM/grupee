"""Set attendance — which acts a user actually saw.

Positions are deliberately ephemeral (one Redis key per user, no history, no
trail), so attendance can't be computed after the fact by replaying a track. It
is instead **derived at ping time and only the conclusion persisted**: every
`loc` frame on the socket asks "is this user standing in a stage's geofence while
something is playing there?", accumulates the time if so, and writes one
`set_attendances` row once the threshold is crossed. No coordinates are stored.

The dwell rule is **cumulative**, held in `dwell:<user_id>`:

    {"set_id", "dwell", "last_seen", "first_seen", "inside", "credited"}

Time inside the fence while the set is live adds up across visits, so a drink
run doesn't wipe nine minutes of progress — but time spent *outside* is never
credited (a re-entry starts a fresh segment), and a set changeover resets the
counter, so five minutes of one act plus five of the next credits neither. That
combination is what separates someone who watched a set from someone who cut
across the field on their way to another stage.

Dwell is *sampled*, not measured: a stationary client only sends a heartbeat
every 180s, and the first ping merely opens the segment, so credit lands on the
first beat at or past the threshold — 6 minutes of real presence for the default
240s. A moving client pings far more often and lands much closer to 4:00.
"""
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from . import models, redis_client
from .database import SessionLocal
from .geo import point_in_polygon
from .logging_config import logger

# How much dwell inside a stage's geofence, while a set is live, counts as having
# seen it. Env-overridable mostly so the flow is testable in seconds.
#
# 240 (4 min) is deliberately shorter than a typical set: because dwell is
# sampled at the client's 180s heartbeat and the first ping only opens the
# segment, the *effective* bar for a stationary user is the ping at or past the
# threshold — 6 minutes of real presence. A threshold near a set's own length
# leaves no margin for a missed beat, and short sets could never be credited at
# all (a 30-minute headline slot and an 8-minute opener have to both work).
SEEN_DWELL_SECONDS = int(os.getenv("SEEN_DWELL_SECONDS", "240"))

# The longest silence between two pings we're still willing to credit as
# continuous presence. INVARIANT: keep this comfortably greater than the client's
# 180s heartbeat (`frontend/src/useLocationReporting.ts`) — at or below it, a
# stationary user's dwell would never accumulate at all. A longer gap (app
# killed, phone in a dead spot) credits nothing but keeps the running total.
#
# 420 is 2.3× the heartbeat, so a *single* dropped beat — routine on iOS when the
# app backgrounds — still reads as continuous presence. At the old 300 it didn't:
# one missed beat made a 360s gap, which was over the limit and forfeited the
# whole segment, so a user standing still through a set could end up credited
# with half the time they were actually there.
MAX_PING_GAP_SECONDS = int(os.getenv("MAX_PING_GAP_SECONDS", "420"))

# Stages and schedules are cold, admin-authored data; re-reading them per ping
# would put a database query back on the hot path. Cached per worker, so an admin
# edit takes effect within this window.
EVENT_GEO_TTL_SECONDS = 60


@dataclass(frozen=True)
class _Stage:
    landmark_id: str
    boundary: list


@dataclass(frozen=True)
class _Slot:
    set_id: str
    landmark_id: str
    start_time: datetime
    end_time: datetime


@dataclass(frozen=True)
class _EventGeo:
    """One event's stage geofences and schedule, flattened into plain tuples so
    nothing stays bound to the session that loaded it (the same discipline
    `ws._authorize` uses for the roster)."""

    stages: tuple[_Stage, ...]
    slots: tuple[_Slot, ...]

    def stage_at(self, lat: float, lng: float) -> str | None:
        """The stage whose geofence contains the point. Landmark geofences never
        overlap by product rule, so the first hit is the answer."""
        for stage in self.stages:
            if point_in_polygon(lat, lng, stage.boundary):
                return stage.landmark_id
        return None

    def live_set(self, landmark_id: str, now: datetime) -> str | None:
        """The set playing that stage right now, on the same half-open
        `[start, end)` window the client's `currentSetForLandmark` uses."""
        for slot in self.slots:
            if (
                slot.landmark_id == landmark_id
                and slot.start_time <= now < slot.end_time
            ):
                return slot.set_id
        return None


# event_id -> (monotonic load time, geo)
_geo_cache: dict[str, tuple[float, _EventGeo]] = {}


def _load_event_geo(event_id: str) -> _EventGeo:
    """Two queries, own short-lived session. Runs in a threadpool (sync
    SQLAlchemy — a blocking query on the event loop would stall every socket on
    the worker)."""
    db = SessionLocal()
    try:
        stage_rows = db.execute(
            select(models.Landmark.id, models.Landmark.boundary).where(
                models.Landmark.event_id == event_id,
                models.Landmark.kind == "stage",
                models.Landmark.boundary.is_not(None),
            )
        ).all()
        slot_rows = db.execute(
            select(
                models.Set.id,
                models.Set.landmark_id,
                models.Set.start_time,
                models.Set.end_time,
            ).where(
                models.Set.event_id == event_id,
                models.Set.landmark_id.is_not(None),
            )
        ).all()
    finally:
        db.close()
    return _EventGeo(
        stages=tuple(_Stage(row.id, row.boundary) for row in stage_rows),
        slots=tuple(
            _Slot(row.id, row.landmark_id, row.start_time, row.end_time)
            for row in slot_rows
        ),
    )


async def _event_geo(event_id: str) -> _EventGeo:
    cached = _geo_cache.get(event_id)
    loaded_at = time.monotonic()
    if cached is not None and loaded_at - cached[0] < EVENT_GEO_TTL_SECONDS:
        return cached[1]
    geo = await run_in_threadpool(_load_event_geo, event_id)
    _geo_cache[event_id] = (loaded_at, geo)
    return geo


def _record_attendance(
    user_id: str,
    event_id: str,
    set_id: str,
    first_seen_at: datetime,
    dwell_seconds: int,
) -> None:
    """Persist one credit. The unique constraint — not a pre-read — is what makes
    this idempotent, so a duplicate is a normal outcome, not an error."""
    db = SessionLocal()
    try:
        db.add(
            models.SetAttendance(
                user_id=user_id,
                set_id=set_id,
                event_id=event_id,
                first_seen_at=first_seen_at,
                dwell_seconds=dwell_seconds,
            )
        )
        db.commit()
        logger.info(
            "Set attendance credited: user %s saw set %s (%ss dwell)",
            user_id,
            set_id,
            dwell_seconds,
        )
    except IntegrityError:
        db.rollback()  # already credited — another socket got there first
    finally:
        db.close()


async def on_position(event_id: str | None, user_id: str, lat: float, lng: float) -> None:
    """Fold one position into the user's dwell state, crediting a set if the
    threshold is crossed. The only entry point; called per `loc` frame.

    Costs one Redis GET in the common case (wandering the field, no state), plus
    one SET when the state actually changes. The containment test is pure Python
    over a handful of small polygons.
    """
    if event_id is None:
        return  # a group with no event has no stages and no schedule
    geo = await _event_geo(event_id)
    if not geo.stages or not geo.slots:
        return  # nothing here to be seen

    now_dt = datetime.now(timezone.utc)
    now = now_dt.timestamp()
    stage_id = geo.stage_at(lat, lng)
    set_id = geo.live_set(stage_id, now_dt) if stage_id is not None else None

    state = await redis_client.aread_dwell(user_id)

    # Outside every stage, or standing at one with nothing playing. Mark the
    # segment closed so the time until they come back isn't credited — and write
    # nothing at all if there was no state to close.
    if set_id is None:
        if state is not None and state.get("inside"):
            state["inside"] = False
            await redis_client.awrite_dwell(user_id, state)
        return

    # First sighting, or a different set than we were tracking (a changeover
    # deliberately forfeits partial dwell on both acts).
    if state is None or state.get("set_id") != set_id:
        await redis_client.awrite_dwell(
            user_id,
            {
                "set_id": set_id,
                "dwell": 0.0,
                "last_seen": now,
                "first_seen": now,
                "inside": True,
                "credited": False,
            },
        )
        return

    # Back inside after leaving: resume from now, crediting none of the gap.
    if not state.get("inside"):
        state["inside"] = True
        state["last_seen"] = now
        await redis_client.awrite_dwell(user_id, state)
        return

    dwell = float(state.get("dwell") or 0.0)
    gap = now - float(state.get("last_seen") or now)
    if 0 < gap <= MAX_PING_GAP_SECONDS:
        dwell += gap
    state["dwell"] = dwell
    state["last_seen"] = now

    if not state.get("credited") and dwell >= SEEN_DWELL_SECONDS:
        first_seen_at = datetime.fromtimestamp(
            float(state.get("first_seen") or now), timezone.utc
        )
        await run_in_threadpool(
            _record_attendance, user_id, event_id, set_id, first_seen_at, int(dwell)
        )
        state["credited"] = True

    await redis_client.awrite_dwell(user_id, state)
