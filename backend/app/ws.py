"""WebSocket location streaming.

The realtime half of the hot path. A client opens one socket per active group,
pushes its own position up (only on ~10m of movement, plus a 180s heartbeat),
and receives peers' positions pushed down in real time — replacing the old
1.5s location PUT + 2s locations GET polling pair.

Fan-out across uvicorn workers goes through Redis pub/sub (`redis_client`): a
position that lands on one worker is PUBLISHed to the group's channel, and every
worker holding a socket for that group is SUBSCRIBEd and forwards it to its local
sockets. Positions still live only in Redis, never Postgres.

The backend is deliberately synchronous SQLAlchemy, so every DB touch here runs
through `run_in_threadpool` — a blocking query on the event loop would stall
every socket on the worker.
"""
import asyncio
import contextlib
import json
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select

from . import models, redis_client, schemas
from .auth import verify_clerk_token
from .database import SessionLocal
from .logging_config import logger
from .routers.groups import event_has_ended

router = APIRouter()

# App-defined WebSocket close codes (the 4000-4999 range is reserved for apps).
WS_UNAUTHORIZED = 4401  # missing/invalid token
WS_NO_PROFILE = 4404  # token is valid but no local users row yet
WS_NO_GROUP = 4404  # unknown group id
WS_NOT_MEMBER = 4403  # not a member of this group
WS_EVENT_ENDED = 4409  # the group's festival is over (server-side liveness gate)


class _Reject(Exception):
    """Raised inside the threadpool authorize step to close with a specific code."""

    def __init__(self, code: int):
        self.code = code


def _authorize(group_id: str, clerk_id: str) -> tuple[str, list[tuple]]:
    """Resolve the caller, assert group membership and event liveness, and return
    `(user_id, roster)` where roster is a list of
    `(user_id, display_name, avatar_url, role)` tuples — the same roster the
    `GET /groups/{id}/locations` read builds, materialized so it can be used
    after the session closes. Raises `_Reject` with a close code on any failure.

    Runs in a threadpool (sync SQLAlchemy); opens its own short-lived session.
    """
    db = SessionLocal()
    try:
        user = db.execute(
            select(models.User).where(models.User.clerk_id == clerk_id)
        ).scalar_one_or_none()
        if user is None:
            raise _Reject(WS_NO_PROFILE)
        group = db.get(models.Group, group_id)
        if group is None:
            raise _Reject(WS_NO_GROUP)
        membership = db.execute(
            select(models.Membership).where(
                models.Membership.group_id == group_id,
                models.Membership.user_id == user.id,
            )
        ).scalar_one_or_none()
        if membership is None:
            raise _Reject(WS_NOT_MEMBER)
        if event_has_ended(db, group):
            raise _Reject(WS_EVENT_ENDED)
        rows = db.execute(
            select(
                models.Membership.user_id,
                models.User.display_name,
                models.User.avatar_url,
                models.Membership.role,
            )
            .join(models.User, models.User.id == models.Membership.user_id)
            .where(models.Membership.group_id == group_id)
            .order_by(models.Membership.joined_at)
        ).all()
        roster = [(r.user_id, r.display_name, r.avatar_url, r.role) for r in rows]
        return user.id, roster
    finally:
        db.close()


def _member_dict(row: tuple, position: dict | None) -> dict:
    """A member card in the same shape MemberLocationOut serializes to. `position`
    is the stored Redis payload (already the LocationSnapshot fields) or None."""
    user_id, display_name, avatar_url, role = row
    return {
        "user_id": user_id,
        "display_name": display_name,
        "avatar_url": avatar_url,
        "role": role,
        "location": position,
    }


class ConnectionManager:
    """Tracks this worker's sockets per group and runs one Redis subscriber task
    per group with local sockets, forwarding channel messages to them.

    Subscription is established *and awaited* (`ensure_subscribed`) before a
    socket is registered or its snapshot read — a fire-and-forget subscribe
    leaves a window where this worker isn't yet listening on the channel, and
    Redis pub/sub has no backlog, so any position published in that window is
    lost for a member whose worker just came up (the cross-worker bug this
    ordering fixes).
    """

    def __init__(self) -> None:
        self._groups: dict[str, dict[WebSocket, str]] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def ensure_subscribed(self, group_id: str) -> None:
        """Guarantee this worker is subscribed to the group's channel before the
        caller proceeds. Idempotent and safe against concurrent connects."""
        if group_id in self._tasks:
            return
        lock = self._locks.setdefault(group_id, asyncio.Lock())
        async with lock:
            if group_id in self._tasks:
                return
            pubsub = redis_client.async_client().pubsub()
            await pubsub.subscribe(redis_client.channel(group_id))
            self._tasks[group_id] = asyncio.create_task(self._listen(group_id, pubsub))
            logger.info("WS subscribed to group %s", group_id)

    def register(self, group_id: str, websocket: WebSocket, user_id: str) -> None:
        self._groups.setdefault(group_id, {})[websocket] = user_id

    def unregister(self, group_id: str, websocket: WebSocket) -> None:
        conns = self._groups.get(group_id)
        if not conns or websocket not in conns:
            return
        del conns[websocket]
        if not conns:
            self._groups.pop(group_id, None)
            self._locks.pop(group_id, None)
            task = self._tasks.pop(group_id, None)
            if task is not None:
                # Don't await: this can be called from within the subscriber task
                # itself (a failed send prunes a dead socket), and awaiting would
                # deadlock on self-cancellation. The task's finally closes pubsub.
                task.cancel()

    async def _listen(self, group_id: str, pubsub) -> None:
        try:
            async for raw in pubsub.listen():
                if raw.get("type") != "message":
                    continue  # subscribe/unsubscribe confirmations
                try:
                    message = json.loads(raw["data"])
                except (ValueError, KeyError):
                    continue
                await self._forward(group_id, message)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("WS subscriber for group %s crashed", group_id)
        finally:
            with contextlib.suppress(Exception):
                await pubsub.unsubscribe(redis_client.channel(group_id))
                await pubsub.aclose()

    async def _forward(self, group_id: str, message: dict) -> None:
        conns = self._groups.get(group_id)
        if not conns:
            return
        origin = message.get("user_id")
        text = json.dumps(message)
        dead: list[WebSocket] = []
        for websocket, user_id in list(conns.items()):
            if user_id == origin:
                continue  # never echo a member's own update back to them
            try:
                await websocket.send_text(text)
            except Exception:
                dead.append(websocket)
        for websocket in dead:
            self.unregister(group_id, websocket)

    async def shutdown(self) -> None:
        for task in self._tasks.values():
            task.cancel()
        self._tasks.clear()
        self._groups.clear()
        self._locks.clear()


