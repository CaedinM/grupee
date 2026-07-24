import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polygon } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  avatarSource,
  avatarUri,
  type EventSet,
  type Group,
  type Landmark,
  type User,
} from "./api";
import { landmarksContaining } from "./geo";
import { useEventLandmarks } from "./useEventLandmarks";
import { currentSetForLandmark, upcomingSetForLandmark, useEventSets } from "./useEventSets";
import type { EventLiveness } from "./useEventLiveness";
import { useGroupLocations } from "./useGroupLocations";
import type { LocationReporting } from "./useLocationReporting";

// Ionicon per landmark kind. Falls back to a generic pin for the "other" kind
// and anything the server adds before this map does.
const LANDMARK_ICONS: Record<Landmark["kind"], keyof typeof Ionicons.glyphMap> = {
  stage: "musical-notes",
  entrance: "log-in",
  exit: "log-out",
  restroom: "male-female",
  food: "restaurant",
  drinks: "beer",
  medical: "medkit",
  meetup: "flag",
  other: "location",
};

/**
 * A point guaranteed inside the boundary polygon ([lat, lng] points), for
 * anchoring the label. A centroid can fall outside concave or
 * self-intersecting shapes — hand-drawn geofences are often both — so
 * instead: cast a horizontal line across the middle of the bounding box and
 * take the midpoint of the widest span that's inside the polygon.
 */
function boundaryLabelPoint(points: [number, number][]): { latitude: number; longitude: number } {
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lat] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const lat = (minLat + maxLat) / 2;

  // Longitudes where polygon edges cross the scanline. The half-open test
  // counts edges consistently when the line passes through a vertex.
  const crossings: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const [lat1, lng1] = points[i];
    const [lat2, lng2] = points[(i + 1) % points.length];
    if ((lat1 <= lat) !== (lat2 <= lat)) {
      crossings.push(lng1 + ((lat - lat1) / (lat2 - lat1)) * (lng2 - lng1));
    }
  }
  crossings.sort((a, b) => a - b);

  // Even-odd rule: [0]–[1], [2]–[3], … are the inside spans.
  let best: number | null = null;
  let bestWidth = -1;
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const width = crossings[i + 1] - crossings[i];
    if (width > bestWidth) {
      bestWidth = width;
      best = (crossings[i] + crossings[i + 1]) / 2;
    }
  }
  if (best === null) {
    // Degenerate (all points collinear): the vertex mean is as good as any.
    return {
      latitude: points.reduce((sum, [la]) => sum + la, 0) / points.length,
      longitude: points.reduce((sum, [, ln]) => sum + ln, 0) / points.length,
    };
  }
  return { latitude: lat, longitude: best };
}

