// Thin client for the WhereTheyAt backend. Every call sends the Clerk session
// JWT as a bearer token; the backend maps its `sub` claim to users.clerk_id.

export const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export interface AdminUser {
  id: string;
  display_name: string;
  avatar_url: string | null;
  is_admin: boolean;
  created_at: string;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((body) => (typeof body?.detail === "string" ? body.detail : null))
      .catch(() => null);
    throw new ApiError(res.status, detail ?? `${init?.method ?? "GET"} ${path} failed: ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/** The signed-in account's local user row; 404 until the phone app has provisioned it. */
export function getMe(token: string): Promise<AdminUser> {
  return request<AdminUser>("/users/me", token);
}

/** [lat, lng] — matches the backend's boundary point order. */
export type LatLng = [number, number];

export interface FestivalEvent {
  id: string;
  name: string;
  boundary: LatLng[] | null;
  starts_at: string | null;
  ends_at: string | null;
  creator_id: string | null;
  created_at: string;
}

export interface EventCreateBody {
  name: string;
  starts_at: string;
  ends_at: string;
  boundary: LatLng[] | null;
}

export function createEvent(token: string, body: EventCreateBody): Promise<FestivalEvent> {
  return request<FestivalEvent>("/events", token, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listEvents(token: string): Promise<FestivalEvent[]> {
  return request<FestivalEvent[]>("/events", token);
}

/** The landmark kinds the admin tool places. The backend accepts more
 *  (food, drinks, medical…) — those aren't exposed here yet. */
export const LANDMARK_KINDS = ["entrance", "exit", "restroom", "stage"] as const;
export type LandmarkKind = (typeof LANDMARK_KINDS)[number];

/** Emoji stand in for real icons for now. */
export const LANDMARK_META: Record<LandmarkKind, { label: string; emoji: string }> = {
  entrance: { label: "Entrance", emoji: "🚪" },
  exit: { label: "Exit", emoji: "🚨" },
  restroom: { label: "Restrooms", emoji: "🚻" },
  stage: { label: "Stage", emoji: "🎪" },
};

export function landmarkEmoji(kind: string): string {
  return kind in LANDMARK_META ? LANDMARK_META[kind as LandmarkKind].emoji : "📍";
}

export interface Landmark {
  id: string;
  event_id: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
  boundary: LatLng[] | null;
  created_at: string;
}

/** name is only sent for stages; the server labels the generic kinds. */
export interface LandmarkCreateBody {
  kind: LandmarkKind;
  name?: string;
  lat: number;
  lng: number;
  // Optional geofence drawn for the landmark; null when "no boundary" is chosen.
  boundary?: LatLng[] | null;
}

export function listLandmarks(token: string, eventId: string): Promise<Landmark[]> {
  return request<Landmark[]>(`/events/${eventId}/landmarks`, token);
}

export function createLandmark(
  token: string,
  eventId: string,
  body: LandmarkCreateBody
): Promise<Landmark> {
  return request<Landmark>(`/events/${eventId}/landmarks`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteLandmark(token: string, eventId: string, landmarkId: string): Promise<void> {
  return request<void>(`/events/${eventId}/landmarks/${landmarkId}`, token, { method: "DELETE" });
}

/** Full replacement of the editable fields (name, schedule, boundary). */
export function updateEvent(
  token: string,
  eventId: string,
  body: EventCreateBody
): Promise<FestivalEvent> {
  return request<FestivalEvent>(`/events/${eventId}`, token, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/** A performance slot: which artist plays which stage (landmark) and when.
 *  start_time/end_time are ISO UTC strings; landmark_id is null when the set
 *  isn't tied to a stage. */
export interface FestivalSet {
  id: string;
  event_id: string;
  landmark_id: string | null;
  artist: string;
  start_time: string;
  end_time: string;
  created_at: string;
}

export interface SetCreateBody {
  artist: string;
  start_time: string;
  end_time: string;
  landmark_id?: string | null;
}

export function listSets(token: string, eventId: string): Promise<FestivalSet[]> {
  return request<FestivalSet[]>(`/events/${eventId}/sets`, token);
}

export function createSet(
  token: string,
  eventId: string,
  body: SetCreateBody
): Promise<FestivalSet> {
  return request<FestivalSet>(`/events/${eventId}/sets`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function updateSet(
  token: string,
  eventId: string,
  setId: string,
  body: SetCreateBody
): Promise<FestivalSet> {
  return request<FestivalSet>(`/events/${eventId}/sets/${setId}`, token, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteSet(token: string, eventId: string, setId: string): Promise<void> {
  return request<void>(`/events/${eventId}/sets/${setId}`, token, { method: "DELETE" });
}
