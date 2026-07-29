import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
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
  type MemberLocation,
  type User,
} from "./api";
import { landmarksContaining } from "./geo";
import {
  LandmarkGlyph,
  PIN_COLORS,
  PIN_TIERS,
  pinColorFor,
  type PinTier,
} from "./map/landmarkPins";
import { useTabBarClearance } from "./TabBar";
import { GlassButton, GlassSurface, PulseDot, Reveal, usePressScale } from "./ui/Glass";
import { color, font, glass, radius, space, type as typeScale } from "./ui/theme";
import { useEventLandmarks } from "./useEventLandmarks";
import { currentSetForLandmark, upcomingSetForLandmark, useEventSets } from "./useEventSets";
import type { EventLiveness } from "./useEventLiveness";
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

// Muted-monochrome 3D look (closest Apple Maps gets to the Mapbox "light"
// style — the real thing needs @rnmapbox/maps and a dev build, see
// shipping.md). Pitch tilts the camera so building volumes render; altitude
// (iOS) / zoom (Android) put it low enough that they actually appear.
const CAMERA_TILT = { pitch: 55, heading: 0, altitude: 700, zoom: 17 };

// Map chrome is the one place glass floats over something bright rather than
// over the Aurora — `mutedStandard` is a pale map. Without a scrim under the
// wash, light text on a blur of it has no contrast.
const MAP_SCRIM = 0.46;

// Horizontal space kept clear on the right of the header row. Apple Maps draws
// its compass in that corner as soon as the map is rotated, and it's a real
// control — the pills bound themselves rather than covering it. Reserving space
// (instead of `mapPadding`) keeps the map's own centring untouched, so
// `recenter`'s animateCamera still lands the user in the middle of the screen.
const COMPASS_CLEARANCE = 64;

// Same idea at the bottom: the recenter button is 46px inset 20px from the
// right, so the where-you-are pill stops short of it instead of sliding under.
const RECENTER_CLEARANCE = 78;

