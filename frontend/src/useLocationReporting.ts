import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { getBackgroundToken, type LocationReport, type LocationRow } from "./api";
import {
  isBackgroundLocationAvailable,
  startBackgroundLocation,
  stopBackgroundLocation,
} from "./backgroundLocation";
import { clearBackgroundSession, writeBackgroundSession } from "./backgroundSession";

// Send only after ~5m of real movement (enforced by the OS via distanceInterval,
// which is far more battery-efficient than sampling every fix in JS), plus a
// heartbeat every 3 minutes so a stationary user still proves liveness and keeps
// their Redis TTL refreshed. The backend's LOCATION_TTL_SECONDS must exceed this.
const MOVEMENT_DISTANCE_M = 5;
const HEARTBEAT_MS = 180_000;

// Re-mint the background token well inside the Clerk template's lifetime (12h).
// Minting needs React, so this is the app's only chance to keep the on-disk copy
// usable — a phone left untouched past the lifetime stops reporting in the
// background until it's next opened.
const BACKGROUND_TOKEN_REFRESH_MS = 4 * 60 * 60 * 1000;

export type Permission = "asking" | "granted" | "denied";

/** Background ("Always") location. `unsupported` is Expo Go, where the OS-level
 * task can't run at all; `denied` is a real refusal. Both mean the same thing
 * for behavior — tracking stops when the app is minimized — but they need
 * different copy, since only one is the user's to fix. */
export type BackgroundPermission = "asking" | "granted" | "denied" | "unsupported";

export interface LocationReporting {
  permission: Permission;
  backgroundPermission: BackgroundPermission;
  /** Latest device fix (local, may not be persisted yet). */
  fix: Location.LocationObject | null;
  /** Latest position we sent to the backend (synthesized locally — the socket
   * is fire-and-forget, so there's no server echo to wait on). */
  lastAck: LocationRow | null;
  sentCount: number;
  error: string | null;
}

/**
 * Requests location permission and watches the device position so the map can
 * always show the user's own dot. While `enabled` (the group's event is live),
 * each fix — delivered by the OS only after ~5m of movement — is pushed up the
 * location socket via `send`, plus a 3-minute heartbeat for standing still.
 * Outside a live-event group the position stays on-device.
 *
 * While `enabled`, it also hands off to the OS-level background task
 * (`backgroundLocation.ts`) so a minimized app keeps reporting over HTTP — the
 * foreground watcher and its heartbeat are both dead once iOS suspends the JS
 * runtime. Gating that on the same `enabled` flag means background tracking is
 * scoped to a live event and nothing else, which is also the honest answer for
 * an App Store "Always" justification.
 */
export function useLocationReporting(
  userId: string,
  groupId: string | null,
  enabled: boolean,
  send: (report: LocationReport) => void
): LocationReporting {
  const [permission, setPermission] = useState<Permission>("asking");
  const [backgroundPermission, setBackgroundPermission] =
    useState<BackgroundPermission>("asking");
  const [fix, setFix] = useState<Location.LocationObject | null>(null);
  const [lastAck, setLastAck] = useState<LocationRow | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<Location.LocationObject | null>(null);

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    // Normalize a fix into the report shape and push it up the socket. iOS
    // reports heading/accuracy as -1 when unknown; the API wants null for those
    // and rejects out-of-range values.
    const report = (position: Location.LocationObject) => {
      const { latitude, longitude, heading, accuracy } = position.coords;
      const payload: LocationReport = {
        lat: latitude,
        lng: longitude,
        heading: heading != null && heading >= 0 && heading <= 360 ? heading : null,
        accuracy: accuracy != null && accuracy >= 0 ? accuracy : null,
      };
      send(payload);
      if (!cancelled) {
        setLastAck({ user_id: userId, updated_at: new Date().toISOString(), ...payload });
        setSentCount((n) => n + 1);
        setError(null);
      }
    };

    (async () => {
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (!granted) {
        setPermission("denied");
        setBackgroundPermission("denied"); // background can't outrank foreground
        return;
      }
      setPermission("granted");

      // "Always" can only be asked for after foreground is granted. A refusal is
      // not an error — the app keeps working exactly as it did before, just
      // without tracking once minimized — so it's reported, not thrown.
      if (!(await isBackgroundLocationAvailable())) {
        if (!cancelled) setBackgroundPermission("unsupported"); // Expo Go
      } else {
        const background = await Location.requestBackgroundPermissionsAsync();
        if (cancelled) return;
        setBackgroundPermission(background.granted ? "granted" : "denied");
      }

      // Desktop browsers have no GPS and often can't do high-accuracy fixes,
      // so relax accuracy on web.
      const accuracy =
        Platform.OS === "web" ? Location.Accuracy.Balanced : Location.Accuracy.BestForNavigation;

      // Seed an initial fix so the dot appears (and the first position is sent)
      // even if the watch is slow to deliver; surface failure instead of hanging.
      try {
        const position = await Location.getCurrentPositionAsync({ accuracy });
        latest.current = position;
        if (!cancelled) {
          setFix(position);
          if (enabled) report(position);
        }
      } catch (e) {
        if (!cancelled) {
          setError(
            `No position fix: ${e instanceof Error ? e.message : String(e)}` +
              (Platform.OS === "web"
                ? " — on macOS, check System Settings → Privacy & Security → Location Services is on for your browser."
                : "")
          );
        }
      }

      // The OS delivers a fix only after ~5m of movement, so each callback is
      // already a "moved" event — send it straight up when enabled.
      sub = await Location.watchPositionAsync(
        { accuracy, distanceInterval: MOVEMENT_DISTANCE_M },
        (position) => {
          latest.current = position;
          if (cancelled) return;
          setFix(position);
          if (enabled) report(position);
        },
        (reason) => {
          if (!cancelled) setError(`Location watch error: ${reason}`);
        }
      );

      // Heartbeat: resend the last fix if nothing has moved, so a stationary
      // member stays live instead of expiring to no-location.
      if (enabled) {
        heartbeat = setInterval(() => {
          if (latest.current && !cancelled) report(latest.current);
        }, HEARTBEAT_MS);
      }
    })();

    return () => {
      cancelled = true;
      sub?.remove();
      if (heartbeat) clearInterval(heartbeat);
    };
  }, [userId, enabled, send]);

  // Background handoff, kept in its own effect because it's driven by the group
  // and the permission rather than by the watcher's lifecycle.
  //
  // The session has to be on disk BEFORE updates start: once the app is
  // suspended the task can't ask anyone for a token or a group id. It's
  // refreshed on a timer too, because a background token outlives a session JWT
  // but not a festival weekend — and re-minting only works while React is alive.
  useEffect(() => {
    const active = enabled && groupId !== null && backgroundPermission === "granted";
    if (!active) {
      // Clear first, so a task that fires during teardown finds nothing.
      void clearBackgroundSession().then(stopBackgroundLocation);
      return;
    }

    let cancelled = false;
    let refresh: ReturnType<typeof setInterval> | null = null;

    const sync = async () => {
      const token = await getBackgroundToken();
      if (cancelled) return;
      if (!token) {
        // Template missing or misconfigured in Clerk — stay foreground-only
        // rather than starting a task that could only ever get 401s.
        setError("Background location is unavailable (no background token).");
        return;
      }
      await writeBackgroundSession({ token, groupId, userId });
      if (!cancelled) await startBackgroundLocation();
    };

    void sync();
    refresh = setInterval(sync, BACKGROUND_TOKEN_REFRESH_MS);

    return () => {
      cancelled = true;
      if (refresh) clearInterval(refresh);
      void clearBackgroundSession().then(stopBackgroundLocation);
    };
  }, [userId, groupId, enabled, backgroundPermission]);

  return { permission, backgroundPermission, fix, lastAck, sentCount, error };
}
