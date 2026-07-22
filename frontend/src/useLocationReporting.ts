import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { putLocation, type LocationRow } from "./api";

const REPORT_INTERVAL_MS = 1500;

export type Permission = "asking" | "granted" | "denied";

export interface LocationReporting {
  permission: Permission;
  /** Latest device fix (local, may not be persisted yet). */
  fix: Location.LocationObject | null;
  /** Latest server-acknowledged location row (what's in the DB). */
  lastAck: LocationRow | null;
  sentCount: number;
  error: string | null;
}

/**
 * Requests foreground location permission and watches the device position so
 * the map can always show the user's own dot. The latest fix is PUT to the
 * backend every 1.5s only while `enabled` — outside a live-event group the
 * position stays on-device, since nobody can see it anyway.
 */
export function useLocationReporting(userId: string, enabled: boolean): LocationReporting {
  const [permission, setPermission] = useState<Permission>("asking");
  const [fix, setFix] = useState<Location.LocationObject | null>(null);
  const [lastAck, setLastAck] = useState<LocationRow | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<Location.LocationObject | null>(null);

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let inFlight = false;
    let cancelled = false;

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

      // Seed an initial fix so reporting starts even if the watch is slow to
      // deliver, and surface the failure instead of waiting forever.
      try {
        const position = await Location.getCurrentPositionAsync({ accuracy });
        latest.current = position;
        if (!cancelled) setFix(position);
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

      // The watch keeps `latest` fresh; the timer PUTs it every 1.5s.
      // (watchPositionAsync's timeInterval is Android-only, so our own timer
      // keeps the report cadence consistent on iOS too.)
      sub = await Location.watchPositionAsync(
        { accuracy, distanceInterval: 0 },
        (position) => {
          latest.current = position;
          if (!cancelled) setFix(position);
        },
        (reason) => {
          if (!cancelled) setError(`Location watch error: ${reason}`);
        }
      );

      if (!enabled) return; // watch only — nothing reports until the event is live

      timer = setInterval(async () => {
        const position = latest.current;
        if (!position || inFlight) return;
        inFlight = true;
        try {
          // iOS reports heading/accuracy as -1 when unknown; the API wants
          // null for unknown and rejects out-of-range values.
          const { heading, accuracy: acc } = position.coords;
          const ack = await putLocation(userId, {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            heading: heading != null && heading >= 0 && heading <= 360 ? heading : null,
            accuracy: acc != null && acc >= 0 ? acc : null,
          });
          if (!cancelled) {
            setLastAck(ack);
            setSentCount((n) => n + 1);
            setError(null);
          }
        } catch (e) {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        } finally {
          inFlight = false;
        }
      }, REPORT_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      sub?.remove();
      if (timer) clearInterval(timer);
    };
  }, [userId, enabled]);

  return { permission, fix, lastAck, sentCount, error };
}