function formatStartsAt(iso: string): string {
  return new Date(iso).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Muted-monochrome 3D look (closest Apple Maps gets to the Mapbox "light"
// style — the real thing needs @rnmapbox/maps and a dev build, see
// shipping.md). Pitch tilts the camera so building volumes render; altitude
// (iOS) / zoom (Android) put it low enough that they actually appear.
const CAMERA_TILT = { pitch: 55, heading: 0, altitude: 700, zoom: 17 };

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
  const { permission, fix, lastAck, error } = reporting;
  const live = liveness.status === "live";
  // No polling outside a live event — matches the reporting side in App.tsx.
  const { members, error: groupError } = useGroupLocations(live ? (group?.id ?? null) : null);
  const mapRef = useRef<MapView>(null);
  const insets = useSafeAreaInsets();

  // Which stage's info bubble is open, and where to anchor it (screen pixels).
  // We render the bubble ourselves as an overlay rather than using a native
  // Callout: the custom-tooltip Callout draws its content once before animating
  // (a visible flash) and fights the ~1.5s location re-render. A plain overlay
  // gives full control over show/hide and the pop-in.
  const [selectedStage, setSelectedStage] = useState<SelectedStage | null>(null);
  const closeStage = useCallback(() => setSelectedStage(null), []);

  // The press handler is stable (so markers stay cheap), but needs the current
  // live flag and schedule — read them from a ref that each render refreshes.
  const stageDataRef = useRef<{ live: boolean; sets: EventSet[] }>({ live: false, sets: [] });
  const onSelectStage = useCallback(async (landmark: Landmark) => {
    const { live, sets } = stageDataRef.current;
    // Tapping any non-stage pin (or any pin outside a live event) just closes an
    // open bubble; only live stages open one.
    if (!live || landmark.kind !== "stage") {
      setSelectedStage(null);
      return;
    }
    const callout = stageCalloutFor(sets, landmark.id, Date.now());
    const point = await mapRef.current?.pointForCoordinate({
      latitude: landmark.lat,
      longitude: landmark.lng,
    });
    if (point) setSelectedStage({ landmark, callout, x: point.x, y: point.y });
  }, []);

  const coordinate = fix
    ? { latitude: fix.coords.latitude, longitude: fix.coords.longitude }
    : lastAck
      ? { latitude: lastAck.lat, longitude: lastAck.lng }
      : null;

  // Everyone else in the group with a known position; own dot comes from the
  // local GPS fix, not the server echo.
  const others = members.filter((m) => m.user_id !== user.id && m.location !== null);

  // The event's geofence, drawn for group members whether the event is live
  // yet or not — it shows where to head. Points are [lat, lng].
  const boundary = group ? (liveness.event?.boundary ?? null) : null;

  // Landmarks are gated exactly like the boundary: only for the event the
  // active group belongs to, and only while in that group (a null event_id
  // yields an empty list). Shown regardless of liveness — they're wayfinding.
  const landmarks = useEventLandmarks(group?.event_id ?? null);

  // Sets are only surfaced while the event is live, so only fetch them then —
  // the "now playing" artist is meaningless before/after the festival.
  const sets = useEventSets(live ? (group?.event_id ?? null) : null);
  stageDataRef.current = { live, sets };

  // Drop any open bubble when the event/liveness changes out from under it.
  useEffect(() => setSelectedStage(null), [live, group?.event_id]);

  const recenter = () => {
    // Recentering moves the map, so the overlay bubble's anchor would drift —
    // close it rather than leave it floating over the wrong pin.
    setSelectedStage(null);
    if (coordinate) {
      // animateCamera (not animateToRegion) so the 3D pitch survives recentering.
      mapRef.current?.animateCamera({ center: coordinate, ...CAMERA_TILT }, { duration: 300 });
    }
  };

  if (!coordinate) {
    return (
      <View style={styles.waiting}>
        <Text style={styles.waitingTitle}>Hey, {user.display_name}</Text>
        <Text style={styles.waitingText}>
          {permission === "asking" && "Requesting location access…"}
          {permission === "granted" && "Waiting for a GPS fix…"}
          {permission === "denied" &&
            "Location permission denied. Enable it in Settings to share your position."}
        </Text>
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    );
  }

  const displayedError = error ?? groupError;

  // Landmarks whose geofence currently contains the user. Landmarks are already
  // scoped to the active group's event, so this answers "which landmark am I in
  // at the event I'm at". Usually one, but overlapping zones can yield several.
  const insideLandmarks = landmarksContaining(landmarks, coordinate);

  // Re-read on each render; while live the location fix re-renders this screen
  // every ~1.5s, which is far finer than set boundaries need.
  const now = Date.now();

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialCamera={{ center: coordinate, ...CAMERA_TILT }}
        // mutedStandard is Apple Maps only; Android keeps the standard style.
        mapType={Platform.OS === "ios" ? "mutedStandard" : "standard"}
        showsBuildings
        showsPointsOfInterest={false}
        // A tap on empty map, or the start of a pan/zoom, closes the stage
        // bubble instantly — no waiting on a native deselect.
        onPress={closeStage}
        onPanDrag={closeStage}
      >
        {boundary && (
          <Polygon
            coordinates={boundary.map(([latitude, longitude]) => ({ latitude, longitude }))}
            strokeColor="rgba(91, 91, 240, 0.9)"
            strokeWidth={2}
            fillColor="rgba(91, 91, 240, 0.08)"
          />
        )}

        {boundary && liveness.event && (
          <Marker
            coordinate={boundaryLabelPoint(boundary)}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
            zIndex={-1}
          >
            <Text style={styles.eventLabelText}>{liveness.event.name}</Text>
          </Marker>
        )}

        {landmarks.map((l) => (
          <LandmarkMarker key={l.id} landmark={l} onPress={onSelectStage} />
        ))}

        {others.map((m) => (
          <AvatarMarker
            key={`${m.user_id}-${m.avatar_url ?? "none"}`}
            coordinate={{ latitude: m.location!.lat, longitude: m.location!.lng }}
            uri={avatarUri(m.avatar_url)?.uri ?? null}
            color="#f97316"
            label={m.display_name}
          />
        ))}

        <AvatarMarker
          key={`self-${user.avatar_url ?? "none"}`}
          coordinate={coordinate}
          uri={avatarSource(user)?.uri ?? null}
          color="#5b5bf0"
        />
      </MapView>

      {selectedStage && (
        <StageBubble
          // Remount per stage so the pop-in animation replays on each new tap.
          key={selectedStage.landmark.id}
          selection={selectedStage}
        />
      )}

      {/* Nothing to show without a group — the centre overlay is what prompts
          joining one. */}
      {group && (
        <View style={[styles.headerStack, { top: insets.top + 12 }]} pointerEvents="box-none">
          <Pressable style={styles.headerPill} onPress={onOpenGroups}>
            <Ionicons name="people" size={14} color="#8b8bf5" />
            <Text style={styles.headerGroup} numberOfLines={1}>
              {group.name}
            </Text>
            {liveness.event && (
              <>
                <View style={styles.headerDivider} />
                <Ionicons name="location" size={14} color="#8b8bf5" />
                <Text style={styles.headerGroup} numberOfLines={1}>
                  {liveness.event.name}
                </Text>
              </>
            )}
          </Pressable>

          {/* One pill per landmark geofence the user is standing in. When the
              event is live and it's a stage, the set currently on shows next to
              the stage name. */}
          {insideLandmarks.map((l) => {
            const playing =
              live && l.kind === "stage" ? currentSetForLandmark(sets, l.id, now) : null;
            return (
              <View key={l.id} style={styles.landmarkPill}>
                <Ionicons name={LANDMARK_ICONS[l.kind] ?? "location"} size={13} color="#5eead4" />
                <Text style={styles.landmarkPillText} numberOfLines={1}>
                  {l.name}
                </Text>
                {playing && (
                  <>
                    <View style={styles.headerDivider} />
                    <Text style={styles.landmarkPillArtist} numberOfLines={1}>
                      {playing.artist}
                    </Text>
                  </>
                )}
              </View>
            );
          })}
        </View>
      )}

      {(liveness.status === "none" || liveness.status === "ended") && (
        <View style={styles.overlayWrap} pointerEvents="box-none">
          <View style={styles.overlayCard}>
            {liveness.status === "ended" && liveness.event && (
              <Text style={styles.overlayTitle}>{liveness.event.name} has ended</Text>
            )}
            <Text style={styles.overlayText}>
              Use this page to track your group at your next event — go to My Groups to join your
              friends.
            </Text>
            <Pressable style={styles.groupsButton} onPress={onOpenGroups}>
              <Ionicons name="people" size={16} color="#fff" />
              <Text style={styles.groupsButtonText}>Go to My Groups</Text>
            </Pressable>
          </View>
        </View>
      )}

      {liveness.status === "upcoming" && liveness.event && (
        <View style={styles.overlayWrap} pointerEvents="box-none">
          <View style={styles.overlayCard}>
            <Text style={styles.overlayTitle}>{liveness.event.name} has not started yet</Text>
            <Text style={styles.overlayText}>
              {liveness.event.starts_at
                ? `Check back at ${formatStartsAt(liveness.event.starts_at)} to see where your friends are at.`
                : "Check back once it starts to see where your friends are at."}
            </Text>
          </View>
        </View>
      )}

      {displayedError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>{displayedError}</Text>
        </View>
      )}

      <Pressable style={styles.recenter} onPress={recenter} hitSlop={8}>
        <Text style={styles.recenterIcon}>◎</Text>
      </Pressable>
    </View>
  );
}

