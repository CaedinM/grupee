import * as SecureStore from "expo-secure-store";

/**
 * The handoff between the running app and the headless background location task.
 *
 * The task runs in a bare JS runtime with no React mounted, so it can reach
 * nothing the app holds in memory: not the WebSocket (owned by a hook), and not
 * `api.ts`'s `getToken` (a module singleton assigned during `Root`'s render).
 * Everything it needs has to be on disk *before* it runs, and this module is the
 * only place that decides what "on disk" means — keeping the writer and the
 * reader from drifting apart on key names.
 *
 * The token is NOT an ordinary Clerk session JWT. Those live 60 seconds and are
 * refreshed by a timer that only ticks while React is mounted, so a cached one
 * is always expired by the time the task wakes. This is a token from Clerk's
 * `background` JWT template: hours long, and carrying `scope: "bg-location"` so
 * the backend accepts it on the location endpoint and nowhere else.
 */

const TOKEN_KEY = "wta.bg.token";
const GROUP_KEY = "wta.bg.group";
const USER_KEY = "wta.bg.user";

export interface BackgroundSession {
  token: string;
  groupId: string;
  userId: string;
}

/** Persist what the task needs. Call before starting background updates, and
 * again whenever the token is refreshed or the active group changes. */
export async function writeBackgroundSession(session: BackgroundSession): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, session.token),
    SecureStore.setItemAsync(GROUP_KEY, session.groupId),
    SecureStore.setItemAsync(USER_KEY, session.userId),
  ]);
}

/** Everything the task needs, or null if any part is missing — a half-written
 * session is unusable, and reporting with a stale group would be worse than not
 * reporting at all. */
export async function readBackgroundSession(): Promise<BackgroundSession | null> {
  const [token, groupId, userId] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEY),
    SecureStore.getItemAsync(GROUP_KEY),
    SecureStore.getItemAsync(USER_KEY),
  ]);
  if (!token || !groupId || !userId) return null;
  return { token, groupId, userId };
}

/** Drop the session so a task that fires after sign-out, after leaving the
 * group, or after the festival ends finds nothing and stands down. */
export async function clearBackgroundSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(GROUP_KEY),
    SecureStore.deleteItemAsync(USER_KEY),
  ]);
}
