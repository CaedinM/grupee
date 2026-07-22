import { useEffect, useState } from "react";

import { getGroupLocations, type MemberLocation } from "./api";

const POLL_INTERVAL_MS = 2000;

/** Polls the group's member locations every 2s while a group is active. */
export function useGroupLocations(groupId: string | null): {
  members: MemberLocation[];
  error: string | null;
} {
  const [members, setMembers] = useState<MemberLocation[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!groupId) {
      setMembers([]);
      setError(null);
      return;
    }
    let cancelled = false;
    let inFlight = false;

    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await getGroupLocations(groupId);
        if (!cancelled) {
          setMembers(res.members);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        inFlight = false;
      }
    };

    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [groupId]);

  return { members, error };
}
