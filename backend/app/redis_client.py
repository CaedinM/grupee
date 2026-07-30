"""Live location store — Redis, not the main database.

Positions are the hot, high-churn, disposable half of the data model: every
client writes one every ~1.5s and reads its group's every ~2s, and only the
latest matters. Keeping them out of Postgres keeps that churn off the durable
database entirely. This module is the only place that talks to Redis, the same
way `storage.py` is the only place that talks to object storage.

One key per user, `loc:<user_id>`, holding a JSON blob of the position, written
with a TTL so a client that stops reporting expires to "no location" instead of
freezing on the map forever. There is no history and no per-group copy — exactly
the invariants the old `locations` table held, now enforced by a flat keyspace.

Three namespaces, all flat: `loc:<user_id>` (above), `groupchan:<group_id>` (the
pub/sub channel for the WebSocket fan-out), and `dwell:<user_id>` (set-attendance
accumulator, see `attendance.py`). The last one *is* derived from positions, but
it's still one bounded key per user with no trail — and it's precisely what lets
attendance be computed without keeping any position history.
"""
import json
import os
from datetime import datetime, timezone

import redis
import redis.asyncio as aredis
from dotenv import load_dotenv

load_dotenv()

# Railway exposes REDIS_URL / REDIS_PRIVATE_URL on the Redis service; reference
# the private one from the API service so traffic stays on the internal network.
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# A position not refreshed within this window expires. With the WebSocket
# transport a stationary client only sends a heartbeat every 180s, so the TTL
# MUST comfortably exceed that or a standing-still user would blink to
# location=null between beats. 210s leaves a full missed-heartbeat of slack.
# (Invariant: keep LOCATION_TTL_SECONDS > the client heartbeat interval.)
LOCATION_TTL_SECONDS = int(os.getenv("LOCATION_TTL_SECONDS", "210"))

_KEY_PREFIX = "loc:"
# Per-group pub/sub channel for the WebSocket fan-out backplane. A position that
# lands on one uvicorn worker is PUBLISHed here so every other worker can push it
# to its locally-connected sockets in that group.
_CHANNEL_PREFIX = "groupchan:"
# Set-attendance dwell state, one key per user (see app/attendance.py). Lives
# here rather than in the database for the same reason positions do: it's
# high-churn, derived, and only the latest value matters. It's also the reason
# no position history has to be kept — the accumulator carries forward what the
# expired positions would otherwise have to prove.
_DWELL_PREFIX = "dwell:"

# Dwell state is garbage-collected, not expired for correctness: it already
# resets on a set changeover, so this only needs to outlive a single set and
# clear itself out overnight.
DWELL_STATE_TTL_SECONDS = int(os.getenv("DWELL_STATE_TTL_SECONDS", "21600"))

# decode_responses so reads come back as str, not bytes. health_check_interval
# reconnects transparently after Railway drops an idle connection (the Redis
# analogue of the DB pool's pre_ping); the client keeps its own pool.
client = redis.from_url(
    REDIS_URL,
    decode_responses=True,
    socket_connect_timeout=5,
    socket_keepalive=True,
    health_check_interval=30,
    retry_on_timeout=True,
)

# Async client for the WebSocket path (the HTTP endpoints keep using the sync
# `client` above). Same connection options; created lazily so importing this
# module doesn't open a socket, and closed on app shutdown via aclose().
_async_client: aredis.Redis | None = None


def async_client() -> aredis.Redis:
    global _async_client
    if _async_client is None:
        _async_client = aredis.from_url(
            REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_keepalive=True,
            health_check_interval=30,
            retry_on_timeout=True,
        )
    return _async_client


async def aclose() -> None:
    """Close the async client's pool on shutdown. No-op if never opened."""
    global _async_client
    if _async_client is not None:
        await _async_client.aclose()
        _async_client = None


def _key(user_id: str) -> str:
    return f"{_KEY_PREFIX}{user_id}"


def channel(group_id: str) -> str:
    return f"{_CHANNEL_PREFIX}{group_id}"


def _dwell_key(user_id: str) -> str:
    return f"{_DWELL_PREFIX}{user_id}"


def _build_payload(lat: float, lng: float, heading: float | None,
                   battery: int | None, accuracy: float | None) -> dict:
    return {
        "lat": lat,
        "lng": lng,
        "heading": heading,
        "battery": battery,
        "accuracy": accuracy,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def write_location(user_id: str, lat: float, lng: float, heading: float | None,
                   battery: int | None, accuracy: float | None) -> dict:
    """Upsert a user's latest position with the staleness TTL. Returns the
    stored payload (including the server-stamped updated_at) so the caller can
    echo it back in the same shape the DB row used to return."""
    payload = _build_payload(lat, lng, heading, battery, accuracy)
    client.set(_key(user_id), json.dumps(payload), ex=LOCATION_TTL_SECONDS)
    return payload


def read_locations(user_ids: list[str]) -> dict[str, dict]:
    """Latest position for each user id, in one round-trip. Users with no live
    position (never reported, or expired) are simply absent from the result —
    the caller renders them as location=null. Empty input skips Redis entirely."""
    if not user_ids:
        return {}
    raw_values = client.mget(_key(uid) for uid in user_ids)
    out: dict[str, dict] = {}
    for user_id, raw in zip(user_ids, raw_values):
        if raw is not None:
            out[user_id] = json.loads(raw)
    return out


def delete_location(user_id: str) -> None:
    """Drop a user's live position immediately (e.g. on account deletion).
    A no-op if there is nothing stored."""
    client.delete(_key(user_id))


# ---------- Async path (WebSocket transport) ----------

async def awrite_location(user_id: str, lat: float, lng: float, heading: float | None,
                          battery: int | None, accuracy: float | None) -> dict:
    """Async twin of write_location — same key, TTL, and returned payload shape."""
    payload = _build_payload(lat, lng, heading, battery, accuracy)
    await async_client().set(_key(user_id), json.dumps(payload), ex=LOCATION_TTL_SECONDS)
    return payload


async def aread_locations(user_ids: list[str]) -> dict[str, dict]:
    """Async twin of read_locations, used to build a socket's connect snapshot."""
    if not user_ids:
        return {}
    raw_values = await async_client().mget([_key(uid) for uid in user_ids])
    out: dict[str, dict] = {}
    for user_id, raw in zip(user_ids, raw_values):
        if raw is not None:
            out[user_id] = json.loads(raw)
    return out


async def publish_group(group_id: str, message: dict) -> None:
    """Fan a message out to the group's channel; every worker subscribed to it
    (i.e. every worker holding a socket for this group) receives it."""
    await async_client().publish(channel(group_id), json.dumps(message))


async def aread_dwell(user_id: str) -> dict | None:
    """This user's set-attendance dwell state, or None if they aren't currently
    accumulating any. A corrupt value reads as None so the accumulator just
    starts over rather than failing the ping."""
    raw = await async_client().get(_dwell_key(user_id))
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


async def awrite_dwell(user_id: str, state: dict) -> None:
    """Upsert the dwell state, refreshing its TTL."""
    await async_client().set(
        _dwell_key(user_id), json.dumps(state), ex=DWELL_STATE_TTL_SECONDS
    )
