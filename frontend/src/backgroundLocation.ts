import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { AppState } from "react-native";

import { BASE_URL } from "./api";
import { readBackgroundSession } from "./backgroundSession";

/**
 * Location reporting while the app is minimized.
 *
 * The foreground path (`useLocationReporting` → `useLocationSocket`) stops dead
 * when the OS suspends the app: the 180s heartbeat is a JS timer, and the socket
 * is a React-owned resource. Without this module a pocketed phone goes dark on
 * its crew's map after the 210s Redis TTL, and set attendance — which counts
 * pings — credits nothing for a set the user watched in full.
 *
 * INVARIANT: nothing in the task handler may depend on React, on app state, or
 * on any module singleton assigned during render. Expo launches the app's JS
 * runtime, runs the task, and shuts it down again with no components mounted, so
 * `getToken`, the socket, and every hook are simply absent. The task reads what
 * it needs from SecureStore (`backgroundSession.ts`) and speaks HTTP. If you
 * find yourself importing a hook here, the design has been broken.
 *
 * Requires a development build; the app dropped Expo Go for exactly this reason.
 * Every entry point below still degrades to a no-op when TaskManager is
 * unavailable — `npm run web` has no OS-level task — so those platforms fall
 * back to foreground-only reporting instead of crashing.
 */

export const BG_LOCATION_TASK = "wta-background-location";

// Chosen against the size of a stage geofence: ~10m accuracy resolves which
// stage someone is standing in, while batching to at most one report per 30s
// keeps the radio duty cycle (and the battery cost over a 12-hour festival) far
// below the foreground profile's 5m / BestForNavigation.
const BG_ACCURACY = Location.Accuracy.High;
const BG_DISTANCE_M = 10;
const BG_DEFER_MS = 30_000;

TaskManager.defineTask(BG_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn("[bg-location] task error", error.message);
    return;
  }
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations;
  if (!locations?.length) return;

  // While the app is visible the foreground watcher owns reporting and streams
  // over the socket; both firing would double every position.
  if (AppState.currentState === "active") return;

  const session = await readBackgroundSession();
  if (!session) return; // signed out, left the group, or the event ended

  // Only the newest fix matters — positions are last-write-wins, and a deferred
  // batch can carry several.
  const { coords } = locations[locations.length - 1];
  try {
    const res = await fetch(`${BASE_URL}/users/${session.userId}/location`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({
        lat: coords.latitude,
        lng: coords.longitude,
        heading:
          coords.heading != null && coords.heading >= 0 && coords.heading <= 360
            ? coords.heading
            : null,
        accuracy: coords.accuracy != null && coords.accuracy >= 0 ? coords.accuracy : null,
        // What makes this equivalent to a socket frame: the server fans it out
        // to the group and folds it into set attendance.
        group_id: session.groupId,
      }),
    });
    if (!res.ok) console.warn(`[bg-location] report rejected: ${res.status}`);
  } catch (e) {
    // Offline in a field somewhere. The next fix will carry the newer position
    // anyway, so there is nothing worth queueing.
    console.warn("[bg-location] report failed", e);
  }
});

/** True when background location can actually run — false in Expo Go, where
 * TaskManager has no background execution. */
export async function isBackgroundLocationAvailable(): Promise<boolean> {
  try {
    return await TaskManager.isAvailableAsync();
  } catch {
    return false;
  }
}

/** Begin background updates. Idempotent, and a no-op where unsupported, so
 * callers can invoke it on every liveness change without guarding. */
export async function startBackgroundLocation(): Promise<boolean> {
  if (!(await isBackgroundLocationAvailable())) return false;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK)) return true;
    await Location.startLocationUpdatesAsync(BG_LOCATION_TASK, {
      accuracy: BG_ACCURACY,
      distanceInterval: BG_DISTANCE_M,
      deferredUpdatesInterval: BG_DEFER_MS,
      // iOS pauses updates when it decides you've stopped moving — which is
      // exactly what standing at a stage looks like, and would silence the
      // reports that earn a set credit.
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "Grupee is sharing your location",
        notificationBody: "Your crew can see where you are during the festival.",
        notificationColor: "#6E6BFF",
      },
    });
    return true;
  } catch (e) {
    console.warn("[bg-location] failed to start", e);
    return false;
  }
}

/** Stop background updates. Safe to call when never started. */
export async function stopBackgroundLocation(): Promise<void> {
  if (!(await isBackgroundLocationAvailable())) return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK);
    }
  } catch (e) {
    console.warn("[bg-location] failed to stop", e);
  }
}
