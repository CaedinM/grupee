import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type EventSet } from "./api";
import { useTabBarClearance } from "./TabBar";
import { GlassSurface, PulseDot, Reveal, usePressScale } from "./ui/Glass";
import { color, font, radius, ramp, space, type } from "./ui/theme";
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
  // The tab bar floats over the content, so the last set has to be padded
  // clear of it by hand.
  const clearance = useTabBarClearance();
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
  const liveCount = filtered.filter((s) => isLiveNow(s, now)).length;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + space.md, paddingBottom: clearance + space.lg },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {!event ? (
        <Reveal>
          <Text style={styles.eyebrow}>Your event</Text>
          <Text style={type.hero}>Nothing booked</Text>
          <GlassSurface r={radius.lg} style={styles.emptyCard}>
            <View style={styles.emptyBody}>
              <Ionicons name="musical-notes-outline" size={26} color={color.accentSoft} />
              <Text style={styles.empty}>
                {liveness.status === "loading"
                  ? "Loading your event…"
                  : "Join or create a crew and the festival's full lineup shows up here."}
              </Text>
            </View>
          </GlassSurface>
        </Reveal>
      ) : (
        <>
          <Reveal>
            <Text style={styles.eyebrow}>
              {liveness.status === "live"
                ? "Happening now"
                : liveness.status === "ended"
                  ? "That's a wrap"
                  : "Your event"}
            </Text>
            <Text style={type.hero}>{event.name}</Text>
          </Reveal>

          {liveness.status === "upcoming" && event.starts_at && (
            <Reveal delay={70}>
              <GlassSurface r={radius.lg} raised style={styles.upcomingCard}>
                <View style={styles.upcomingBody}>
                  <View style={styles.upcomingIcon}>
                    <LinearGradient
                      colors={ramp.accent}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                    <Ionicons name="calendar" size={19} color="#fff" />
                  </View>
                  <View style={styles.upcomingText}>
                    <Text style={styles.upcomingDate}>{formatDate(event.starts_at)}</Text>
                    <Text style={styles.upcomingTime}>
                      Doors {formatTime(event.starts_at)}
                    </Text>
                  </View>
                </View>
              </GlassSurface>
            </Reveal>
          )}

          <Reveal delay={110}>
            <View style={styles.sectionRow}>
              <Text style={styles.sectionLabel}>Lineup</Text>
              {liveCount > 0 && (
                <View style={styles.liveCount}>
                  <PulseDot />
                  <Text style={styles.liveCountText}>
                    {liveCount} on now
                  </Text>
                </View>
              )}
            </View>
          </Reveal>

          {lineup.length === 0 ? (
            <Reveal delay={140}>
              <GlassSurface r={radius.lg} style={styles.emptyCard}>
                <View style={styles.emptyBody}>
                  <Text style={styles.empty}>No sets scheduled yet.</Text>
                </View>
              </GlassSurface>
            </Reveal>
          ) : (
            <>
              {showTabs && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.tabs}
                  contentContainerStyle={styles.tabsContent}
                >
                  {tabs.map((t) => (
                    <StageChip
                      key={t.key}
                      label={t.label}
                      active={t.key === selected}
                      onPress={() => setStageFilter(t.key)}
                    />
                  ))}
                </ScrollView>
              )}
              {/* Keyed on the filter so switching stages remounts the rows and
                  re-runs the stagger — the filter change gets its own beat. */}
              <View style={styles.list} key={selected}>
                {filtered.map((set, i) => (
                  <Reveal key={set.id} delay={Math.min(i, 8) * 45}>
                    <SetRow
                      set={set}
                      live={isLiveNow(set, now)}
                      past={isFinished(set, now)}
                      stage={
                        showStageOnRow && set.landmark_id
                          ? stageName.get(set.landmark_id) ?? null
                          : null
                      }
                    />
                  </Reveal>
                ))}
              </View>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

/** Glass segmented-control chip. The active one fills with the accent ramp. */
function StageChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { scale, onPressIn, onPressOut } = usePressScale(0.93);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut}>
        {active ? (
          <View style={styles.chipActive}>
            <LinearGradient
              colors={ramp.accent}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <LinearGradient colors={ramp.sheen} style={styles.chipSheen} pointerEvents="none" />
            <Text style={[styles.chipText, styles.chipTextActive]}>{label}</Text>
          </View>
        ) : (
          <GlassSurface r={radius.pill} intensity={34} sheen={false}>
            <Text style={[styles.chipText, styles.chipPad]}>{label}</Text>
          </GlassSurface>
        )}
      </Pressable>
    </Animated.View>
  );
}

