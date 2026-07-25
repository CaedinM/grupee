// react-native-maps has no web support, so web gets the raw telemetry view
// instead of a map. Real map testing happens in Expo Go.
import { Ionicons } from "@expo/vector-icons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Group, User } from "./api";
import { landmarksContaining } from "./geo";
import { useTabBarClearance } from "./TabBar";
import { GlassSurface, Reveal } from "./ui/Glass";
import { color, font, glass, radius, space, type as typeScale } from "./ui/theme";
import { useEventLandmarks } from "./useEventLandmarks";
import { currentSetForLandmark, useEventSets } from "./useEventSets";
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
  // Same gating as the native map: only the active group's event landmarks.
  const landmarks = useEventLandmarks(group?.event_id ?? null);
  // The native map shows these as a pill under the group/event header; here
  // they surface as a telemetry line.
  const insideLandmarks = landmarksContaining(
    landmarks,
    lastAck ? { latitude: lastAck.lat, longitude: lastAck.lng } : null
  );
  // Only meaningful while live; the native map shows this artist next to the
  // stage name in the landmark pill, here it's appended to the "You're at:" line.
  const sets = useEventSets(live ? (group?.event_id ?? null) : null);
  const now = Date.now();
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.card,
        { paddingTop: insets.top + space.xl, paddingBottom: clearance + space.lg },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Reveal>
        <Text style={styles.eyebrow}>Web preview</Text>
        <Text style={typeScale.hero}>Hey, {user.display_name}</Text>
        <Text style={[styles.subtitle, { marginTop: space.sm }]}>
          The map view is native-only — open the app in Expo Go to see it. Location telemetry still
          runs here:
        </Text>
      </Reveal>

      {(liveness.status === "none" || liveness.status === "ended") && (
        <Note icon={liveness.status === "ended" ? "flag" : "people"}>
          {liveness.status === "ended" && liveness.event ? `${liveness.event.name} has ended. ` : ""}
          Use this page to track your group at your next event — go to My Groups to join your
          friends.
        </Note>
      )}

      {liveness.status === "upcoming" && liveness.event && (
        <Note icon="hourglass">
          {liveness.event.name} has not started yet.{" "}
          {liveness.event.starts_at
            ? `Check back at ${formatStartsAt(liveness.event.starts_at)} to see where your friends are at.`
            : "Check back once it starts to see where your friends are at."}
        </Note>
      )}

      {permission === "asking" && <Note icon="locate">Requesting location access…</Note>}
      {permission === "denied" && (
        <Text style={styles.error}>
          Location permission denied. Enable it in your browser to share your position.
        </Text>
      )}
      {permission === "granted" && (
        <StatBlock label="Telemetry">
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
        </StatBlock>
      )}

      <Pressable onPress={onOpenGroups} style={styles.groupLinkRow}>
        <Ionicons name="people" size={15} color={color.accentSoft} />
        <Text style={styles.groupLink}>
          {group ? `Viewing group: ${group.name} (${group.code})` : "No group — tap to join one"}
        </Text>
      </Pressable>

      {group && (
        <StatBlock label="Members">
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
        </StatBlock>
      )}

      {insideLandmarks.length > 0 && (
        <View style={styles.hereRow}>
          <Ionicons name="location" size={14} color={color.teal} />
          <Text style={styles.hereText}>
            You're at:{" "}
            {insideLandmarks
              .map((l) => {
                const playing =
                  live && l.kind === "stage" ? currentSetForLandmark(sets, l.id, now) : null;
                return playing ? `${l.name} (${playing.artist})` : l.name;
              })
              .join(", ")}
          </Text>
        </View>
      )}

      {group && landmarks.length > 0 && (
        <StatBlock label="Landmarks">
          {landmarks.map((l) => (
            <Stat key={l.id} label={l.name} value={`${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}`} />
          ))}
        </StatBlock>
      )}

      {(error ?? groupError) && <Text style={styles.error}>{error ?? groupError}</Text>}
    </ScrollView>
  );
}

/** Mirrors the native map's centred overlay card, as an inline block. */
function Note({
  icon,
  children,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
}) {
  return (
    <GlassSurface r={radius.lg}>
      <View style={styles.noteBody}>
        <Ionicons name={icon} size={18} color={color.accentSoft} />
        <Text style={styles.noteText}>{children}</Text>
      </View>
    </GlassSurface>
  );
}

function StatBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View>
      <Text style={styles.blockLabel}>{label}</Text>
      <GlassSurface r={radius.lg}>
        <View style={styles.stats}>{children}</View>
      </GlassSurface>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  card: {
    width: "100%",
    maxWidth: 460,
    alignSelf: "center",
    gap: space.lg,
    paddingHorizontal: space.xl,
  },
  eyebrow: {
    ...typeScale.label,
    color: color.accentSoft,
    marginBottom: space.sm,
  },
  subtitle: typeScale.subtitle,
  noteBody: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.md,
    padding: space.lg,
  },
  noteText: {
    flex: 1,
    fontFamily: font.sans,
    fontSize: 14.5,
    lineHeight: 21,
    color: color.textDim,
  },
  blockLabel: {
    ...typeScale.label,
    marginBottom: space.md,
  },
  stats: {
    padding: space.lg,
    gap: space.sm,
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space.md,
  },
  statLabel: {
    fontFamily: font.sans,
    color: color.textDim,
    fontSize: 14,
    flexShrink: 1,
  },
  // Mono rather than tabular-nums: the coordinates are the point of this view.
  statValue: {
    fontFamily: font.mono,
    color: color.text,
    fontSize: 13,
    letterSpacing: -0.2,
    flexShrink: 0,
  },
  groupLinkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    alignSelf: "flex-start",
    paddingVertical: space.sm,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: "rgba(167,158,255,0.12)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.stroke,
  },
  groupLink: {
    fontFamily: font.sansSemi,
    color: color.accentSoft,
    fontSize: 13.5,
  },
  hereRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  hereText: {
    flex: 1,
    fontFamily: font.sansMedium,
    color: color.teal,
    fontSize: 14,
  },
  error: {
    fontFamily: font.sansMedium,
    color: color.danger,
    fontSize: 14,
  },
});
