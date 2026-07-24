import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type EventSet } from "./api";
import { useEventLandmarks } from "./useEventLandmarks";
import { useEventSets } from "./useEventSets";
import { type EventLiveness } from "./useEventLiveness";

// Sentinel stage-filter keys that aren't a landmark id.
const ALL = "all";
const OTHER = "other";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function isLiveNow(set: EventSet, now: number): boolean {
  const start = new Date(set.start_time).getTime();
  const end = new Date(set.end_time).getTime();
  return start <= now && now < end;
}

function isFinished(set: EventSet, now: number): boolean {
  return now >= new Date(set.end_time).getTime();
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

/**
 * Holds information about the user's current event: its name (plus date and
 * start time while it's still upcoming) and the full lineup of artists with
 * their set times.
 */
export default function MyEventScreen({ liveness }: { liveness: EventLiveness }) {
  const insets = useSafeAreaInsets();
  const event = liveness.event;
  // The lineup is worth showing whether the event is upcoming, live, or over,
  // so fetch it whenever there's an event (not gated on liveness).
  const sets = useEventSets(event?.id ?? null);
  const landmarks = useEventLandmarks(event?.id ?? null);
  const [stageFilter, setStageFilter] = useState<string>(ALL);
  // Re-derive which set is live on a timer so the highlight advances on its own
  // without a refetch. 30s matches the liveness tick elsewhere.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const lineup = [...sets].sort(
    (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
  );

  // Map stage landmark ids to names; sets pointing at a missing/non-stage
  // landmark (or none at all) fall into the "Other" bucket.
  const stageName = new Map(
    landmarks.filter((l) => l.kind === "stage").map((l) => [l.id, l.name] as const)
  );
  const bucketOf = (set: EventSet): string =>
    set.landmark_id && stageName.has(set.landmark_id) ? set.landmark_id : OTHER;

  // Tabs follow the landmark order, but only for stages that actually have
  // sets, plus a trailing "Other" when some set has no known stage.
  const stageTabs = landmarks
    .filter((l) => l.kind === "stage" && lineup.some((s) => s.landmark_id === l.id))
    .map((l) => ({ key: l.id, label: l.name }));
  const hasOther = lineup.some((s) => bucketOf(s) === OTHER);
  const tabs = [
    { key: ALL, label: "All" },
    ...stageTabs,
    ...(hasOther ? [{ key: OTHER, label: "Other" }] : []),
  ];
  // With one stage (or none) there's nothing to sort between, so hide the row.
  const showTabs = stageTabs.length + (hasOther ? 1 : 0) >= 2;
  // A stale selection (event/schedule changed under us) falls back to All.
  const selected = tabs.some((t) => t.key === stageFilter) ? stageFilter : ALL;
  const filtered = selected === ALL ? lineup : lineup.filter((s) => bucketOf(s) === selected);
  // Label each row with its stage only in the combined "All" view.
  const showStageOnRow = selected === ALL && showTabs;

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top }]}
      contentContainerStyle={styles.content}
    >
      {!event ? (
        <>
          <Text style={styles.title}>My Event</Text>
          <Text style={styles.empty}>
            {liveness.status === "loading"
              ? "Loading your event…"
              : "You're not in an event yet. Join or create a group to see your event."}
          </Text>
        </>
      ) : (
        <>
          <Text style={styles.title}>{event.name}</Text>

          {liveness.status === "upcoming" && event.starts_at && (
            <View style={styles.upcoming}>
              <Text style={styles.upcomingDate}>{formatDate(event.starts_at)}</Text>
              <Text style={styles.upcomingTime}>Starts {formatTime(event.starts_at)}</Text>
            </View>
          )}

          <Text style={styles.sectionTitle}>Lineup</Text>
          {lineup.length === 0 ? (
            <Text style={styles.empty}>No sets scheduled yet.</Text>
          ) : (
            <>
              {showTabs && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.tabs}
                  contentContainerStyle={styles.tabsContent}
                >
                  {tabs.map((t) => {
                    const active = t.key === selected;
                    return (
                      <Pressable
                        key={t.key}
                        style={[styles.chip, active && styles.chipActive]}
                        onPress={() => setStageFilter(t.key)}
                      >
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>
                          {t.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
              <View style={styles.list}>
                {filtered.map((set) => (
                  <SetRow
                    key={set.id}
                    set={set}
                    live={isLiveNow(set, now)}
                    past={isFinished(set, now)}
                    stage={
                      showStageOnRow && set.landmark_id
                        ? stageName.get(set.landmark_id) ?? null
                        : null
                    }
                  />
                ))}
              </View>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

function SetRow({
  set,
  stage,
  live,
  past,
}: {
  set: EventSet;
  stage: string | null;
  live: boolean;
  past: boolean;
}) {
  return (
    <View style={[styles.row, live && styles.rowLive, past && styles.rowPast]}>
      <View style={styles.rowMain}>
        {live && (
          <View style={styles.nowBadge}>
            <View style={styles.nowDot} />
            <Text style={styles.nowText}>Now playing</Text>
          </View>
        )}
        <Text style={[styles.artist, past && styles.textPast]}>{set.artist}</Text>
        {stage && <Text style={[styles.rowStage, past && styles.textPast]}>{stage}</Text>}
      </View>
      <Text style={[styles.setTime, past && styles.textPast]}>
        {formatTime(set.start_time)} – {formatTime(set.end_time)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#101014",
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
  },
  title: {
    fontSize: 34,
    fontWeight: "800",
    color: "#fff",
  },
  upcoming: {
    marginTop: 12,
    gap: 2,
  },
  upcomingDate: {
    fontSize: 17,
    color: "#e6e6ee",
    fontWeight: "600",
  },
  upcomingTime: {
    fontSize: 15,
    color: "#9a9aa5",
  },
  sectionTitle: {
    marginTop: 28,
    marginBottom: 12,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    color: "#71717c",
  },
  tabs: {
    marginBottom: 12,
    marginHorizontal: -24,
  },
  tabsContent: {
    paddingHorizontal: 24,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#16161b",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#2a2a32",
  },
  chipActive: {
    backgroundColor: "#5b5bf0",
    borderColor: "#5b5bf0",
  },
  chipText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#9a9aa5",
  },
  chipTextActive: {
    color: "#fff",
  },
  list: {
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#16161b",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  rowLive: {
    backgroundColor: "#1c1c2b",
    borderWidth: 1,
    borderColor: "#5b5bf0",
  },
  rowPast: {
    backgroundColor: "#131317",
    opacity: 0.55,
  },
  textPast: {
    color: "#8a8a94",
  },
  rowMain: {
    flex: 1,
    gap: 2,
  },
  nowBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  nowDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: "#5b5bf0",
  },
  nowText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: "#8f8ff5",
  },
  artist: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  rowStage: {
    fontSize: 13,
    color: "#71717c",
  },
  setTime: {
    fontSize: 14,
    color: "#9a9aa5",
  },
  empty: {
    marginTop: 16,
    fontSize: 15,
    color: "#71717c",
    lineHeight: 22,
  },
});
