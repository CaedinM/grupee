import random
import string
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, redis_client, schemas
from ..auth import get_clerk_id, get_current_user, require_self
from ..database import get_db

router = APIRouter(prefix="/groups", tags=["groups"])

CODE_GENERATION_ATTEMPTS = 20


def generate_code() -> str:
    return "".join(random.choices(string.ascii_uppercase, k=4))


def has_ended(event: models.Event) -> bool:
    """Whether a festival is over. Events with no end time (rows predating the
    admin tool's scheduling) never expire — the client treats them as live too."""
    return event.ends_at is not None and event.ends_at < datetime.now(timezone.utc)


def event_has_ended(db: Session, group: models.Group) -> bool:
    """Whether the group's festival is over, so the group is history. Groups
    with no event never expire."""
    if group.event_id is None:
        return False
    event = db.get(models.Event, group.event_id)
    return event is not None and has_ended(event)


def get_group_or_404(db: Session, group_id: str) -> models.Group:
    group = db.get(models.Group, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


@router.post("", response_model=schemas.GroupOut, status_code=status.HTTP_201_CREATED)
def create_group(
    body: schemas.GroupCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.event_id is not None:
        event = db.get(models.Event, body.event_id)
        if event is None:
            raise HTTPException(status_code=404, detail="Event not found")
        # Same 409-vs-404 split as joining: the event exists, it's just over.
        if has_ended(event):
            raise HTTPException(status_code=409, detail="Cannot create group: event has ended")

    # Retry on join-code collision (26^4 codes, so collisions are rare but possible).
    for _ in range(CODE_GENERATION_ATTEMPTS):
        group = models.Group(
            name=body.name,
            code=generate_code(),
            creator_id=user.id,
            event_id=body.event_id,
        )
        db.add(group)
        db.add(models.Membership(user_id=user.id, group=group, role="admin"))
        try:
            db.commit()
            db.refresh(group)
            return group
        except IntegrityError:
            db.rollback()
    raise HTTPException(status_code=500, detail="Could not generate a unique join code")


@router.get("/by-code/{code}", response_model=schemas.GroupOut)
def get_group_by_code(code: str, _: str = Depends(get_clerk_id), db: Session = Depends(get_db)):
    group = db.execute(
        select(models.Group).where(models.Group.code == code.upper())
    ).scalar_one_or_none()
    if group is None:
        raise HTTPException(status_code=404, detail="Group not found")
    return group


@router.get("/{group_id}", response_model=schemas.GroupDetailOut)
def get_group(group_id: str, _: str = Depends(get_clerk_id), db: Session = Depends(get_db)):
    group = get_group_or_404(db, group_id)
    rows = db.execute(
        select(models.Membership, models.User.display_name, models.User.avatar_url)
        .join(models.User, models.User.id == models.Membership.user_id)
        .where(models.Membership.group_id == group_id)
        .order_by(models.Membership.joined_at)
    ).all()
    members = [
        schemas.MemberOut(user_id=m.user_id, display_name=name, avatar_url=avatar, role=m.role)
        for m, name, avatar in rows
    ]
    return schemas.GroupDetailOut(
        **schemas.GroupOut.model_validate(group).model_dump(), members=members
    )


@router.post("/{code}/members", response_model=schemas.MembershipOut)
def join_group(
    code: str,
    response: Response,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Join as the signed-in user — no body; identity comes from the token."""
    group = db.execute(
        select(models.Group).where(models.Group.code == code.upper())
    ).scalar_one_or_none()
    if group is None:
        raise HTTPException(status_code=404, detail="Invalid join code")

    # 409 (not 404) so the client can tell "no such code" from "too late" — the
    # group is real, its festival is just over.
    if event_has_ended(db, group):
        raise HTTPException(status_code=409, detail="Cannot join group: event has ended")

    existing = db.execute(
        select(models.Membership).where(
            models.Membership.group_id == group.id,
            models.Membership.user_id == user.id,
        )
    ).scalar_one_or_none()
    if existing is not None:
        response.status_code = status.HTTP_200_OK
        return existing

    membership = models.Membership(user_id=user.id, group_id=group.id, role="member")
    db.add(membership)
    db.commit()
    db.refresh(membership)
    response.status_code = status.HTTP_201_CREATED
    return membership


# 🔥 hot path: the map read, polled every ~2s per client. One Postgres query
# for the roster (memberships + user cards) joined against one Redis MGET for
# the live positions — positions never come from the main database.
# get_clerk_id (not get_current_user) keeps the auth cost at a token check only.
@router.get("/{group_id}/locations", response_model=schemas.GroupLocationsOut)
def get_group_locations(
    group_id: str, _: str = Depends(get_clerk_id), db: Session = Depends(get_db)
):
    get_group_or_404(db, group_id)
    rows = db.execute(
        select(models.Membership, models.User.display_name, models.User.avatar_url)
        .join(models.User, models.User.id == models.Membership.user_id)
        .where(models.Membership.group_id == group_id)
        .order_by(models.Membership.joined_at)
    ).all()
    # One round-trip for every member's position; missing/expired ones are absent
    # from the map and render as location=null, same as a member who never reported.
    positions = redis_client.read_locations([m.user_id for m, _name, _avatar in rows])
    members = [
        schemas.MemberLocationOut(
            user_id=membership.user_id,
            display_name=display_name,
            avatar_url=avatar_url,
            role=membership.role,
            location=(
                schemas.LocationSnapshot(**positions[membership.user_id])
                if membership.user_id in positions
                else None
            ),
        )
        for membership, display_name, avatar_url in rows
    ]
    return schemas.GroupLocationsOut(members=members)


@router.delete("/{group_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def leave_group(
    group_id: str,
    user_id: str,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_self(user, user_id)
    get_group_or_404(db, group_id)
    membership = db.execute(
        select(models.Membership).where(
            models.Membership.group_id == group_id,
            models.Membership.user_id == user_id,
        )
    ).scalar_one_or_none()
    if membership is None:
        raise HTTPException(status_code=404, detail="Membership not found")
    db.delete(membership)
    db.commit()
