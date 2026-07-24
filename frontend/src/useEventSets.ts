import { listSets, type EventSet } from "./api";
import { useCachedResource } from "./useCachedResource";

// Sets are cold, admin-authored data like landmarks, so a slow refetch is
// enough to pick up edits; the interval doubles as the error-retry loop,
// mirroring useEventLandmarks. Which set is "now playing" is derived from the
// clock at render time, not from this fetch.
const REFETCH_INTERVAL_MS = 60_000;

/**
 * The performance sets for a group's event. Same gating as useEventLandmarks —
 * pass the group's `event_id` (or null) and nothing is fetched for a groupless
 * user or a group with no event. Callers only care about sets while the event
 * is live, so they typically pass null unless liveness is "live".
 *
 * Cache-first via useCachedResource: the last-seen schedule shows instantly on
 * a cold open (and the clock-based "now playing" derivation keeps working
 * offline), then revalidates on the 60s loop.
 */
export function useEventSets(eventId: string | null): EventSet[] {
  const { value } = useCachedResource(
    eventId ? `wta.sets.${eventId}` : null,
    () => listSets(eventId!),
    REFETCH_INTERVAL_MS
  );
  return value ?? [];
}

/**
 * The set playing on a given stage landmark at time `now` (ms epoch), or null
 * when nothing is on. The window is half-open [start, end) so back-to-back sets
 * never both match. `now` is passed in so the caller controls freshness (it
 * re-derives on each render while live).
 */
export function currentSetForLandmark(
  sets: EventSet[],
  landmarkId: string,
  now: number
): EventSet | null {
  for (const s of sets) {
    if (s.landmark_id !== landmarkId) continue;
    const start = new Date(s.start_time).getTime();
    const end = new Date(s.end_time).getTime();
    if (start <= now && now < end) return s;
  }
  return null;
}

/**
 * The next set scheduled to start on a given stage landmark after `now`, or
 * null when nothing is left today. Used to answer "who's up next" when no set
 * is currently on; the backend returns sets in start_time order but this
 * doesn't rely on that, taking the earliest still-future start.
 */
export function upcomingSetForLandmark(
  sets: EventSet[],
  landmarkId: string,
  now: number
): EventSet | null {
  let soonest: EventSet | null = null;
  let soonestStart = Infinity;
  for (const s of sets) {
    if (s.landmark_id !== landmarkId) continue;
    const start = new Date(s.start_time).getTime();
    if (start > now && start < soonestStart) {
      soonestStart = start;
      soonest = s;
    }
  }
  return soonest;
}
