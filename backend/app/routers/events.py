from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import get_clerk_id, get_current_user
from ..database import get_db

router = APIRouter(prefix="/events", tags=["events"])


def get_event_or_404(db: Session, event_id: str) -> models.Event:
    event = db.get(models.Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


def check_event_admin(event: models.Event, user: models.User) -> None:
    """Event writes are allowed for the event's creator and platform admins
    (users.is_admin, granted out-of-band). Identity comes from the verified
    token, so this is real authorization now."""
    if user.is_admin:
        return
    if event.creator_id is None or event.creator_id != user.id:
        raise HTTPException(status_code=403, detail="Only the event creator can do this")


@router.post("", response_model=schemas.EventOut, status_code=status.HTTP_201_CREATED)
def create_event(
    body: schemas.EventCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = models.Event(
        name=body.name,
        starts_at=body.starts_at,
        ends_at=body.ends_at,
        boundary=body.boundary,
        creator_id=user.id,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.put("/{event_id}", response_model=schemas.EventOut)
def update_event(
    event_id: str,
    body: schemas.EventUpdate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Full replacement of the editable fields (PUT semantics): omitting
    starts_at/ends_at/boundary clears them."""
    event = get_event_or_404(db, event_id)
    check_event_admin(event, user)
    event.name = body.name
    event.starts_at = body.starts_at
    event.ends_at = body.ends_at
    event.boundary = body.boundary
    db.commit()
    db.refresh(event)
    return event


@router.get("", response_model=list[schemas.EventOut])
def list_events(_: str = Depends(get_clerk_id), db: Session = Depends(get_db)):
    return db.execute(select(models.Event).order_by(models.Event.created_at)).scalars().all()


@router.get("/{event_id}", response_model=schemas.EventOut)
def get_event(event_id: str, _: str = Depends(get_clerk_id), db: Session = Depends(get_db)):
    return get_event_or_404(db, event_id)


@router.get("/{event_id}/map", response_model=schemas.MapOut)
def get_event_map(event_id: str, _: str = Depends(get_clerk_id), db: Session = Depends(get_db)):
    event = get_event_or_404(db, event_id)
    landmarks = db.execute(
        select(models.Landmark)
        .where(models.Landmark.event_id == event_id)
        .order_by(models.Landmark.created_at)
    ).scalars().all()
    return schemas.MapOut(boundary=event.boundary, landmarks=landmarks)


@router.put("/{event_id}/boundary", response_model=schemas.BoundaryOut)
def set_boundary(
    event_id: str,
    body: schemas.BoundaryIn,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = get_event_or_404(db, event_id)
    check_event_admin(event, user)
    event.boundary = body.points
    db.commit()
    return schemas.BoundaryOut(boundary=body.points, count=len(body.points))


@router.post(
    "/{event_id}/landmarks", response_model=schemas.LandmarkOut, status_code=status.HTTP_201_CREATED
)
def add_landmark(
    event_id: str,
    body: schemas.LandmarkCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = get_event_or_404(db, event_id)
    check_event_admin(event, user)
    landmark = models.Landmark(
        event_id=event_id,
        name=body.name,
        kind=body.kind,
        lat=body.lat,
        lng=body.lng,
        boundary=body.boundary,
    )
    db.add(landmark)
    db.commit()
    db.refresh(landmark)
    return landmark


@router.get("/{event_id}/landmarks", response_model=list[schemas.LandmarkOut])
def list_landmarks(
    event_id: str, _: str = Depends(get_clerk_id), db: Session = Depends(get_db)
):
    get_event_or_404(db, event_id)
    return db.execute(
        select(models.Landmark)
        .where(models.Landmark.event_id == event_id)
        .order_by(models.Landmark.created_at)
    ).scalars().all()


@router.delete("/{event_id}/landmarks/{landmark_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_landmark(
    event_id: str,
    landmark_id: str,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = get_event_or_404(db, event_id)
    check_event_admin(event, user)
    landmark = db.get(models.Landmark, landmark_id)
    if landmark is None or landmark.event_id != event_id:
        raise HTTPException(status_code=404, detail="Landmark not found")
    db.delete(landmark)
    db.commit()


def _resolve_set_landmark(db: Session, event_id: str, landmark_id: str | None) -> str | None:
    """A set's stage must be a `stage` landmark of the same event (or None).
    Rejecting cross-event or non-stage references keeps the schedule coherent."""
    if landmark_id is None:
        return None
    landmark = db.get(models.Landmark, landmark_id)
    if landmark is None or landmark.event_id != event_id:
        raise HTTPException(status_code=400, detail="landmark_id does not belong to this event")
    if landmark.kind != "stage":
        raise HTTPException(status_code=400, detail="a set can only be tied to a stage landmark")
    return landmark_id


@router.post(
    "/{event_id}/sets", response_model=schemas.SetOut, status_code=status.HTTP_201_CREATED
)
def add_set(
    event_id: str,
    body: schemas.SetCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = get_event_or_404(db, event_id)
    check_event_admin(event, user)
    performance = models.Set(
        event_id=event_id,
        landmark_id=_resolve_set_landmark(db, event_id, body.landmark_id),
        artist=body.artist,
        start_time=body.start_time,
        end_time=body.end_time,
    )
    db.add(performance)
    db.commit()
    db.refresh(performance)
    return performance


@router.get("/{event_id}/sets", response_model=list[schemas.SetOut])
def list_sets(
    event_id: str, _: str = Depends(get_clerk_id), db: Session = Depends(get_db)
):
    get_event_or_404(db, event_id)
    return db.execute(
        select(models.Set)
        .where(models.Set.event_id == event_id)
        .order_by(models.Set.start_time)
    ).scalars().all()


@router.put("/{event_id}/sets/{set_id}", response_model=schemas.SetOut)
def update_set(
    event_id: str,
    set_id: str,
    body: schemas.SetUpdate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Full replacement of the editable fields (PUT semantics)."""
    event = get_event_or_404(db, event_id)
    check_event_admin(event, user)
    performance = db.get(models.Set, set_id)
    if performance is None or performance.event_id != event_id:
        raise HTTPException(status_code=404, detail="Set not found")
    performance.landmark_id = _resolve_set_landmark(db, event_id, body.landmark_id)
    performance.artist = body.artist
    performance.start_time = body.start_time
    performance.end_time = body.end_time
    db.commit()
    db.refresh(performance)
    return performance


@router.delete("/{event_id}/sets/{set_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_set(
    event_id: str,
    set_id: str,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    event = get_event_or_404(db, event_id)
    check_event_admin(event, user)
    performance = db.get(models.Set, set_id)
    if performance is None or performance.event_id != event_id:
        raise HTTPException(status_code=404, detail="Set not found")
    db.delete(performance)
    db.commit()
