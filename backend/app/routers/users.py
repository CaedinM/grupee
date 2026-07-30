import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, redis_client, schemas
from ..auth import get_clerk_id, get_current_user, require_self
from ..database import get_db
from ..storage import storage

router = APIRouter(tags=["users"])

AVATAR_MAX_BYTES = 5 * 1024 * 1024
AVATAR_EXTENSIONS = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def clear_avatar_files(user_id: str) -> None:
    """Delete every stored avatar for this user. Filenames carry a random
    suffix so a new upload lands on a new URL — otherwise clients would keep
    showing the cached old image."""
    storage.delete_prefix(f"avatars/{user_id}-")


def get_user_or_404(db: Session, user_id: str) -> models.User:
    user = db.get(models.User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("/users", response_model=schemas.UserOut, status_code=status.HTTP_201_CREATED)
def register_user(
    body: schemas.UserCreate,
    response: Response,
    clerk_id: str = Depends(get_clerk_id),
    db: Session = Depends(get_db),
):
    """Provision the local profile for the signed-in Clerk account.

    Idempotent per account (mirrors join-by-code): 201 creates the row,
    200 returns the existing one untouched — so a re-run after a lost
    response can't duplicate a user or clobber their chosen name.
    """
    existing = db.execute(
        select(models.User).where(models.User.clerk_id == clerk_id)
    ).scalar_one_or_none()
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return existing
    user = models.User(display_name=body.display_name, clerk_id=clerk_id)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# Registered before /users/{user_id} so "me" isn't captured as a user_id.
@router.get("/users/me", response_model=schemas.UserOut)
def get_me(user: models.User = Depends(get_current_user)):
    return user


# Self-only by construction: there is no user id in the path, so there's nothing
# to spoof and no require_self to forget.
@router.get("/users/me/attendance", response_model=list[schemas.SetAttendanceOut])
def list_my_attendance(
    event_id: str | None = None,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The acts the caller was credited with seeing, in schedule order.

    Rows are written by the dwell accumulator on the location socket
    (`app/attendance.py`) — one per set, once earned. `event_id` narrows to a
    single festival; omitted, it's every act they've ever seen.
    """
    stmt = (
        select(
            models.SetAttendance.set_id,
            models.SetAttendance.event_id,
            models.SetAttendance.first_seen_at,
            models.SetAttendance.dwell_seconds,
            models.Set.artist,
            models.Set.start_time,
            models.Set.end_time,
            models.Set.landmark_id,
            models.Landmark.name.label("stage_name"),
        )
        .join(models.Set, models.Set.id == models.SetAttendance.set_id)
        # Outer: a deleted stage unlinks its sets rather than removing them.
        .outerjoin(models.Landmark, models.Landmark.id == models.Set.landmark_id)
        .where(models.SetAttendance.user_id == user.id)
        .order_by(models.Set.start_time)
    )
    if event_id is not None:
        stmt = stmt.where(models.SetAttendance.event_id == event_id)
    return [
        schemas.SetAttendanceOut(**row._mapping) for row in db.execute(stmt).all()
    ]


@router.get("/users/{user_id}", response_model=schemas.UserOut)
def get_user(user_id: str, _: str = Depends(get_clerk_id), db: Session = Depends(get_db)):
    return get_user_or_404(db, user_id)


@router.patch("/users/{user_id}", response_model=schemas.UserOut)
def update_user(
    user_id: str,
    body: schemas.UserUpdate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_self(user, user_id)
    user.display_name = body.display_name
    db.commit()
    db.refresh(user)
    return user


@router.put("/users/{user_id}/avatar", response_model=schemas.UserOut)
def upload_avatar(
    user_id: str,
    file: UploadFile = File(...),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_self(user, user_id)
    extension = AVATAR_EXTENSIONS.get(file.content_type or "")
    if extension is None:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Avatar must be a JPEG, PNG, or WebP image",
        )
    # Read one byte past the cap so an oversized file is rejected without
    # buffering the whole thing.
    data = file.file.read(AVATAR_MAX_BYTES + 1)
    if len(data) > AVATAR_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="Avatar must be smaller than 5 MB",
        )

    clear_avatar_files(user_id)
    key = f"avatars/{user_id}-{uuid.uuid4().hex[:8]}{extension}"
    user.avatar_url = storage.save(key, data, file.content_type or "application/octet-stream")
    db.commit()
    db.refresh(user)
    return user


@router.delete("/users/{user_id}/avatar", status_code=status.HTTP_204_NO_CONTENT)
def delete_avatar(
    user_id: str,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_self(user, user_id)
    clear_avatar_files(user_id)
    user.avatar_url = None
    db.commit()


# 🔥 hot path: called every ~1.5s per client. The position never touches the
# main database — it's written to Redis with a staleness TTL (see redis_client).
@router.put("/users/{user_id}/location", response_model=schemas.LocationOut)
def upsert_location(
    user_id: str,
    body: schemas.LocationIn,
    user: models.User = Depends(get_current_user),
):
    require_self(user, user_id)
    payload = redis_client.write_location(
        user_id,
        lat=body.lat,
        lng=body.lng,
        heading=body.heading,
        battery=body.battery,
        accuracy=body.accuracy,
    )
    return schemas.LocationOut(user_id=user_id, **payload)


@router.get("/users/{user_id}/groups", response_model=list[schemas.UserGroupOut])
def list_user_groups(
    user_id: str,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_self(user, user_id)
    rows = db.execute(
        select(models.Group, models.Membership.role)
        .join(models.Membership, models.Membership.group_id == models.Group.id)
        .where(models.Membership.user_id == user_id)
        .order_by(models.Membership.joined_at)
    ).all()
    return [
        schemas.UserGroupOut(**schemas.GroupOut.model_validate(group).model_dump(), role=role)
        for group, role in rows
    ]
