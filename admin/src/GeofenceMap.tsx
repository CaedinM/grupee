import { divIcon, latLngBounds } from "leaflet";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { useEffect, useState } from "react";
import "leaflet/dist/leaflet.css";

import { landmarkEmoji, type LatLng } from "./api";

export const MAX_POINTS = 200;
export const MIN_POINTS = 3;

/** Pixel radius around the first point that counts as "clicked it" to close. */
const CLOSE_HIT_PX = 14;

const ACCENT = "#5b5bf0";
/** Muted tone for boundaries that are on the map for context but not being edited. */
const MUTED = "#6b7280";

const TILES = {
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics",
  },
} as const;

export interface DrawState {
  points: LatLng[];
  closed: boolean;
}

/** A landmark as shown on the map — the saved ones and the not-yet-saved ones
 *  look identical here. */
export interface MapLandmark {
  key: string;
  kind: string;
  name: string;
  lat: number;
  lng: number;
}

/** Map click/hover behavior lives in a child component because react-leaflet
 *  only exposes map events through the useMapEvents hook inside the map tree. */
function DrawLayer({
  state,
  onChange,
  onCursor,
  onPlaceLandmark,
}: {
  state: DrawState;
  onChange: (next: DrawState) => void;
  onCursor: (at: LatLng | null) => void;
  onPlaceLandmark?: (at: LatLng) => void;
}) {
  const map = useMapEvents({
    click(e) {
      // While placing a landmark the map is a pin-dropper, not a fence editor.
      if (onPlaceLandmark) {
        onPlaceLandmark([e.latlng.lat, e.latlng.lng]);
        return;
      }
      if (state.closed) return;
      const clicked: LatLng = [e.latlng.lat, e.latlng.lng];
      // Clicking the first point (within a small pixel radius, so it works at
      // any zoom) closes the shape rather than dropping a duplicate vertex.
      if (state.points.length >= MIN_POINTS) {
        const first = map.latLngToContainerPoint(state.points[0]);
        if (first.distanceTo(map.latLngToContainerPoint(e.latlng)) <= CLOSE_HIT_PX) {
          onChange({ ...state, closed: true });
          onCursor(null);
          return;
        }
      }
      if (state.points.length >= MAX_POINTS) return;
      onChange({ ...state, points: [...state.points, clicked] });
    },
    mousemove(e) {
      if (!onPlaceLandmark && !state.closed && state.points.length > 0) {
        onCursor([e.latlng.lat, e.latlng.lng]);
      }
    },
    mouseout() {
      onCursor(null);
    },
  });
  return null;
}

/** One-time zoom to an existing geofence when editing, so the shape being
 *  edited is on screen instead of the default city view. */
function FitInitial({ points }: { points: LatLng[] }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(latLngBounds(points), { padding: [48, 48] });
    // run once on mount only — later draw changes must not yank the camera
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Emoji pin. Rendered as a divIcon so there's no image asset to ship, and so
 *  the marker can be styled from index.css. */
function landmarkIcon(kind: string) {
  return divIcon({
    className: "landmark-pin",
    html: `<span>${landmarkEmoji(kind)}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

export default function GeofenceMap({
  state,
  onChange,
  fitTo,
  landmarks,
  placing,
  onPlaceLandmark,
  staticShapes,
}: {
  state: DrawState;
  onChange: (next: DrawState) => void;
  fitTo?: LatLng[];
  landmarks?: MapLandmark[];
  /** True while the next map click should drop a landmark instead of a vertex. */
  placing?: boolean;
  onPlaceLandmark?: (at: LatLng) => void;
  /** Closed boundaries drawn for context only (e.g. the event fence while
   *  editing a landmark's fence, or the landmarks' fences while editing the event). */
  staticShapes?: LatLng[][];
}) {
  const [style, setStyle] = useState<keyof typeof TILES>("dark");
  const [cursor, setCursor] = useState<LatLng | null>(null);
  const { points, closed } = state;
  const closable = !closed && points.length >= MIN_POINTS;

  return (
    <div className={`geofence-map${placing ? " placing" : ""}`}>
      <MapContainer center={[34.05, -118.25]} zoom={10} className="map-canvas">
        {/* key remounts the layer on toggle — TileLayer's url isn't reactive */}
        <TileLayer key={style} url={TILES[style].url} attribution={TILES[style].attribution} />
        {fitTo && fitTo.length >= 2 && <FitInitial points={fitTo} />}
        <DrawLayer
          state={state}
          onChange={onChange}
          onCursor={setCursor}
          onPlaceLandmark={placing ? onPlaceLandmark : undefined}
        />

        {staticShapes?.map((shape, i) => (
          <Polygon
            key={`static-${i}`}
            positions={shape}
            interactive={false}
            pathOptions={{
              color: MUTED,
              weight: 1.5,
              fillColor: MUTED,
              fillOpacity: 0.08,
              dashArray: "4 4",
            }}
          />
        ))}

        {landmarks?.map((landmark) => (
          <Marker
            key={landmark.key}
            position={[landmark.lat, landmark.lng]}
            icon={landmarkIcon(landmark.kind)}
            // markers would otherwise swallow the click that drops the next pin
            interactive={!placing}
          >
            <Tooltip direction="top" offset={[0, -14]}>
              {landmark.name}
            </Tooltip>
          </Marker>
        ))}

        {closed ? (
          <Polygon
            positions={points}
            pathOptions={{ color: ACCENT, weight: 2, fillColor: ACCENT, fillOpacity: 0.18 }}
          />
        ) : (
          <>
            <Polyline positions={points} pathOptions={{ color: ACCENT, weight: 2 }} />
            {cursor && points.length > 0 && (
              // live preview: last placed point to the cursor, dashed
              <Polyline
                positions={[points[points.length - 1], cursor]}
                pathOptions={{ color: ACCENT, weight: 1.5, dashArray: "6 6", opacity: 0.6 }}
              />
            )}
          </>
        )}

        {points.map((point, i) => {
          const isFirst = i === 0;
          return (
            <CircleMarker
              key={i}
              center={point}
              radius={isFirst && closable ? 9 : 5}
              pathOptions={{
                color: isFirst && closable ? "#ffffff" : ACCENT,
                weight: 2,
                fillColor: ACCENT,
                fillOpacity: 1,
              }}
            />
          );
        })}
      </MapContainer>

      <button
        type="button"
        className="ghost map-style-toggle"
        onClick={() => setStyle(style === "dark" ? "satellite" : "dark")}
      >
        {style === "dark" ? "Satellite" : "Map"}
      </button>
    </div>
  );
}
