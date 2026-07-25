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
"""
import json
import os
from datetime import datetime, timezone

import redis
from dotenv import load_dotenv

load_dotenv()

# Railway exposes REDIS_URL / REDIS_PRIVATE_URL on the Redis service; reference
# the private one from the API service so traffic stays on the internal network.
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# A position not refreshed within this window expires. Reports arrive ~every
# 1.5s, so 90s tolerates ~60 consecutive misses (network gaps, backgrounding)
# before a member drops to location=null. Tunable without a code change.
LOCATION_TTL_SECONDS = int(os.getenv("LOCATION_TTL_SECONDS", "90"))

_KEY_PREFIX = "loc:"

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


def _key(user_id: str) -> str:
    return f"{_KEY_PREFIX}{user_id}"


def write_location(user_id: str, lat: float, lng: float, heading: float | None,
                   battery: int | None, accuracy: float | None) -> dict:
    """Upsert a user's latest position with the staleness TTL. Returns the
    stored payload (including the server-stamped updated_at) so the caller can
    echo it back in the same shape the DB row used to return."""
    updated_at = datetime.now(timezone.utc)
    payload = {
        "lat": lat,
        "lng": lng,
        "heading": heading,
        "battery": battery,
        "accuracy": accuracy,
        "updated_at": updated_at.isoformat(),
    }
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
