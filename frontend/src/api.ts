import Constants from "expo-constants";

// In Expo Go the dev server's host is the machine running `expo start`, which is
// also where the backend runs — so derive the LAN IP from it. Falls back to
// localhost (fine for the iOS simulator). Override with EXPO_PUBLIC_API_URL.
function resolveBaseUrl(): string {
  const override = process.env.EXPO_PUBLIC_API_URL;
  if (override) return override;
  const host = Constants.expoConfig?.hostUri?.split(":")[0];
  return `http://${host ?? "localhost"}:8000`;
}

export const BASE_URL = resolveBaseUrl();

// Clerk owns the session, but this module isn't a React component and can't
// call hooks — so the app registers useAuth().getToken here once signed in.
// Clerk caches the ~60s session JWT internally and refreshes it just before
// expiry, so calling this on every request is cheap.
type TokenGetter = () => Promise<string | null>;
let getToken: TokenGetter | null = null;

export function setTokenGetter(getter: TokenGetter | null) {
  getToken = getter;
}

async function authHeader(): Promise<Record<string, string>> {
  const token = getToken ? await getToken() : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface User {
  id: string;
  display_name: string;
  /** Path relative to the API root, or null. Use `avatarSource` to render it. */
  avatar_url: string | null;
  /** Set out-of-band in the DB — there is no API to grant admin. A stale
   * cached user may lack the field, so treat absence as false. */
  is_admin?: boolean;
  created_at: string;
}

/** Avatar paths are stored host-relative so they survive a changing LAN IP. */
export function avatarSource(user: User): { uri: string } | null {
  return avatarUri(user.avatar_url);
}

export function avatarUri(path: string | null): { uri: string } | null {
  if (!path) return null;
  // S3-backed uploads store absolute URLs; local-disk dev storage stores
  // host-relative paths that need the API base prefixed.
  return { uri: path.startsWith("http") ? path : `${BASE_URL}${path}` };
}

export interface LocationReport {
  lat: number;
  lng: number;
  heading?: number | null;
  battery?: number | null;
  accuracy?: number | null;
}

export interface LocationRow extends LocationReport {
  user_id: string;
  updated_at: string;
}

export interface Group {
  id: string;
  code: string;
  name: string;
  event_id: string | null;
  creator_id: string | null;
  created_at: string;
}

export interface GroupMember {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  role: string;
}

export interface GroupDetail extends Group {
  members: GroupMember[];
}

export interface UserGroup extends Group {
  role: string;
}

export interface Membership {
  id: string;
  user_id: string;
  group_id: string;
  role: string;
  joined_at: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
  });
  if (!res.ok) {
    throw await failure(res, init?.method ?? "GET", path);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

/** Prefers FastAPI's `detail` string so the UI can show "Avatar must be under 5 MB"
 * rather than a bare status code. 422 bodies use a list, which falls back. */
async function failure(res: Response, method: string, path: string): Promise<ApiError> {
  const detail = await res
    .json()
    .then((body) => (typeof body?.detail === "string" ? body.detail : null))
    .catch(() => null);
  return new ApiError(res.status, detail ?? `${method} ${path} failed: ${res.status}`);
}

/** Provision the profile for the signed-in Clerk account (idempotent — the
 * backend returns the existing row if this account already has one). */
export function createUser(displayName: string): Promise<User> {
  return request<User>("/users", {
    method: "POST",
    body: JSON.stringify({ display_name: displayName }),
  });
}

/** The signed-in account's profile; 404 until createUser has been called. */
export function getMe(): Promise<User> {
  return request<User>("/users/me");
}

export function getUser(userId: string): Promise<User> {
  return request<User>(`/users/${userId}`);
}

export function updateUser(userId: string, displayName: string): Promise<User> {
  return request<User>(`/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ display_name: displayName }),
  });
}

export interface PickedImage {
  uri: string;
  name: string;
  type: string;
}

export async function uploadAvatar(userId: string, image: PickedImage): Promise<User> {
  const form = new FormData();
  if (image.uri.startsWith("blob:") || image.uri.startsWith("data:")) {
    // On web the picker returns an in-memory object URL, which only becomes a
    // real multipart part once it has been read back into a Blob.
    form.append("file", await fetch(image.uri).then((r) => r.blob()), image.name);
  } else {
    // On native, FormData takes this {uri, name, type} shape and streams the
    // local file itself.
    form.append("file", { uri: image.uri, name: image.name, type: image.type } as unknown as Blob);
  }

  // Content-Type is deliberately unset so fetch can add the multipart boundary.
  const res = await fetch(`${BASE_URL}/users/${userId}/avatar`, {
    method: "PUT",
    headers: await authHeader(),
    body: form,
  });
  if (!res.ok) throw await failure(res, "PUT", `/users/${userId}/avatar`);
  return res.json();
}

export function deleteAvatar(userId: string): Promise<void> {
  return request<void>(`/users/${userId}/avatar`, { method: "DELETE" });
}

export function putLocation(userId: string, report: LocationReport): Promise<LocationRow> {
  return request<LocationRow>(`/users/${userId}/location`, {
    method: "PUT",
    body: JSON.stringify(report),
  });
}

export interface FestivalEvent {
  id: string;
  name: string;
  boundary: [number, number][] | null;
  starts_at: string | null;
  ends_at: string | null;
  creator_id: string | null;
  created_at: string;
}

export function listEvents(): Promise<FestivalEvent[]> {
  return request<FestivalEvent[]>("/events");
}

export function getEvent(eventId: string): Promise<FestivalEvent> {
  return request<FestivalEvent>(`/events/${eventId}`);
}

// Mirrors the backend's LandmarkKind Literal (schemas.py). Only stages are
// individually named; the server fills generic labels for the rest.
export type LandmarkKind =
  | "stage"
  | "entrance"
  | "exit"
  | "restroom"
  | "food"
  | "drinks"
  | "medical"
  | "meetup"
  | "other";

export interface Landmark {
  id: string;
  event_id: string;
  name: string;
  kind: LandmarkKind;
  lat: number;
  lng: number;
  /** Optional geofence for the landmark — a polygon of [lat, lng] vertices, or null. */
  boundary: [number, number][] | null;
  created_at: string;
}

export function listLandmarks(eventId: string): Promise<Landmark[]> {
  return request<Landmark[]>(`/events/${eventId}/landmarks`);
}

// A performance slot: an artist on a stage (landmark_id) for a time window.
// Named EventSet, not Set, to avoid shadowing the built-in Set. landmark_id is
// null for sets scheduled before their stage exists (see backend SetBase).
export interface EventSet {
  id: string;
  event_id: string;
  landmark_id: string | null;
  artist: string;
  start_time: string;
  end_time: string;
  created_at: string;
}

export function listSets(eventId: string): Promise<EventSet[]> {
  return request<EventSet[]>(`/events/${eventId}/sets`);
}

// Creator/joiner identity comes from the auth token, not the body.
export function createGroup(name: string, eventId: string): Promise<Group> {
  return request<Group>("/groups", {
    method: "POST",
    body: JSON.stringify({ name, event_id: eventId }),
  });
}

export function joinGroup(code: string): Promise<Membership> {
  return request<Membership>(`/groups/${code}/members`, { method: "POST" });
}

export function getGroup(groupId: string): Promise<GroupDetail> {
  return request<GroupDetail>(`/groups/${groupId}`);
}

export function getUserGroups(userId: string): Promise<UserGroup[]> {
  return request<UserGroup[]>(`/users/${userId}/groups`);
}

export function leaveGroup(groupId: string, userId: string): Promise<void> {
  return request<void>(`/groups/${groupId}/members/${userId}`, { method: "DELETE" });
}

export interface MemberLocation {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
  role: string;
  location: {
    lat: number;
    lng: number;
    heading: number | null;
    battery: number | null;
    accuracy: number | null;
    updated_at: string;
  } | null;
}

export function getGroupLocations(groupId: string): Promise<{ members: MemberLocation[] }> {
  return request<{ members: MemberLocation[] }>(`/groups/${groupId}/locations`);
}
