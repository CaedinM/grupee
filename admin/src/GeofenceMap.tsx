import { latLngBounds } from "leaflet";
import {
  CircleMarker,
  MapContainer,
  Polygon,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { useEffect, useState } from "react";
import "leaflet/dist/leaflet.css";

import type { LatLng } from "./api";

export const MAX_POINTS = 30;
export const MIN_POINTS = 3;

/** Pixel radius around the first point that counts as "clicked it" to close. */
const CLOSE_HIT_PX = 14;

const ACCENT = "#5b5bf0";

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

/** Map click/hover behavior lives in a child component because react-leaflet
 *  only exposes map events through the useMapEvents hook inside the map tree. */
function DrawLayer({
  state,
  onChange,
  onCursor,
}: {
  state: DrawState;
  onChange: (next: DrawState) => void;
  onCursor: (at: LatLng | null) => void;
}) {
  const map = useMapEvents({
    click(e) {
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
      if (!state.closed && state.points.length > 0) onCursor([e.latlng.lat, e.latlng.lng]);
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

export default function GeofenceMap({
  state,
  onChange,
  fitTo,
}: {
  state: DrawState;
  onChange: (next: DrawState) => void;
  fitTo?: LatLng[];
}) {
  const [style, setStyle] = useState<keyof typeof TILES>("dark");
  const [cursor, setCursor] = useState<LatLng | null>(null);
  const { points, closed } = state;
  const closable = !closed && points.length >= MIN_POINTS;

  return (
    <div className="geofence-map">
      <MapContainer center={[34.05, -118.25]} zoom={10} className="map-canvas">
        {/* key remounts the layer on toggle — TileLayer's url isn't reactive */}
        <TileLayer key={style} url={TILES[style].url} attribution={TILES[style].attribution} />
        {fitTo && fitTo.length >= 2 && <FitInitial points={fitTo} />}
        <DrawLayer state={state} onChange={onChange} onCursor={setCursor} />

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