/**
 * One set. The live row is the loudest thing on the screen: it gets a magenta
 * gradient rail down its leading edge and a brighter pane; finished sets fade
 * back so the eye lands on what's next.
 */
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
    <GlassSurface
      r={radius.md}
      intensity={live ? 52 : 38}
      raised={live}
      style={[styles.row, past && styles.rowPast]}
    >
      {live && (
        <LinearGradient
          colors={ramp.live}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.rail}
          pointerEvents="none"
        />
      )}
      <View style={[styles.rowBody, live && styles.rowBodyLive]}>
        <View style={styles.rowMain}>
          {live && (
            <View style={styles.nowBadge}>
              <PulseDot />
              <Text style={styles.nowText}>Now playing</Text>
            </View>
          )}
          <Text style={[styles.artist, past && styles.textPast]} numberOfLines={1}>
            {set.artist}
          </Text>
          {stage && (
            <Text style={[styles.rowStage, past && styles.textPast]} numberOfLines={1}>
              {stage}
            </Text>
          )}
        </View>
        <View style={styles.timeBlock}>
          <Text style={[styles.timeStart, past && styles.textPast]}>
            {formatTime(set.start_time)}
          </Text>
          <Text style={[styles.timeEnd, past && styles.textPast]}>
            {formatTime(set.end_time)}
          </Text>
        </View>
      </View>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: space.xl,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
  },
  eyebrow: {
    ...type.label,
    marginBottom: space.sm,
    color: color.accentSoft,
  },
  upcomingCard: {
    marginTop: space.lg,
  },
  upcomingBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
  },
  upcomingIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  upcomingText: {
    gap: 1,
  },
  upcomingDate: {
    fontFamily: font.displaySemi,
    fontSize: 17,
    letterSpacing: -0.3,
    color: color.text,
  },
  upcomingTime: {
    fontFamily: font.sans,
    fontSize: 13,
    color: color.textDim,
  },
  sectionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: space.xxl,
    marginBottom: space.lg,
  },
  sectionLabel: {
    ...type.label,
  },
  liveCount: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  liveCountText: {
    fontFamily: font.sansSemi,
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: color.magenta,
  },
  tabs: {
    marginBottom: space.lg,
    marginHorizontal: -space.xl,
    flexGrow: 0,
  },
  tabsContent: {
    paddingHorizontal: space.xl,
    gap: space.sm,
  },
  chipPad: {
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  chipActive: {
    borderRadius: radius.pill,
    overflow: "hidden",
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  chipSheen: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 14,
  },
  chipText: {
    fontFamily: font.sansSemi,
    fontSize: 13,
    letterSpacing: -0.1,
    color: color.textDim,
  },
  chipTextActive: {
    color: "#fff",
  },
  list: {
    gap: space.sm,
  },
  row: {
    overflow: "hidden",
  },
  rowPast: {
    opacity: 0.42,
  },
  rail: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    zIndex: 1,
  },
  rowBody: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
  },
  rowBodyLive: {
    paddingLeft: space.lg + 4,
    paddingVertical: 15,
  },
  rowMain: {
    flex: 1,
    gap: 2,
  },
  nowBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginBottom: space.xs,
  },
  nowText: {
    fontFamily: font.sansBold,
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    color: color.magenta,
  },
  artist: {
    fontFamily: font.displayBold,
    fontSize: 18,
    letterSpacing: -0.4,
    color: color.text,
  },
  rowStage: {
    fontFamily: font.sans,
    fontSize: 12.5,
    color: color.textFaint,
  },
  textPast: {
    color: color.textDim,
  },
  // Times stack rather than run inline, so the start time — the thing you
  // actually scan for — sits on its own baseline in mono.
  timeBlock: {
    alignItems: "flex-end",
  },
  timeStart: {
    fontFamily: font.monoBold,
    fontSize: 13,
    letterSpacing: -0.4,
    color: color.text,
  },
  timeEnd: {
    fontFamily: font.mono,
    fontSize: 11,
    letterSpacing: -0.3,
    color: color.textFaint,
  },
  emptyCard: {
    marginTop: space.xl,
  },
  emptyBody: {
    padding: space.xl,
    gap: space.md,
  },
  empty: {
    fontFamily: font.sans,
    fontSize: 15,
    lineHeight: 22,
    color: color.textDim,
  },
});