manager = ConnectionManager()


async def _handle_message(group_id: str, user_row: tuple, conn: str, raw: str) -> None:
    """A client frame. Only `loc` is meaningful; a heartbeat is the same message
    (re-stamps updated_at and refreshes the TTL). Writes to Redis, then publishes
    the new position to the group's channel.

    The update carries the mover's full member card (name/avatar/role), not just
    coordinates, so a peer that missed this member's `join` can still render them
    with identity instead of a blank placeholder. `conn` tags the message with
    this socket's connection id so a stale `leave` can be told from a live one.
    """
    try:
        data = json.loads(raw)
    except ValueError:
        return
    if not isinstance(data, dict) or data.get("type") != "loc":
        return
    try:
        loc = schemas.LocationIn(
            lat=data.get("lat"),
            lng=data.get("lng"),
            heading=data.get("heading"),
            battery=data.get("battery"),
            accuracy=data.get("accuracy"),
        )
    except ValidationError:
        return  # out-of-range/malformed fix — drop it, same as HTTP 422 would
    user_id = user_row[0]
    payload = await redis_client.awrite_location(
        user_id, loc.lat, loc.lng, loc.heading, loc.battery, loc.accuracy
    )
    await redis_client.publish_group(
        group_id,
        {
            "type": "update",
            "user_id": user_id,
            "conn": conn,
            "member": _member_dict(user_row, payload),
        },
    )


@router.websocket("/ws/groups/{group_id}")
async def group_socket(websocket: WebSocket, group_id: str):
    await websocket.accept()

    # RN can't set an Authorization header on a socket upgrade, so the Clerk JWT
    # rides in the query string. Verified once here; the connection stays
    # authorized for its lifetime rather than re-verifying the rotating token.
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=WS_UNAUTHORIZED)
        return
    try:
        clerk_id = verify_clerk_token(token)
    except HTTPException:
        await websocket.close(code=WS_UNAUTHORIZED)
        return

    try:
        user_id, roster = await run_in_threadpool(_authorize, group_id, clerk_id)
    except _Reject as reject:
        await websocket.close(code=reject.code)
        return

    # Subscribe this worker to the group channel BEFORE reading the snapshot, so
    # no position published between the snapshot and going live is dropped.
    await manager.ensure_subscribed(group_id)

    # Connect snapshot: every member's current position in one shot.
    positions = await redis_client.aread_locations([row[0] for row in roster])
    members = [_member_dict(row, positions.get(row[0])) for row in roster]
    await websocket.send_text(json.dumps({"type": "snapshot", "members": members}))

    # Register only after the snapshot is on the wire so this socket's first
    # frame is the snapshot, not a stray peer update.
    manager.register(group_id, websocket, user_id)

    # A unique id for THIS connection, tagged onto join/update/leave. Peers track
    # the latest conn per user and ignore a leave whose conn is stale, so a
    # lingering old socket (e.g. after a wifi→cellular switch) can't evict a
    # member who has already reconnected on a new socket.
    conn_id = uuid.uuid4().hex

    # Tell existing members a peer joined (their snapshot predates this socket).
    # The join carries the member card AND their last-known position from Redis,
    # so peers see the dot immediately instead of waiting for the next update
    # (up to a heartbeat away if the joiner is standing still).
    self_row = next((row for row in roster if row[0] == user_id), None)
    if self_row is not None:
        await redis_client.publish_group(
            group_id,
            {
                "type": "join",
                "user_id": user_id,
                "conn": conn_id,
                "member": _member_dict(self_row, positions.get(user_id)),
            },
        )

    try:
        while True:
            raw = await websocket.receive_text()
            if self_row is not None:
                await _handle_message(group_id, self_row, conn_id, raw)
    except WebSocketDisconnect:
        pass
    finally:
        manager.unregister(group_id, websocket)
        await redis_client.publish_group(
            group_id, {"type": "leave", "user_id": user_id, "conn": conn_id}
        )
