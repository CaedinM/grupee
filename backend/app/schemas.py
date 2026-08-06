"""Pydantic v2 request/response models."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

LandmarkKind = Literal[
    "stage", "entrance", "exit", "restroom", "food", "drinks", "medical", "meetup", "other"
]

# Only stages are individually named ("Bassrush Arena"); every other kind is
# generic, so the server supplies the label rather than making clients invent one.
DEFAULT_LANDMARK_NAMES: dict[str, str] = {
    "entrance": "Entrance",
    "exit": "Exit",
    "restroom": "Restrooms",
    "food": "Food",
    "drinks": "Drinks",
    "medical": "Medical",
    "meetup": "Meetup point",
    "other": "Landmark",
}


# ---------- Users ----------

def _clean_display_name(value: str) -> str:
    """min_length alone lets "   " through, which renders as a nameless pin."""
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("display_name must not be blank")
    return cleaned


class UserCreate(BaseModel):
    display_name: str = Field(min_length=1)

    _strip_name = field_validator("display_name")(_clean_display_name)


class UserUpdate(BaseModel):
    display_name: str = Field(min_length=1)

    _strip_name = field_validator("display_name")(_clean_display_name)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    display_name: str
    avatar_url: str | None
    is_admin: bool
    created_at: datetime


# ---------- Locations ----------

class LocationIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    heading: float | None = Field(default=None, ge=0, le=360)
    battery: int | None = Field(default=None, ge=0, le=100)
    accuracy: float | None = Field(default=None, ge=0)


class LocationReportIn(LocationIn):
    """Body of `PUT /users/{id}/location`.

    `group_id` is what makes the HTTP path a true equal of the socket rather than
    a degraded fallback: supplied, the report is also fanned out to that group's
    channel and folded into the set-attendance accumulator, exactly as a `loc`
    frame would be. Omitted, the endpoint behaves as it always has (a bare
    position write), which is the shape `smoke_test.sh` exercises.

    The socket path keeps using the bare `LocationIn` — it already knows the
    group from the URL.
    """

    group_id: str | None = None


class LocationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    user_id: str
    lat: float
    lng: float
    heading: float | None
    battery: int | None
    accuracy: float | None
    updated_at: datetime


class LocationSnapshot(BaseModel):
    """Location as embedded in the group-locations read (no user_id repetition)."""

    model_config = ConfigDict(from_attributes=True)

    lat: float
    lng: float
    heading: float | None
    battery: int | None
    accuracy: float | None
    updated_at: datetime


# ---------- Groups & membership ----------

class GroupCreate(BaseModel):
    name: str = Field(min_length=1)
    event_id: str | None = None


class GroupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    code: str
    name: str
    event_id: str | None
    creator_id: str | None
    created_at: datetime


class MemberOut(BaseModel):
    user_id: str
    display_name: str
    avatar_url: str | None
    role: str


class GroupDetailOut(GroupOut):
    members: list[MemberOut]


class MembershipOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str
    group_id: str
    role: str
    joined_at: datetime


class UserGroupOut(GroupOut):
    role: str


class MemberLocationOut(BaseModel):
    user_id: str
    display_name: str
    avatar_url: str | None
    role: str
    location: LocationSnapshot | None


class GroupLocationsOut(BaseModel):
    members: list[MemberLocationOut]


# ---------- Events & map ----------

LatLng = list[float]

# A geofence is a polygon of 3..200 vertices (the closing edge back to the
# first point is implied, not stored).
BOUNDARY_MIN_POINTS = 3
BOUNDARY_MAX_POINTS = 200


def _validate_points(points: list[LatLng]) -> list[LatLng]:
    if len(points) < BOUNDARY_MIN_POINTS:
        raise ValueError(f"a boundary needs at least {BOUNDARY_MIN_POINTS} points")
    if len(points) > BOUNDARY_MAX_POINTS:
        raise ValueError(f"a boundary can have at most {BOUNDARY_MAX_POINTS} points")
    for point in points:
        if len(point) != 2:
            raise ValueError("each boundary point must be a [lat, lng] pair")
        lat, lng = point
        if not -90 <= lat <= 90:
            raise ValueError(f"latitude {lat} out of range -90..90")
        if not -180 <= lng <= 180:
            raise ValueError(f"longitude {lng} out of range -180..180")
    return points


class EventCreate(BaseModel):
    name: str = Field(min_length=1)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    # Optional so the event can exist before its geofence is drawn.
    boundary: list[LatLng] | None = None

    @field_validator("boundary")
    @classmethod
    def check_boundary(cls, v: list[LatLng] | None) -> list[LatLng] | None:
        return None if v is None else _validate_points(v)

    @model_validator(mode="after")
    def check_schedule(self) -> "EventCreate":
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        return self


class EventUpdate(EventCreate):
    """PUT /events/{id} is a full replacement of the same fields as create."""


class EventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    boundary: list[LatLng] | None
    starts_at: datetime | None
    ends_at: datetime | None
    creator_id: str | None
    created_at: datetime


class BoundaryIn(BaseModel):
    points: list[LatLng]

    @field_validator("points")
    @classmethod
    def check_points(cls, v: list[LatLng]) -> list[LatLng]:
        return _validate_points(v)


class BoundaryOut(BaseModel):
    boundary: list[LatLng]
    count: int


class LandmarkCreate(BaseModel):
    kind: LandmarkKind
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    # Required for stages, ignored for the generic kinds (see DEFAULT_LANDMARK_NAMES).
    name: str | None = None
    # Optional geofence for the landmark, validated the same way as events.boundary.
    boundary: list[LatLng] | None = None

    @field_validator("boundary")
    @classmethod
    def check_boundary(cls, v: list[LatLng] | None) -> list[LatLng] | None:
        return None if v is None else _validate_points(v)

    @model_validator(mode="after")
    def resolve_name(self) -> "LandmarkCreate":
        cleaned = (self.name or "").strip()
        if self.kind == "stage":
            if not cleaned:
                raise ValueError("a stage needs a name")
            self.name = cleaned
        else:
            self.name = cleaned or DEFAULT_LANDMARK_NAMES[self.kind]
        return self


class LandmarkOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    event_id: str
    name: str
    kind: str
    lat: float
    lng: float
    boundary: list[LatLng] | None
    created_at: datetime


class MapOut(BaseModel):
    boundary: list[LatLng] | None
    landmarks: list[LandmarkOut]


# ---------- Sets (performance schedule) ----------

class SetBase(BaseModel):
    artist: str = Field(min_length=1)
    start_time: datetime
    end_time: datetime
    # The stage this set is on. Optional so a set can be scheduled before its
    # stage exists; the router checks it belongs to the event and is a stage.
    landmark_id: str | None = None

    @field_validator("artist")
    @classmethod
    def _clean_artist(cls, v: str) -> str:
        # min_length alone lets "   " through.
        cleaned = v.strip()
        if not cleaned:
            raise ValueError("artist must not be blank")
        return cleaned

    @model_validator(mode="after")
    def check_window(self) -> "SetBase":
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be after start_time")
        return self


class SetCreate(SetBase):
    """POST /events/{id}/sets — event_id comes from the path, not the body."""


class SetUpdate(SetBase):
    """PUT /events/{id}/sets/{set_id} — full replacement of the same fields."""


class SetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    event_id: str
    landmark_id: str | None
    artist: str
    start_time: datetime
    end_time: datetime
    created_at: datetime


# ---------- Set attendance (acts you saw) ----------

class SetAttendanceOut(BaseModel):
    """One act the caller was credited with seeing. Carries the set's own fields
    so the client can render a recap list without also fetching the schedule."""

    set_id: str
    event_id: str
    artist: str
    start_time: datetime
    end_time: datetime
    landmark_id: str | None
    # Nullable for the same reason landmark_id is: deleting a stage only unlinks
    # its sets (ON DELETE SET NULL).
    stage_name: str | None
    first_seen_at: datetime
    dwell_seconds: int
