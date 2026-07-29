import { useCallback, useEffect, useRef, useState } from "react";

import {
  getAuthToken,
  groupSocketUrl,
  type LocationReport,
  type MemberLocation,
} from "./api";

// Server → client frames. `snapshot` seeds every member on connect; `join`/
// `leave` track roster changes mid-session; `update` carries one member's new
// position. A member's own updates are never echoed back, so self stays fresh
// via a local patch in `send` instead.
type ServerMessage =
  | { type: "snapshot"; members: MemberLocation[] }
  | { type: "join"; user_id: string; member: MemberLocation }
  | { type: "update"; user_id: string; location: MemberLocation["location"] }
  | { type: "leave"; user_id: string };

export interface LocationSocket {
  /** Push this device's position up the socket (no-op until connected). */
  send: (report: LocationReport) => void;
  /** Every group member with their latest known position — same shape the old
   * 2s GET poll produced, so consumers are unchanged. */
  members: MemberLocation[];
  connected: boolean;
  error: string | null;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15000;

// Close codes the server sends for terminal rejections — reconnecting would
// just be rejected again, so we stop and surface the reason instead.
const TERMINAL_CODES: Record<number, string> = {
  4403: "You're not a member of this group",
  4404: "Group not found",
  4409: "This event has ended",
};

/**
 * One WebSocket to the active group: pushes this device's position up and keeps
 * a live map of every member's position from the server's pushes. Connects only
 * while `enabled` (the event is live) and a group is active; reconnects with
 * exponential backoff on transient drops. Replaces the old `useGroupLocations`
 * 2s poll and the 1.5s location PUT.
 */
export function useLocationSocket(
  userId: string,
  groupId: string | null,
  enabled: boolean
): LocationSocket {
  const [members, setMembers] = useState<MemberLocation[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  // The roster is kept in a ref (source of truth) and mirrored to state; the
  // ref lets `send` patch the self entry without depending on render timing.
  const membersRef = useRef<Map<string, MemberLocation>>(new Map());

  const publish = useCallback(() => {
    setMembers([...membersRef.current.values()]);
  }, []);

  const send = useCallback(
    (report: LocationReport) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "loc", ...report }));
      // The server doesn't echo our own updates, so patch self locally to keep
      // this device's dot/landmark tag current in the members list.
      const self = membersRef.current.get(userId);
      if (self) {
        membersRef.current.set(userId, {
          ...self,
          location: {
            lat: report.lat,
            lng: report.lng,
            heading: report.heading ?? null,
            battery: report.battery ?? null,
            accuracy: report.accuracy ?? null,
            updated_at: new Date().toISOString(),
          },
        });
        publish();
      }
    },
    [userId, publish]
  );

  useEffect(() => {
    if (!enabled || !groupId) {
      membersRef.current = new Map();
      setMembers([]);
      setConnected(false);
      setError(null);
      return;
    }

    let cancelled = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const scheduleReconnect = () => {
      if (cancelled) return;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    };

    const handle = (msg: ServerMessage) => {
      switch (msg.type) {
        case "snapshot":
          membersRef.current = new Map(msg.members.map((m) => [m.user_id, m]));
          publish();
          break;
        case "join":
          if (!membersRef.current.has(msg.user_id)) {
            membersRef.current.set(msg.user_id, msg.member);
            publish();
          }
          break;
        case "update": {
          const existing = membersRef.current.get(msg.user_id);
          membersRef.current.set(
            msg.user_id,
            existing
              ? { ...existing, location: msg.location }
              : {
                  user_id: msg.user_id,
                  display_name: "",
                  avatar_url: null,
                  role: "member",
                  location: msg.location,
                }
          );
          publish();
          break;
        }
        case "leave":
          if (membersRef.current.delete(msg.user_id)) publish();
          break;
      }
    };

    const connect = async () => {
      if (cancelled) return;
      const token = await getAuthToken();
      if (cancelled) return;
      if (!token) {
        setError("Not signed in");
        scheduleReconnect();
        return;
      }
      ws = new WebSocket(groupSocketUrl(groupId, token));
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        attempt = 0;
        setConnected(true);
        setError(null);
      };
      ws.onmessage = (event) => {
        if (cancelled) return;
        try {
          handle(JSON.parse(event.data) as ServerMessage);
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = (event) => {
        if (cancelled) return;
        setConnected(false);
        wsRef.current = null;
        const terminal = TERMINAL_CODES[event.code];
        if (terminal) {
          setError(terminal);
          return; // don't retry a rejection that will just recur
        }
        scheduleReconnect();
      };
      // onerror is followed by onclose, which owns the reconnect decision.
      ws.onerror = () => {};
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws) ws.close();
      wsRef.current = null;
      setConnected(false);
    };
  }, [userId, groupId, enabled, publish]);

  return { send, members, connected, error };
}
