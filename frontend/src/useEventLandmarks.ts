import { listLandmarks, type Landmark } from "./api";
import { useCachedResource } from "./useCachedResource";

// Landmarks are cold, admin-authored data, so a slow refetch is enough to pick
// up edits; the interval doubles as the error-retry loop, mirroring
// useEventLiveness.
const REFETCH_INTERVAL_MS = 60_000;

/**
 * The landmarks for a group's event. Pass the group's `event_id` (or null) —
 * fetching only happens for that one event, so a groupless user or a group
 * with no event gets an empty list. This is the same gating the boundary uses
 * in MapScreen: nothing event-specific is shown unless you're in the group it
 * belongs to.
 *
 * Cache-first via useCachedResource: the last-seen landmarks for an event show
 * instantly on a cold open, then revalidate on the 60s loop.
 */
export function useEventLandmarks(eventId: string | null): Landmark[] {
  const { value } = useCachedResource(
    eventId ? `wta.landmarks.${eventId}` : null,
    () => listLandmarks(eventId!),
    REFETCH_INTERVAL_MS
  );
  return value ?? [];
}