export default function MapScreen({
  user,
  reporting,
  group,
  liveness,
  members,
  membersError,
  onOpenGroups,
}: {
  user: User;
  reporting: LocationReporting;
  group: Group | null;
  liveness: EventLiveness;
  /** Live member positions from the shared location socket (empty off-event). */
  members: MemberLocation[];
  membersError: string | null;
  onOpenGroups: () => void;
}) {
  const { permission, fix, lastAck, error } = reporting;
  const live = liveness.status === "live";
  const mapRef = useRef<MapView>(null);
  const insets = useSafeAreaInsets();
  // The tab bar floats over the map, so the bottom-anchored controls position
  // themselves above it rather than against the screen edge.
  const clearance = useTabBarClearance();

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
        <Reveal style={styles.waitingBlock}>
          <Text style={styles.waitingEyebrow}>
            {permission === "denied" ? "Location off" : "Locating"}
          </Text>
          <Text style={typeScale.hero}>Hey, {user.display_name}</Text>
          <GlassSurface r={radius.lg} style={styles.waitingCard}>
            <View style={styles.waitingBody}>
              {permission !== "denied" && <PulseDot color={color.accentSoft} />}
              <Text style={styles.waitingText}>
                {permission === "asking" && "Requesting location access…"}
                {permission === "granted" && "Waiting for a GPS fix…"}
                {permission === "denied" &&
                  "Location permission denied. Enable it in Settings to share your position."}
              </Text>
            </View>
          </GlassSurface>
          {error && <Text style={styles.error}>{error}</Text>}
        </Reveal>
      </View>
    );
  }

  const displayedError = error ?? membersError;

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

        {landmarks.map((l) => (
          <LandmarkMarker
            key={l.id}
            landmark={l}
            // Only stages can be "playing", and only during a live event. The
            // flag flips at set boundaries, so the marker re-renders rarely.
            playing={live && l.kind === "stage" && currentSetForLandmark(sets, l.id, now) !== null}
            onPress={onSelectStage}
          />
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
          joining one. Event above group, each in its own pill: sharing one pill
          meant two long names competed for the same width and both truncated. */}
      {group && (
        <View style={[styles.headerStack, { top: insets.top + 12 }]} pointerEvents="box-none">
          {liveness.event && <EventPill name={liveness.event.name} />}
          <GroupPill group={group} onPress={onOpenGroups} />
        </View>
      )}

      {(liveness.status === "none" || liveness.status === "ended") && (
        <View style={styles.overlayWrap} pointerEvents="box-none">
          <Reveal style={styles.overlayReveal}>
            <GlassSurface r={radius.xl} intensity={70} scrim={0.55} raised>
              <View style={styles.overlayCard}>
                <View style={styles.overlayIcon}>
                  <Ionicons
                    name={liveness.status === "ended" ? "flag" : "people"}
                    size={22}
                    color={color.accentSoft}
                  />
                </View>
                <Text style={styles.overlayEyebrow}>
                  {liveness.status === "ended" ? "That's a wrap" : "No crew yet"}
                </Text>
                {liveness.status === "ended" && liveness.event && (
                  <Text style={styles.overlayTitle}>{liveness.event.name} has ended</Text>
                )}
                <Text style={styles.overlayText}>
                  Use this page to track your group at your next event — go to My Groups to join
                  your friends.
                </Text>
                <GlassButton
                  label="Go to My Groups"
                  onPress={onOpenGroups}
                  icon={<Ionicons name="people" size={17} color="#fff" />}
                  style={styles.overlayButton}
                />
              </View>
            </GlassSurface>
          </Reveal>
        </View>
      )}

      {liveness.status === "upcoming" && liveness.event && (
        <View style={styles.overlayWrap} pointerEvents="box-none">
          <Reveal style={styles.overlayReveal}>
            <GlassSurface r={radius.xl} intensity={70} scrim={0.55} raised>
              <View style={styles.overlayCard}>
                <View style={styles.overlayIcon}>
                  <Ionicons name="hourglass" size={22} color={color.accentSoft} />
                </View>
                <Text style={styles.overlayEyebrow}>Not started</Text>
                <Text style={styles.overlayTitle}>{liveness.event.name}</Text>
                <Text style={styles.overlayText}>
                  {liveness.event.starts_at
                    ? `Check back at ${formatStartsAt(liveness.event.starts_at)} to see where your friends are at.`
                    : "Check back once it starts to see where your friends are at."}
                </Text>
              </View>
            </GlassSurface>
          </Reveal>
        </View>
      )}

      {/* Where you're standing — one pill per landmark geofence containing you.
          When the event is live and it's a stage, the set currently on shows
          beside the stage name. Anchored bottom-left: it's about your position,
          so it sits near you rather than up with the event's identity. */}
      {insideLandmarks.length > 0 && (
        <View
          style={[styles.locationStack, { bottom: clearance + space.lg }]}
          pointerEvents="box-none"
        >
          {insideLandmarks.map((l) => {
            const playing =
              live && l.kind === "stage" ? currentSetForLandmark(sets, l.id, now) : null;
            return (
              <GlassSurface
                key={l.id}
                r={radius.pill}
                intensity={60}
                scrim={MAP_SCRIM}
                style={styles.pillShell}
              >
                <View style={styles.landmarkPill}>
                  {/* Same glyph source as the pin on the map, so the pill and
                      the thing you're standing in agree. */}
                  <LandmarkGlyph kind={l.kind} size={14} color={color.teal} />
                  <Text style={styles.landmarkPillText} numberOfLines={1}>
                    {l.name}
                  </Text>
                  {playing && (
                    <>
                      <View style={styles.headerDivider} />
                      <PulseDot />
                      <Text style={styles.landmarkPillArtist} numberOfLines={1}>
                        {playing.artist}
                      </Text>
                    </>
                  )}
                </View>
              </GlassSurface>
            );
          })}
        </View>
      )}

      {displayedError && (
        <View style={[styles.errorBanner, { bottom: clearance + 68 }]} pointerEvents="box-none">
          <GlassSurface r={radius.md} intensity={60} scrim={0.5} style={styles.errorShell}>
            <View style={styles.errorBannerBody}>
              <Ionicons name="alert-circle" size={16} color={color.danger} />
              <Text style={styles.errorBannerText}>{displayedError}</Text>
            </View>
          </GlassSurface>
        </View>
      )}

      <RecenterButton onPress={recenter} bottom={clearance + 16} />
    </View>
  );
}

/**
 * The festival you're at. Informational only — the event's own tab is one tap
 * away in the tab bar, so this doesn't need to be a second route to it.
 * Violet marks it as the event; the group pill below is white.
 */
function EventPill({ name }: { name: string }) {
  return (
    <GlassSurface r={radius.pill} intensity={60} scrim={MAP_SCRIM} style={styles.pillShell}>
      <View style={styles.headerPill}>
        <Ionicons name="musical-notes" size={13} color={color.accentSoft} />
        <Text style={styles.headerEvent} numberOfLines={1}>
          {name}
        </Text>
      </View>
    </GlassSurface>
  );
}

