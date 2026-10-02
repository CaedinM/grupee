import { useCallback, useEffect, useRef, useState } from "react";
import type { Feature, FeatureCollection, LineString, Polygon } from "geojson";
import mapboxgl, { type GeoJSONSource, type MapMouseEvent } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { landmarkEmoji, type LatLng } from "./api";

export const MAX_POINTS = 200;
export const MIN_POINTS = 3;

/** Pixel radius around the first point that counts as "clicked it" to close. */
const CLOSE_HIT_PX = 14;
const ACCENT = "#5b5bf0";
const MUTED = "#6b7280";
const MAPBOX_ACCESS_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
const DEFAULT_CENTER: [number, number] = [-118.25, 34.05];

const STYLES = {
  map: "mapbox://styles/mapbox/standard",
  satellite: "mapbox://styles/mapbox/standard-satellite",
} as const;

const SOURCES = {
  staticShapes: "editor-static-shapes",
  boundary: "editor-boundary",
  draft: "editor-draft",
  preview: "editor-preview",
  vertices: "editor-vertices",
} as const;

export interface DrawState {
  points: LatLng[];
  closed: boolean;
}

/** A landmark as shown on the map — saved and not-yet-saved landmarks render alike. */
export interface MapLandmark {
  key: string;
  kind: string;
  name: string;
  lat: number;
  lng: number;
}

type GeoJson = FeatureCollection;

function emptyFeatureCollection(): GeoJson {
  return { type: "FeatureCollection", features: [] };
}

function toMapboxCoordinate([lat, lng]: LatLng): [number, number] {
  return [lng, lat];
}

function lineFeature(points: LatLng[]): Feature<LineString> | null {
  if (points.length < 2) return null;
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: points.map(toMapboxCoordinate) },
  };
}

function polygonFeature(points: LatLng[]): Feature<Polygon> | null {
  if (points.length < MIN_POINTS) return null;
  const ring = points.map(toMapboxCoordinate);
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
  };
}

function setSourceData(map: mapboxgl.Map, id: string, data: GeoJson) {
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
}

