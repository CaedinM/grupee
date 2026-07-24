/**
 * Ray-casting point-in-polygon over a boundary of [lat, lng] vertices (the
 * closing edge back to the first point is implied). Treats longitude as x and
 * latitude as y — fine at festival scale, where the flat-earth approximation
 * costs nothing. Shared by both MapScreen variants.
 */
export function pointInPolygon(
  point: { latitude: number; longitude: number },
  polygon: [number, number][]
): boolean {
  const { latitude: y, longitude: x } = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i][0];
    const xi = polygon[i][1];
    const yj = polygon[j][0];
    const xj = polygon[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Landmarks whose geofence contains the given point (empty if point is null). */
export function landmarksContaining<T extends { boundary: [number, number][] | null }>(
  landmarks: T[],
  point: { latitude: number; longitude: number } | null
): T[] {
  if (!point) return [];
  return landmarks.filter(
    (l) => l.boundary && l.boundary.length >= 3 && pointInPolygon(point, l.boundary)
  );
}