/** The crew you're with. Tapping it jumps to the groups tab. */
function GroupPill({ group, onPress }: { group: Group; onPress: () => void }) {
  const { scale, onPressIn, onPressOut } = usePressScale(0.96);
  return (
    <Animated.View style={[{ transform: [{ scale }] }, styles.pillShell]}>
      <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut}>
        <GlassSurface r={radius.pill} intensity={60} scrim={MAP_SCRIM}>
          <View style={styles.headerPill}>
            <Ionicons name="people" size={14} color={color.text} />
            <Text style={styles.headerGroup} numberOfLines={1}>
              {group.name}
            </Text>
          </View>
        </GlassSurface>
      </Pressable>
    </Animated.View>
  );
}

/** Snap-back-to-me. A round glass button, offset clear of the floating tab bar. */
function RecenterButton({ onPress, bottom }: { onPress: () => void; bottom: number }) {
  const { scale, onPressIn, onPressOut } = usePressScale(0.9);
  return (
    <Animated.View style={[styles.recenter, { bottom, transform: [{ scale }] }]}>
      <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} hitSlop={8}>
        <GlassSurface r={radius.pill} intensity={62} scrim={MAP_SCRIM}>
          <View style={styles.recenterInner}>
            <Ionicons name="locate" size={21} color={color.text} />
          </View>
        </GlassSurface>
      </Pressable>
    </Animated.View>
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

/* ------------------------------------------------------------ landmark pins */

// Geometry per tier. These drive both the layout and the marker anchor, so the
// anchor can be derived rather than guessed — see anchorFor below.
const PIN_SIZE: Record<PinTier, number> = { primary: 44, secondary: 32, tertiary: 22 };
const GLYPH_SIZE: Record<PinTier, number> = { primary: 21, secondary: 16, tertiary: 12 };
// The primary pin's tail, which puts a point on the exact coordinate.
const TAIL_H = 7;
// The label block is a fixed height because the label is always single-line
// (see landmarkLabel / numberOfLines={1}) — that is what makes the anchor
// arithmetic below exact.
const LABEL_H = 14 + 2; // lineHeight + marginTop

/**
 * Where on the marker's own box the coordinate sits.
 *
 * The whole point: a marker view is `badge + (tail) + (label)` stacked, and
 * `anchor` is a fraction of that box — so a naive {0.5, 0.5} centres the *label*
 * into the pin and floats the badge above the real spot. Instead:
 *   primary   — the tail's tip is the spot
 *   secondary — the circle's centre is the spot
 *   tertiary  — no label, so the dot is the whole box
 *
 * This is only exact while the label stays one line. If it ever wraps, every
 * pin silently drifts off its coordinate.
 */
function anchorFor(tier: PinTier): { x: number; y: number } {
  if (tier === "tertiary") return { x: 0.5, y: 0.5 };
  const pin = PIN_SIZE[tier] + (tier === "primary" ? TAIL_H : 0);
  const total = pin + LABEL_H;
  return { x: 0.5, y: (tier === "primary" ? pin : PIN_SIZE[tier] / 2) / total };
}

/**
 * A labelled pin for an event landmark, drawn at one of three prominence tiers
 * (see PIN_TIERS) so a headline stage doesn't look like a portaloo. zIndex sits
 * below member avatars. Tapping it calls `onPress`; the parent decides whether
 * that stage opens a bubble.
 *
 * Unlike the old Ionicon version, the glyph is a native `SymbolView` on iOS,
 * which may not have laid out when the marker first captures — hence the same
 * tracksViewChanges warm-up `AvatarMarker` uses for its remote images. It must
 * end up false: left true, a screen of pins tanks the framerate on Android.
 */
function LandmarkMarker({
  landmark,
  playing,
  onPress,
}: {
  landmark: Landmark;
  /** This stage has a set on right now — only ever true for `kind === "stage"`. */
  playing: boolean;
  onPress: (landmark: Landmark) => void;
}) {
  const [tracksChanges, setTracksChanges] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setTracksChanges(false), 200);
    return () => clearTimeout(t);
  }, []);

  const tier = PIN_TIERS[landmark.kind] ?? "secondary";
  const size = PIN_SIZE[tier];
  const tint = pinColorFor(landmark.kind);
  const ringColor = playing ? PIN_COLORS.live : PIN_COLORS.ring;

  // A squircle for the hero pin, a circle for the rest.
  const r = tier === "primary" ? 15 : size / 2;
  // Shadow and clipping have to live on different views — iOS clips a view's
  // own shadow when `overflow: hidden` is set. The outer carries a solid fill
  // so the shadow has a clean path to trace; the gradient covers it.
  const badge = (
    <View
      style={[
        { borderRadius: r, backgroundColor: tier === "primary" ? PIN_COLORS.stage : tint },
        tier !== "tertiary" && styles.pinShadow,
      ]}
    >
      <View
        style={[
          styles.pinBadge,
          {
            width: size,
            height: size,
            borderRadius: r,
            borderColor: ringColor,
            borderWidth: tier === "tertiary" ? 1.5 : 2.5,
          },
        ]}
      >
        {tier === "primary" && (
          <LinearGradient
            colors={playing ? ([PIN_COLORS.live, "#8B5CF6"] as const) : PIN_COLORS.stageGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            // The badge's `overflow: hidden` clips this to the squircle.
            style={StyleSheet.absoluteFill}
          />
        )}
        <LandmarkGlyph kind={landmark.kind} size={GLYPH_SIZE[tier]} color="#fff" />
      </View>
    </View>
  );

  return (
    <Marker
      coordinate={{ latitude: landmark.lat, longitude: landmark.lng }}
      anchor={anchorFor(tier)}
      tracksViewChanges={tracksChanges}
      zIndex={tier === "primary" ? 1 : 0}
      onPress={() => onPress(landmark)}
    >
      <View style={styles.landmarkWrap}>
        <View>
          {/* The halo sits behind the badge, so it grows out from under it. */}
          {playing && <LiveHalo size={size} />}
          {badge}
        </View>
        {tier === "primary" && <View style={[styles.pinTail, { borderTopColor: ringColor }]} />}
        {tier !== "tertiary" && (
          <Text
            style={[styles.landmarkLabel, tier === "primary" && styles.landmarkLabelPrimary]}
            numberOfLines={1}
          >
            {landmark.name}
          </Text>
        )}
      </View>
    </Marker>
  );
}