function addEditorLayers(map: mapboxgl.Map) {
  for (const id of Object.values(SOURCES)) {
    map.addSource(id, { type: "geojson", data: emptyFeatureCollection() });
  }

  map.addLayer({
    id: "editor-static-fill",
    type: "fill",
    source: SOURCES.staticShapes,
    paint: { "fill-color": MUTED, "fill-opacity": 0.08, "fill-emissive-strength": 1 },
  });
  map.addLayer({
    id: "editor-static-line",
    type: "line",
    source: SOURCES.staticShapes,
    paint: {
      "line-color": MUTED,
      "line-width": 1.5,
      "line-dasharray": [2, 2],
      "line-emissive-strength": 1,
    },
  });
  map.addLayer({
    id: "editor-boundary-fill",
    type: "fill",
    source: SOURCES.boundary,
    paint: { "fill-color": ACCENT, "fill-opacity": 0.18, "fill-emissive-strength": 1 },
  });
  map.addLayer({
    id: "editor-boundary-line",
    type: "line",
    source: SOURCES.boundary,
    paint: { "line-color": ACCENT, "line-width": 2, "line-emissive-strength": 1 },
  });
  map.addLayer({
    id: "editor-draft-line",
    type: "line",
    source: SOURCES.draft,
    paint: { "line-color": ACCENT, "line-width": 2, "line-emissive-strength": 1 },
  });
  map.addLayer({
    id: "editor-preview-line",
    type: "line",
    source: SOURCES.preview,
    paint: {
      "line-color": ACCENT,
      "line-width": 1.5,
      "line-opacity": 0.6,
      "line-dasharray": [2, 2],
      "line-emissive-strength": 1,
    },
  });
  map.addLayer({
    id: "editor-vertices",
    type: "circle",
    source: SOURCES.vertices,
    paint: {
      "circle-radius": ["case", ["get", "closable"], 9, 5],
      "circle-color": ACCENT,
      "circle-stroke-width": 2,
      "circle-stroke-color": ["case", ["get", "closable"], "#ffffff", ACCENT],
      "circle-emissive-strength": 1,
    },
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
  /** Closed boundaries drawn for context only. */
  staticShapes?: LatLng[][];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRefs = useRef<mapboxgl.Marker[]>([]);
  const initialFitRef = useRef(fitTo);
  const latestRef = useRef({
    state,
    onChange,
    placing,
    onPlaceLandmark,
    staticShapes,
    landmarks,
    cursor: null as LatLng | null,
  });
  const [style, setStyle] = useState<keyof typeof STYLES>("map");
  const [cursor, setCursor] = useState<LatLng | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  latestRef.current = { state, onChange, placing, onPlaceLandmark, staticShapes, landmarks, cursor };

  const syncLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const current = latestRef.current;
    const { points, closed } = current.state;
    const staticFeatures = (current.staticShapes ?? [])
      .map(polygonFeature)
      .filter((feature): feature is Feature<Polygon> => feature !== null);
    const boundary = closed ? polygonFeature(points) : null;
    const draft = closed ? null : lineFeature(points);
    const preview = !closed && current.cursor && points.length > 0
      ? lineFeature([points.at(-1)!, current.cursor])
      : null;
    const closable = !closed && points.length >= MIN_POINTS;

    setSourceData(map, SOURCES.staticShapes, { type: "FeatureCollection", features: staticFeatures });
    setSourceData(map, SOURCES.boundary, { type: "FeatureCollection", features: boundary ? [boundary] : [] });
    setSourceData(map, SOURCES.draft, { type: "FeatureCollection", features: draft ? [draft] : [] });
    setSourceData(map, SOURCES.preview, { type: "FeatureCollection", features: preview ? [preview] : [] });
    setSourceData(map, SOURCES.vertices, {
      type: "FeatureCollection",
      features: points.map((point, index) => ({
        type: "Feature",
        properties: { closable: index === 0 && closable },
        geometry: { type: "Point", coordinates: toMapboxCoordinate(point) },
      })),
    });
  }, []);

  const syncLandmarks = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    markerRefs.current.forEach((marker) => marker.remove());
    const current = latestRef.current;
    markerRefs.current = (current.landmarks ?? []).map((landmark) => {
      const element = document.createElement("div");
      element.className = "landmark-pin";
      element.title = landmark.name;
      element.setAttribute("aria-label", landmark.name);
      element.textContent = landmarkEmoji(landmark.kind);
      if (current.placing) element.classList.add("noninteractive");
      return new mapboxgl.Marker({ element, anchor: "center" })
        .setLngLat([landmark.lng, landmark.lat])
        .addTo(map);
    });
  }, []);

  useEffect(() => {
    if (!MAPBOX_ACCESS_TOKEN || !containerRef.current) return;
    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: STYLES.map,
      center: DEFAULT_CENTER,
      zoom: 10,
      attributionControl: true,
    });
    mapRef.current = map;

    const updateAfterStyleLoad = () => {
      try {
        map.setConfigProperty("basemap", "lightPreset", "night");
      } catch {
        // The map can still render if a future style no longer accepts this setting.
      }
      addEditorLayers(map);
      syncLayers();
      syncLandmarks();

      const initialFit = initialFitRef.current;
      if (initialFit && initialFit.length >= 2) {
        const bounds = new mapboxgl.LngLatBounds(
          toMapboxCoordinate(initialFit[0]),
          toMapboxCoordinate(initialFit[0])
        );
        initialFit.slice(1).forEach((point) => bounds.extend(toMapboxCoordinate(point)));
        map.fitBounds(bounds, { padding: 48 });
        initialFitRef.current = undefined;
      }
    };
    const onClick = (event: MapMouseEvent) => {
      const current = latestRef.current;
      const clicked: LatLng = [event.lngLat.lat, event.lngLat.lng];
      if (current.placing && current.onPlaceLandmark) {
        current.onPlaceLandmark(clicked);
        return;
      }
      if (current.state.closed) return;
      if (current.state.points.length >= MIN_POINTS) {
        const first = map.project(toMapboxCoordinate(current.state.points[0]));
        if (Math.hypot(first.x - event.point.x, first.y - event.point.y) <= CLOSE_HIT_PX) {
          current.onChange({ ...current.state, closed: true });
          setCursor(null);
          return;
        }
      }
      if (current.state.points.length < MAX_POINTS) {
        current.onChange({ ...current.state, points: [...current.state.points, clicked] });
      }
    };
    const onMouseMove = (event: MapMouseEvent) => {
      const current = latestRef.current;
      if (!current.placing && !current.state.closed && current.state.points.length > 0) {
        setCursor([event.lngLat.lat, event.lngLat.lng]);
      }
    };
    const onMouseOut = () => setCursor(null);
    map.on("style.load", updateAfterStyleLoad);
    map.on("click", onClick);
    map.on("mousemove", onMouseMove);
    map.on("mouseout", onMouseOut);
    map.on("error", () => {
      if (!map.loaded()) {
        setMapError("Mapbox could not load. Check VITE_MAPBOX_ACCESS_TOKEN and your network connection.");
      }
    });

    return () => {
      markerRefs.current.forEach((marker) => marker.remove());
      markerRefs.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, [syncLandmarks, syncLayers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = placing ? "copy" : "crosshair";
    syncLandmarks();
  }, [landmarks, placing, syncLandmarks]);

  useEffect(() => {
    syncLayers();
  }, [state, cursor, staticShapes, syncLayers]);

  const toggleStyle = () => {
    const nextStyle = style === "map" ? "satellite" : "map";
    setStyle(nextStyle);
    mapRef.current?.setStyle(STYLES[nextStyle]);
  };

  if (!MAPBOX_ACCESS_TOKEN) {
    return (
      <div className="geofence-map map-message">
        Mapbox needs <code>VITE_MAPBOX_ACCESS_TOKEN</code> in <code>admin/.env</code>.
      </div>
    );
  }

  return (
    <div className={`geofence-map${placing ? " placing" : ""}`}>
      <div ref={containerRef} className="map-canvas" />
      {mapError && <p className="map-error">{mapError}</p>}
      <button type="button" className="ghost map-style-toggle" onClick={toggleStyle}>
        {style === "map" ? "Satellite" : "Map"}
      </button>
    </div>
  );
}
