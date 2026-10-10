/**
 * Geohash, written out rather than imported.
 *
 * The hotspot grid is a geohash grid: a point's cell is the first N characters of its
 * geohash, so "which cell is this pickup in" is a string prefix and "are these two
 * cells neighbours" is arithmetic on the cell's bounds. At precision 7 a cell is about
 * 153 m × 153 m at the equator and about 145 m × 153 m at Mumbai's latitude — the
 * "150 m cell" the hotspot screen has always promised.
 *
 * Forty lines of well-known algorithm is a better trade than a dependency for it, and
 * having it here means the clustering tests exercise the exact code the server runs.
 */

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

/** Precision used for hotspot cells. */
export const CELL_PRECISION = 7;

export interface CellBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export function encodeGeohash(latitude: number, longitude: number, precision = CELL_PRECISION): string {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let hash = "";
  let bits = 0;
  let value = 0;
  let evenBit = true; // longitude first

  while (hash.length < precision) {
    if (evenBit) {
      const mid = (lngMin + lngMax) / 2;
      if (longitude >= mid) {
        value = (value << 1) | 1;
        lngMin = mid;
      } else {
        value <<= 1;
        lngMax = mid;
      }
    } else {
      const mid = (latMin + latMax) / 2;
      if (latitude >= mid) {
        value = (value << 1) | 1;
        latMin = mid;
      } else {
        value <<= 1;
        latMax = mid;
      }
    }
    evenBit = !evenBit;
    if (++bits === 5) {
      hash += BASE32[value];
      bits = 0;
      value = 0;
    }
  }
  return hash;
}

export function geohashBounds(hash: string): CellBounds {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let evenBit = true;

  for (const char of hash) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error(`Invalid geohash character "${char}" in "${hash}"`);
    for (let bit = 4; bit >= 0; bit--) {
      const on = (index >> bit) & 1;
      if (evenBit) {
        const mid = (lngMin + lngMax) / 2;
        if (on) lngMin = mid;
        else lngMax = mid;
      } else {
        const mid = (latMin + latMax) / 2;
        if (on) latMin = mid;
        else latMax = mid;
      }
      evenBit = !evenBit;
    }
  }
  return { south: latMin, west: lngMin, north: latMax, east: lngMax };
}

export function geohashCenter(hash: string): { latitude: number; longitude: number } {
  const b = geohashBounds(hash);
  return { latitude: (b.south + b.north) / 2, longitude: (b.west + b.east) / 2 };
}

/**
 * The eight cells around `hash` at the same precision.
 *
 * Computed from the cell's bounds — step one cell-height or cell-width from the centre
 * and re-encode — which is slower than the classic lookup tables and impossible to get
 * subtly wrong. Pilot volumes are a few thousand cells; speed is not the constraint.
 */
export function geohashNeighbours(hash: string): string[] {
  const b = geohashBounds(hash);
  const height = b.north - b.south;
  const width = b.east - b.west;
  const centerLat = (b.south + b.north) / 2;
  const centerLng = (b.west + b.east) / 2;
  const out: string[] = [];
  for (const dLat of [-1, 0, 1]) {
    for (const dLng of [-1, 0, 1]) {
      if (dLat === 0 && dLng === 0) continue;
      out.push(encodeGeohash(centerLat + dLat * height, centerLng + dLng * width, hash.length));
    }
  }
  return out;
}

/** Great-circle distance in metres. */
export function distanceMetres(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6_371_008.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
