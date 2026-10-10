/**
 * The little polygon geometry the ward layer needs, without PostGIS.
 *
 * Ward boundaries are GeoJSON MultiPolygons in longitude/latitude (CRS84). The app
 * needs four things from them — is a point inside, how big is the ward, where is its
 * middle, and a lighter copy of the outline for the browser — and each is a short,
 * well-known algorithm. `db/schema/geo.ts` explains why PostGIS is not enabled.
 *
 * Accuracy is planar on purpose: the largest BMC ward spans a few kilometres, where
 * treating degrees as a local flat grid (scaled by cos(latitude)) is off by far less
 * than the accuracy of the GPS fixes being filed into it.
 */

/** [longitude, latitude], as GeoJSON orders it. */
export type Position = [number, number];
export type Ring = Position[];
/** First ring is the outer boundary, the rest are holes. */
export type Polygon = Ring[];
export type MultiPolygon = Polygon[];

function ringContains(ring: Ring, lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function multiPolygonContains(shape: MultiPolygon, latitude: number, longitude: number): boolean {
  for (const polygon of shape) {
    const [outer, ...holes] = polygon;
    if (!outer || !ringContains(outer, longitude, latitude)) continue;
    if (holes.some((hole) => ringContains(hole, longitude, latitude))) continue;
    return true;
  }
  return false;
}

/** Signed shoelace area in degrees², positive for counter-clockwise rings. */
function ringSignedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return sum / 2;
}

const METRES_PER_DEG_LAT = 111_320;

/** Area in square kilometres, planar about the shape's own latitude. */
export function multiPolygonAreaKm2(shape: MultiPolygon): number {
  const lat = boundsOf(shape);
  const midLat = ((lat.south + lat.north) / 2) * (Math.PI / 180);
  const m2PerDeg2 = METRES_PER_DEG_LAT * METRES_PER_DEG_LAT * Math.cos(midLat);
  let deg2 = 0;
  for (const polygon of shape) {
    polygon.forEach((ring, index) => {
      const a = Math.abs(ringSignedArea(ring));
      deg2 += index === 0 ? a : -a;
    });
  }
  return (deg2 * m2PerDeg2) / 1_000_000;
}

/** Area-weighted centroid of the outer rings — good enough to label and to fall back on. */
export function multiPolygonCentroid(shape: MultiPolygon): { latitude: number; longitude: number } {
  let cx = 0;
  let cy = 0;
  let total = 0;
  for (const polygon of shape) {
    const ring = polygon[0];
    if (!ring) continue;
    const a = ringSignedArea(ring);
    if (a === 0) continue;
    let rx = 0;
    let ry = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
      rx += (ring[j][0] + ring[i][0]) * cross;
      ry += (ring[j][1] + ring[i][1]) * cross;
    }
    cx += rx / 6;
    cy += ry / 6;
    total += a;
  }
  return { longitude: cx / total, latitude: cy / total };
}

export function boundsOf(shape: MultiPolygon): { south: number; west: number; north: number; east: number } {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const polygon of shape) {
    for (const ring of polygon) {
      for (const [lng, lat] of ring) {
        if (lat < south) south = lat;
        if (lat > north) north = lat;
        if (lng < west) west = lng;
        if (lng > east) east = lng;
      }
    }
  }
  return { south, west, north, east };
}

/** Squared perpendicular distance from p to segment ab, in degrees². */
function segmentDistanceSq(p: Position, a: Position, b: Position): number {
  let [x, y] = a;
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

/** Douglas–Peucker on one ring, keeping it closed and never below four points. */
export function simplifyRing(ring: Ring, tolerance: number): Ring {
  if (ring.length <= 4) return ring;
  const sqTol = tolerance * tolerance;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack: [number, number][] = [[0, ring.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    let maxSq = 0;
    let index = 0;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistanceSq(ring[i], ring[first], ring[last]);
      if (d > maxSq) {
        maxSq = d;
        index = i;
      }
    }
    if (maxSq > sqTol) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  const out = ring.filter((_, i) => keep[i] === 1);
  return out.length >= 4 ? out : ring;
}