/**
 * The breathing ring behind a stage that's currently playing — the same shape
 * as the app's PulseDot, reimplemented here so the marker keeps the map palette
 * rather than importing Nightglass tokens.
 *
 * iOS only. Android rasterises marker views, so an animation there would need
 * tracksViewChanges pinned true — which costs far more frames than the halo is
 * worth. Android keeps the static magenta ring the badge already has.
 */
function LiveHalo({ size }: { size: number }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, {
          toValue: 1,
          duration: 1800,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(t, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [t]);

  if (Platform.OS !== "ios") return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.liveHalo,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
          transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 2.1] }) }],
        },
      ]}
    />
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
        {/* The glass is inside the measured/positioned wrapper, so it sizes to
            its content and the anchor maths above is unaffected. */}
        <GlassSurface r={radius.md} intensity={68} scrim={0.55} raised>
          <View style={styles.calloutBody}>
            <Text style={styles.calloutStage} numberOfLines={1}>
              {landmark.name}
            </Text>
            <View style={styles.calloutHeadingRow}>
              {callout.heading === "Now playing" && <PulseDot />}
              <Text style={styles.calloutHeading}>{callout.heading}</Text>
            </View>
            {callout.artist && (
              <Text style={styles.calloutArtist} numberOfLines={2}>
                {callout.artist}
              </Text>
            )}
          </View>
        </GlassSurface>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Transparent, not opaque: the app-wide Aurora is this screen's backdrop
  // until there's a fix to draw a map against.
  waiting: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: space.xl,
  },
  waitingBlock: {
    width: "100%",
    maxWidth: 420,
    gap: space.md,
  },
  waitingEyebrow: {
    ...typeScale.label,
    color: color.accentSoft,
    marginBottom: space.sm,
  },
  waitingCard: {
    marginTop: space.sm,
  },
  waitingBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
  },
  waitingText: {
    flex: 1,
    fontFamily: font.sans,
    fontSize: 15,
    lineHeight: 21,
    color: color.textDim,
  },
  overlayWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: space.xl,
  },
  overlayReveal: {
    width: "100%",
    maxWidth: 340,
  },
  overlayCard: {
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.xl,
    paddingVertical: space.xl,
  },
  overlayIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(167,158,255,0.14)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.stroke,
    marginBottom: space.xs,
  },
  overlayEyebrow: {
    ...typeScale.label,
    color: color.accentSoft,
  },
  overlayTitle: {
    fontFamily: font.display,
    fontSize: 21,
    lineHeight: 25,
    letterSpacing: -0.6,
    color: color.text,
    textAlign: "center",
  },
  overlayText: {
    fontFamily: font.sans,
    fontSize: 14.5,
    lineHeight: 21,
    color: color.textDim,
    textAlign: "center",
  },
  overlayButton: {
    alignSelf: "stretch",
    marginTop: space.md,
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
  landmarkWrap: {
    alignItems: "center",
  },
  // Size, radius, border and fill are all set inline per tier; this holds only
  // what every tier shares. `overflow: hidden` clips the primary's gradient to
  // the squircle.
  pinBadge: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  pinShadow: {
    shadowColor: "#0f2027",
    shadowOpacity: 0.35,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  // A CSS triangle: the point of the primary pin, landing on the coordinate.
  pinTail: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: TAIL_H,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    marginTop: -1,
  },
  liveHalo: {
    position: "absolute",
    backgroundColor: PIN_COLORS.live,
  },
  // Matches the event label's bare map-style treatment — a light halo keeps it
  // legible over the muted map. Single-line by contract: `anchorFor` derives the
  // marker anchor from a fixed label height (LABEL_H), so a wrapping label would
  // push every pin off its coordinate.
  landmarkLabel: {
    maxWidth: 120,
    textAlign: "center",
    color: "#0f766e",
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "700",
    marginTop: 2,
    textShadowColor: PIN_COLORS.halo,
    textShadowRadius: 3,
  },
  landmarkLabelPrimary: {
    maxWidth: 140,
    color: "#4338ca",
    fontSize: 12.5,
    letterSpacing: -0.2,
  },
  // Tooltip-style callout (no default OS bubble), drawn as glass like the rest
  // of the map chrome. Width-bounded so long artist names wrap instead of
  // stretching the map.
  calloutBubble: {
    maxWidth: 210,
  },
  calloutBody: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    gap: 3,
  },
  calloutStage: {
    fontFamily: font.sansSemi,
    color: color.teal,
    fontSize: 12,
  },
  calloutHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  calloutHeading: {
    fontFamily: font.sansSemi,
    color: color.textDim,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: 1.1,
  },
  calloutArtist: {
    fontFamily: font.displayBold,
    color: color.text,
    fontSize: 16,
    letterSpacing: -0.3,
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
  // Hugs the left edge; `right` bounds the row short of the compass rather than
  // letting a long event or group name run under it. Each pill gets this full
  // width to itself, which is the point of having split them.
  headerStack: {
    position: "absolute",
    left: space.lg,
    right: COMPASS_CLEARANCE,
    alignItems: "flex-start",
    gap: space.sm,
  },
  // The where-you-are pill, bottom-left. `bottom` is set inline from the tab
  // bar clearance; `right` keeps it off the recenter button it shares a
  // baseline with.
  locationStack: {
    position: "absolute",
    left: space.lg,
    right: RECENTER_CLEARANCE,
    alignItems: "flex-start",
    gap: space.sm,
  },
  // Caps the pill's width on the wrapper, so the glass clips to the same shape
  // its content settles at.
  pillShell: {
    maxWidth: "100%",
  },
  headerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: 9,
  },
  // Teal accent ties it to the landmark pins; sits directly under the group pill.
  landmarkPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  landmarkPillText: {
    fontFamily: font.sansSemi,
    color: color.teal,
    fontSize: 13,
    flexShrink: 1,
  },
  // The now-playing artist, brighter than the stage name it sits beside.
  landmarkPillArtist: {
    fontFamily: font.sansSemi,
    color: color.text,
    fontSize: 13,
    flexShrink: 1,
  },
  headerDivider: {
    width: StyleSheet.hairlineWidth,
    height: 15,
    backgroundColor: glass.strokeBright,
  },
  // The two header pills are peers now, so they share a size and differ only in
  // colour: violet is the festival, white is your crew.
  headerGroup: {
    fontFamily: font.sansSemi,
    color: color.text,
    fontSize: 13.5,
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  headerEvent: {
    fontFamily: font.sansSemi,
    color: color.accentSoft,
    fontSize: 13.5,
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  // `bottom` for this and the recenter button is set inline from
  // useTabBarClearance — the tab bar floats over the map rather than docking
  // beneath it, so both have to clear its capsule.
  errorBanner: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    paddingHorizontal: space.xl,
  },
  errorShell: {
    maxWidth: "100%",
  },
  errorBannerBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  errorBannerText: {
    fontFamily: font.sansMedium,
    color: color.danger,
    fontSize: 13,
    flexShrink: 1,
  },
  recenter: {
    position: "absolute",
    right: 20,
  },
  recenterInner: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  error: {
    fontFamily: font.sansMedium,
    color: color.danger,
    fontSize: 14,
  },
});
