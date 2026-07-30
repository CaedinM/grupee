"""Point-in-polygon over the [lat, lng] boundaries stored in `events.boundary`
and `landmarks.boundary`.

A deliberate port of `pointInPolygon` in `frontend/src/geo.ts` — the same
ray-casting loop with the same edge behaviour, so the client's "you're at this
stage" pill and the server's attendance credit can never disagree about a
position sitting on a boundary edge.

This is plain Python over JSON columns the row already carries: no spatial
extension, no geometry type, no spatial index or query. "PostGIS/spatial
queries" stays out of scope.
"""

# A boundary needs at least a triangle to enclose anything. Mirrors the
# `boundary.length >= 3` guard in landmarksContaining().
MIN_POLYGON_POINTS = 3


def point_in_polygon(lat: float, lng: float, polygon: list | None) -> bool:
    """True if (lat, lng) falls inside the polygon of [lat, lng] vertices.

    The closing edge back to the first vertex is implied. Longitude is treated
    as x and latitude as y — the flat-earth approximation costs nothing at
    festival scale. Anything degenerate (None, too few points, a malformed
    vertex) is simply "not inside" rather than an error: boundaries are
    admin-authored JSON, and a bad one must not break the location hot path.
    """
    if not polygon or len(polygon) < MIN_POLYGON_POINTS:
        return False
    inside = False
    count = len(polygon)
    j = count - 1
    for i in range(count):
        try:
            yi, xi = float(polygon[i][0]), float(polygon[i][1])
            yj, xj = float(polygon[j][0]), float(polygon[j][1])
        except (TypeError, ValueError, IndexError, KeyError):
            return False
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside
