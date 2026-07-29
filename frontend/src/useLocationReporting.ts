import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { type LocationReport, type LocationRow } from "./api";

// Send only after ~5m of real movement (enforced by the OS via distanceInterval,
// which is far more battery-efficient than sampling every fix in JS), plus a
// heartbeat every 3 minutes so a stationary user still proves liveness and keeps
// their Redis TTL refreshed. The backend's LOCATION_TTL_SECONDS must exceed this.
const MOVEMENT_DISTANCE_M = 5;
const HEARTBEAT_MS = 180_000;

export type Permission = "asking" | "granted" | "denied";

export interface LocationReporting {
  permission: Permission;
  /** Latest device fix (local, may not be persisted yet). */
  fix: Location.LocationObject | null;
  /** Latest position we sent to the backend (synthesized locally — the socket
   * is fire-and-forget, so there's no server echo to wait on). */
  lastAck: LocationRow | null;
  sentCount: number;
  error: string | null;
}

/**
 * Requests foreground location permission and watches the device position so the
 * map can always show the user's own dot. While `enabled` (the group's event is
 * live), each fix — delivered by the OS only after ~5m of movement — is pushed
 * up the location socket via `send`, plus a 3-minute heartbeat for standing
 * still. Outside a live-event group the position stays on-device.
 */
export function useLocationReporting(
  userId: string,
  enabled: boolean,
  send: (report: LocationReport) => void
): LocationReporting {
  const [permission, setPermission] = useState<Permission>("asking");
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
        return;
      }
      setPermission("granted");

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

  return { permission, fix, lastAck, sentCount, error };
}
