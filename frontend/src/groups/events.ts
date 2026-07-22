import { type FestivalEvent, type Group } from "../api";

/** A group whose festival has already finished. */
export interface PastGroup {
  group: Group;
  event: FestivalEvent;
}

/**
 * Upcoming or in progress. Events with no end time count as ongoing, matching
 * how useEventLiveness treats rows that predate the admin tool's scheduling.
 */
export function hasNotEnded(event: FestivalEvent): boolean {
  return !event.ends_at || Date.parse(event.ends_at) >= Date.now();
}

/** "Jun 12 – Jun 15, 2025", collapsing the month when the run stays inside one. */
export function formatEventDates(
  startsAt: string | null,
  endsAt: string | null
): string | null {
  if (!startsAt && !endsAt) return null;
  const start = startsAt ? new Date(startsAt) : null;
  const end = endsAt ? new Date(endsAt) : null;
  const dayMonth = (d: Date) => d.toLocaleDateString([], { month: "short", day: "numeric" });
  const full = (d: Date) =>
    d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

  if (!start) return full(end!);
  if (!end) return full(start);
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
    return `${dayMonth(start)} – ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${dayMonth(start)} – ${full(end)}`;
}
