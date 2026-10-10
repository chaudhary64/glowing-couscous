import data from "./data/india-districts.json" with { type: "json" };
import { boundsOf, multiPolygonContains, multiPolygonDistanceKm, type MultiPolygon } from "./polygon";

/**
 * India's 735 districts, with real (simplified) boundaries.
 *
 * Server-side only: the file is ~1.2 MB and must never reach a browser bundle. The map
 * draws the same outlines from `public/geo/india-districts.geojson`, a static file
 * written by the same script (`npm run geo:districts`), so the two cannot disagree.
 *
 * Source: geoBoundaries gbOpen IND ADM2, the Local Government Directory's districts via
 * Pathways Data, ODbL 1.0; state names from geoBoundaries IND ADM1, CC BY 2.5 India.
 * The attribution travels with the data and is shown wherever the outlines are drawn.
 *
 * Codes are `IND-` plus a stable tail of geoBoundaries' shapeID.
 */

export interface DistrictGeo {
  code: string;
  name: string;
  state: string | null;
  areaKm2: number;
  centroid: { latitude: number; longitude: number };
  boundary: MultiPolygon;
}

export const DISTRICT_SOURCE = {
  source: data.source,
  attribution: data.attribution,
  license: data.license,
  country: data.country,
} as const;

export const DISTRICTS: DistrictGeo[] = data.districts as DistrictGeo[];

const BOXES = DISTRICTS.map((district) => ({ district, box: boundsOf(district.boundary) }));
const BY_CODE = new Map(DISTRICTS.map((d) => [d.code, d]));

/** The whole country: the union of district boxes. */
export const INDIA_BOUNDS = (() => {
  const all = BOXES.map((b) => b.box);
  return {
    south: Math.min(...all.map((b) => b.south)),
    west: Math.min(...all.map((b) => b.west)),
    north: Math.max(...all.map((b) => b.north)),
    east: Math.max(...all.map((b) => b.east)),
  };
})();

export function districtByCode(code: string | null | undefined): DistrictGeo | undefined {
  return code ? BY_CODE.get(code) : undefined;
}

/** Degrees of slack on the box prefilter, so near-edge candidates reach the snap. */
const SNAP_PAD_DEG = 0.06;

/**
 * The district a point falls in, by boundary. A fix that lands just outside every
 * simplified outline — a shoreline, a creek, a border river — snaps to the nearest
 * district edge within `snapKm`. Further out (at sea, abroad) it is `null`: recorded,
 * never filed somewhere it did not happen.
 */
export function districtForPoint(latitude: number, longitude: number, snapKm = 5): DistrictGeo | null {
  const near: DistrictGeo[] = [];
  for (const { district, box } of BOXES) {
    if (
      latitude < box.south - SNAP_PAD_DEG ||
      latitude > box.north + SNAP_PAD_DEG ||
      longitude < box.west - SNAP_PAD_DEG ||
      longitude > box.east + SNAP_PAD_DEG
    )
      continue;
    if (multiPolygonContains(district.boundary, latitude, longitude)) return district;
    near.push(district);
  }
  let best: DistrictGeo | null = null;
  let bestKm = snapKm;
  for (const district of near) {
    const km = multiPolygonDistanceKm(district.boundary, latitude, longitude);
    if (km <= bestKm) {
      bestKm = km;
      best = district;
    }
  }
  return best;
}