function AvatarMarker({
  coordinate,
  uri,
  color,
  label,
}: {
  coordinate: { latitude: number; longitude: number };
  uri: string | null;
  color: string;
  label?: string;
}) {
  // Google Maps (Android) snapshots marker children, so keep re-rendering
  // until the remote image has actually drawn; static content after that.
  const [tracksChanges, setTracksChanges] = useState(uri !== null);

  return (
    <Marker
      coordinate={coordinate}
      anchor={{ x: 0.5, y: label ? 0.3 : 0.5 }}
      tracksViewChanges={tracksChanges}
    >
      <View style={styles.markerWrap}>
        {uri ? (
          <Image
            source={{ uri }}
            style={[styles.markerAvatar, { borderColor: color }]}
            onLoad={() => setTimeout(() => setTracksChanges(false), 150)}
          />
        ) : (
          <View style={[styles.markerAvatar, styles.markerFallback, { borderColor: color }]}>
            <Ionicons name="person" size={18} color={color} />
          </View>
        )}
        {label && (
          <View style={styles.memberLabel}>
            <Text style={styles.memberLabelText} numberOfLines={1}>
              {label}
            </Text>
          </View>
        )}
      </View>
    </Marker>
  );
}

// What a live stage's tap bubble says: a heading ("Now playing" / "Up next" /
// "No sets scheduled") and the artist, or null when there's no set to name.
type StageCallout = { heading: string; artist: string | null };

