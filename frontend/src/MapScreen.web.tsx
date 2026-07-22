// react-native-maps has no web support, so web gets the raw telemetry view
// instead of a map. Real map testing happens in Expo Go.
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { Group, User } from "./api";
import type { EventLiveness } from "./useEventLiveness";
import { useGroupLocations } from "./useGroupLocations";
import type { LocationReporting } from "./useLocationReporting";

function formatStartsAt(iso: string): string {
  return new Date(iso).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function MapScreen({
  user,
  reporting,
  group,
  liveness,
  onOpenGroups,
}: {
  user: User;
  reporting: LocationReporting;
  group: Group | null;
  liveness: EventLiveness;
  onOpenGroups: () => void;
}) {
  const { permission, lastAck, sentCount, error } = reporting;
  const live = liveness.status === "live";
  // No polling outside a live event — matches the reporting side in App.tsx.
  const { members, error: groupError } = useGroupLocations(live ? (group?.id ?? null) : null);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Hey, {user.display_name}</Text>
      <Text style={styles.subtitle}>
        The map view is native-only — open the app in Expo Go to see it. Location telemetry still
        runs here:
      </Text>

      {(liveness.status === "none" || liveness.status === "ended") && (
        <Text style={styles.subtitle}>
          {liveness.status === "ended" && liveness.event ? `${liveness.event.name} has ended. ` : ""}
          Use this page to track your group at your next event — go to My Groups to join your
          friends.
        </Text>
      )}

      {liveness.status === "upcoming" && liveness.event && (
        <Text style={styles.subtitle}>
          {liveness.event.name} has not started yet.{" "}
          {liveness.event.starts_at
            ? `Check back at ${formatStartsAt(liveness.event.starts_at)} to see where your friends are at.`
            : "Check back once it starts to see where your friends are at."}
        </Text>
      )}

      {permission === "asking" && <Text style={styles.subtitle}>Requesting location access…</Text>}
      {permission === "denied" && (
        <Text style={styles.error}>
          Location permission denied. Enable it in your browser to share your position.
        </Text>
      )}
      {permission === "granted" && (
        <View style={styles.stats}>
          <Stat label="Updates sent" value={String(sentCount)} />
          {lastAck && (
            <>
              <Stat label="Latitude" value={lastAck.lat.toFixed(6)} />
              <Stat label="Longitude" value={lastAck.lng.toFixed(6)} />
              <Stat
                label="Server updated_at"
                value={new Date(lastAck.updated_at).toLocaleTimeString()}
              />
            </>
          )}
        </View>
      )}

      <Pressable onPress={onOpenGroups}>
        <Text style={styles.groupLink}>
          {group ? `Viewing group: ${group.name} (${group.code})` : "No group — tap to join one"}
        </Text>
      </Pressable>

      {group && (
        <View style={styles.stats}>
          {members.map((m) => (
            <Stat
              key={m.user_id}
              label={`${m.display_name}${m.user_id === user.id ? " (you)" : ""}`}
              value={
                m.location
                  ? `${m.location.lat.toFixed(5)}, ${m.location.lng.toFixed(5)}`
                  : "no location yet"
              }
            />
          ))}
        </View>
      )}

      {(error ?? groupError) && <Text style={styles.error}>{error ?? groupError}</Text>}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  title: {
    fontSize: 34,
    fontWeight: "800",
    color: "#fff",
  },
  subtitle: {
    fontSize: 16,
    color: "#9a9aa5",
  },
  stats: {
    backgroundColor: "#1c1c22",
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statLabel: {
    color: "#9a9aa5",
    fontSize: 15,
  },
  statValue: {
    color: "#fff",
    fontSize: 15,
    fontVariant: ["tabular-nums"],
  },
  groupLink: {
    color: "#8b8bf5",
    fontSize: 14,
    fontWeight: "600",
  },
  error: {
    color: "#ff6b6b",
    fontSize: 14,
  },
});
