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