// An open stage bubble: the stage and its resolved copy, plus the screen-pixel
// anchor (the pin's centre) the overlay is positioned against.
type SelectedStage = { landmark: Landmark; callout: StageCallout; x: number; y: number };

// The bubble copy for a stage at time `now`: who's on, else who's next, else a
// no-schedule note. Module-level so the marker press handler can call it with
// the latest schedule without re-creating the closure.
function stageCalloutFor(sets: EventSet[], landmarkId: string, now: number): StageCallout {
  const current = currentSetForLandmark(sets, landmarkId, now);
  if (current) return { heading: "Now playing", artist: current.artist };
  const next = upcomingSetForLandmark(sets, landmarkId, now);
  if (next) return { heading: "Up next", artist: next.artist };
  return { heading: "No sets scheduled", artist: null };
}

// A small labelled pin for an event landmark. Content is all synchronous
// (icon font + text), so no tracksViewChanges dance like AvatarMarker needs
// for its remote images. zIndex sits below member avatars. Tapping it calls
// `onPress`; the parent decides whether that stage opens a bubble.
function LandmarkMarker({
  landmark,
  onPress,
}: {
  landmark: Landmark;
  onPress: (landmark: Landmark) => void;
}) {
  const icon = LANDMARK_ICONS[landmark.kind] ?? "location";
  // Medical stands out in red; everything else shares the teal landmark accent,
  // distinct from members (orange) and self (indigo).
  const color = landmark.kind === "medical" ? "#ef4444" : "#14b8a6";

  return (
    <Marker
      coordinate={{ latitude: landmark.lat, longitude: landmark.lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={false}
      zIndex={0}
      onPress={() => onPress(landmark)}
    >
      <View style={styles.landmarkWrap}>
        <View style={[styles.landmarkBadge, { backgroundColor: color }]}>
          <Ionicons name={icon} size={15} color="#fff" />
        </View>
        <Text style={styles.landmarkLabel} numberOfLines={1}>
          {landmark.name}
        </Text>
      </View>
    </Marker>
  );
}

// The stage info bubble, drawn as a screen overlay rather than a native Callout.
// It starts invisible, measures itself once, then fades+scales in above the pin
// — so there's no unpositioned flash and no fight with the map's re-renders.
const BUBBLE_GAP = 16; // px between the pin centre and the bubble's bottom edge

function StageBubble({ selection }: { selection: SelectedStage }) {
  const { landmark, callout, x, y } = selection;
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!size) return;
    Animated.timing(anim, {
      toValue: 1,
      duration: 140,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [size, anim]);

  // Anchor bottom-centre of the bubble just above the pin. Until measured it
  // sits at the raw point but stays invisible, so the reposition never shows.
  const left = size ? x - size.width / 2 : x;
  const top = size ? y - size.height - BUBBLE_GAP : y;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        onLayout={(e) => {
          if (!size) {
            const { width, height } = e.nativeEvent.layout;
            setSize({ width, height });
          }
        }}
        style={[
          styles.calloutBubble,
          {
            position: "absolute",
            left,
            top,
            opacity: size ? anim : 0,
            transform: [
              { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
              { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) },
            ],
          },
        ]}
      >
        <Text style={styles.calloutStage} numberOfLines={1}>
          {landmark.name}
        </Text>
        <Text style={styles.calloutHeading}>{callout.heading}</Text>
        {callout.artist && (
          <Text style={styles.calloutArtist} numberOfLines={2}>
            {callout.artist}
          </Text>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  waiting: {
    flex: 1,
    backgroundColor: "#101014",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  waitingTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
  },
  waitingText: {
    fontSize: 16,
    color: "#9a9aa5",
    textAlign: "center",
  },
  overlayWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  overlayCard: {
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(16, 16, 20, 0.92)",
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 18,
    maxWidth: 320,
  },
  overlayTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: "#fff",
    textAlign: "center",
  },
  overlayText: {
    fontSize: 15,
    color: "#c6c6cf",
    textAlign: "center",
  },
  groupsButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#5b5bf0",
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    marginTop: 8,
  },
  groupsButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  markerWrap: {
    alignItems: "center",
  },
  markerAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 3,
    backgroundColor: "#1c1c22",
  },
  markerFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  // Bare map-style label — a light halo keeps it readable over the muted map.
  // Long names wrap (never truncate); the cap just stops one huge line.
  eventLabelText: {
    maxWidth: 220,
    textAlign: "center",
    color: "#5b5bf0",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
    textShadowColor: "rgba(255, 255, 255, 0.9)",
    textShadowRadius: 3,
  },
  landmarkWrap: {
    alignItems: "center",
  },
  landmarkBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "rgba(255, 255, 255, 0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  // Matches the event label's bare map-style treatment — a light halo keeps it
  // legible over the muted map.
  landmarkLabel: {
    maxWidth: 120,
    textAlign: "center",
    color: "#0f766e",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
    textShadowColor: "rgba(255, 255, 255, 0.9)",
    textShadowRadius: 3,
  },
  // Tooltip-style callout (no default OS bubble), matching the app's dark
  // surface palette. Width-bounded so long artist names wrap instead of
  // stretching the map.
  calloutBubble: {
    backgroundColor: "#1c1c22",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2a2a32",
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: 200,
    gap: 2,
  },
  calloutStage: {
    color: "#5eead4",
    fontSize: 12,
    fontWeight: "700",
  },
  calloutHeading: {
    color: "#9a9aa5",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  calloutArtist: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  memberLabel: {
    maxWidth: 110,
    backgroundColor: "rgba(16, 16, 20, 0.85)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 2,
  },
  memberLabelText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
  headerStack: {
    position: "absolute",
    alignSelf: "center",
    alignItems: "center",
    gap: 6,
    maxWidth: "92%",
  },
  headerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(16, 16, 20, 0.85)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: "100%",
  },
  // Teal accent ties it to the landmark pins; sits directly under the group pill.
  landmarkPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(16, 16, 20, 0.85)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    maxWidth: "100%",
  },
  landmarkPillText: {
    color: "#5eead4",
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  // The now-playing artist, brighter than the stage name it sits beside.
  landmarkPillArtist: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  headerDivider: {
    width: 1,
    height: 14,
    backgroundColor: "rgba(255, 255, 255, 0.25)",
  },
  headerGroup: {
    color: "#8b8bf5",
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
  },
  errorBanner: {
    position: "absolute",
    bottom: 100,
    alignSelf: "center",
    maxWidth: "85%",
    backgroundColor: "rgba(127, 29, 29, 0.9)",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  errorBannerText: {
    color: "#fecaca",
    fontSize: 13,
  },
  recenter: {
    position: "absolute",
    bottom: 24,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(16, 16, 20, 0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  recenterIcon: {
    color: "#fff",
    fontSize: 22,
  },
  error: {
    color: "#ff6b6b",
    fontSize: 14,
    textAlign: "center",
  },
});
