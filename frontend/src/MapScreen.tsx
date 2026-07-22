import { Ionicons } from "@expo/vector-icons";
import { useRef, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polygon } from "react-native-maps";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { avatarSource, avatarUri, type Group, type User } from "./api";
import type { EventLiveness } from "./useEventLiveness";
import { useGroupLocations } from "./useGroupLocations";
import type { LocationReporting } from "./useLocationReporting";

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

  const recenter = () => {
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

      {/* Nothing to show without a group — the centre overlay is what prompts
          joining one. */}
      {group && (
        <Pressable style={[styles.headerPill, { top: insets.top + 12 }]} onPress={onOpenGroups}>
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
  headerPill: {
    position: "absolute",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(16, 16, 20, 0.85)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    maxWidth: "92%",
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
