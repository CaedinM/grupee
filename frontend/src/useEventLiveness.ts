import { useEffect, useState } from "react";

import { getEvent, type FestivalEvent, type Group } from "./api";
import { useCachedResource } from "./useCachedResource";

// Refetch keeps admin edits to the schedule flowing in; the tick re-evaluates
// liveness so the map flips over the moment the event starts or ends.
const REFETCH_INTERVAL_MS = 60_000;
const TICK_INTERVAL_MS = 30_000;

export type LivenessStatus =
  /** Not in a group. */
  | "none"
  /** In a group; its event is still being fetched. */
  | "loading"
  /** The group's event hasn't started yet. */
  | "upcoming"
  /** The event is on (or the group/event has no schedule) — track away. */
  | "live"
  /** The event is over. */
  | "ended";

export interface EventLiveness {
  status: LivenessStatus;
  event: FestivalEvent | null;
}

/**
 * Resolves the active group's event and whether it's currently live.
 * Groups or events without a schedule (pre-admin-tool rows) count as live so
 * old test data keeps working.
 */
export function useEventLiveness(group: Group | null): EventLiveness {
  const eventId = group?.event_id ?? null;
  // Cache-first via useCachedResource: a cached event resolves liveness (and
  // the map's geofence) instantly on a cold open instead of stalling on
  // "loading" until the network answers; the 60s refetch corrects a stale
  // schedule, and the 30s tick below flips the status at start/end.
  const { value: event } = useCachedResource(
    eventId ? `wta.event.${eventId}` : null,
    () => getEvent(eventId!),
    REFETCH_INTERVAL_MS
  );
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  if (!group) return { status: "none", event: null };
  if (!eventId) return { status: "live", event: null };
  if (!event) return { status: "loading", event: null };

  const starts = event.starts_at ? Date.parse(event.starts_at) : null;
  const ends = event.ends_at ? Date.parse(event.ends_at) : null;
  if (starts !== null && now < starts) return { status: "upcoming", event };
  if (ends !== null && now >= ends) return { status: "ended", event };
  return { status: "live", event };
}
