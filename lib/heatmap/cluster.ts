import {
  CELL_PRECISION,
  distanceMetres,
  encodeGeohash,
  geohashBounds,
} from "@/lib/geo/geohash";
import type { MaterialCategory } from "@/lib/types";

/**
 * Hotspot detection: pure, deterministic, and the only place the rule lives.
 *
 * The rule: **four or more detections within 150 m of each other in a rolling 21-day
 * window** make a site. Precisely (density clustering, DBSCAN): a detection with at least
 * four detections — itself included — within 150 m is a *core*; cores within 150 m of
 * each other are one site, and a detection within 150 m of a core joins that site.
 *
 * Distance, not a grid. The first version counted detections per ~150 m geohash cell, so
 * four pickups twenty metres apart on either side of a cell edge counted as two and two
 * and never made a site — and phone GPS (±10–50 m) put real pickups across edges all the
 * time. The geohash grid is still used, but only as an index to find nearby points fast,
 * and to name a site (`HS-` + its lowest cell) so the code is stable across recomputes.
 *
 * No database, no clock, no I/O. The caller passes the window's end as `now`, which is
 * what lets the tests pin an exact answer and lets a recompute be re-run and agree.
 */

export const HOTSPOT_RULE = {
  /** Detections needed within `radiusM` of a point, itself included, inside the window. */
  minDetections: 4,
  /** How close detections must be to count toward the same site. */
  radiusM: 150,
  windowDays: 21,
  cellPrecision: CELL_PRECISION,
} as const;

type Rule = { minDetections: number; radiusM?: number; windowDays: number; cellPrecision: number };

/**
 * Cells around `cell` within `rings` steps (a (2r+1)² block, the cell itself included).
 * Stepped from the cell's bounds and re-encoded, like `geohashNeighbours`.
 */
function cellBlock(cell: string, rings: number): string[] {
  const b = geohashBounds(cell);
  const height = b.north - b.south;
  const width = b.east - b.west;
  const lat = (b.south + b.north) / 2;
  const lng = (b.west + b.east) / 2;
  const out = new Set<string>();
  for (let i = -rings; i <= rings; i++)
    for (let j = -rings; j <= rings; j++) out.add(encodeGeohash(lat + i * height, lng + j * width, cell.length));
  return [...out];
}

export interface DetectionPoint {
  /** A stable id (geopoint id); used for detection rows and for deduping. */
  id: string;
  latitude: number;
  longitude: number;
  recordedAt: Date;
  /** The finest filing area: a BMC ward code, or an `IND-` district code. */
  wardCode: string | null;
  /** The district, for every point in India (equal to `wardCode` outside city wards). */
  districtCode?: string | null;
  category: MaterialCategory | null;
  massG: number | null;
  /** The item this point is evidence for, when one was recorded. */
  itemId: string | null;
  label: string | null;
}

export interface ClusterResult {
  /** `HS-` + the lowest geohash cell in the site: stable across recomputes. */
  code: string;
  cells: string[];
  detections: DetectionPoint[];
  center: { latitude: number; longitude: number };
  /** Distance from the centre to the furthest detection, plus half a cell. */
  radiusM: number;
  wardCode: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  topCategory: MaterialCategory | null;
  /** Share of detections whose item is hazardous, 0–1. */
  hazardShare: number;
  totalMassG: number;
}

export function withinWindow(points: DetectionPoint[], now: Date, windowDays: number = HOTSPOT_RULE.windowDays): DetectionPoint[] {
  const from = now.getTime() - windowDays * 86_400_000;
  return points.filter((p) => {
    const t = p.recordedAt.getTime();
    return t > from && t <= now.getTime();
  });
}

function mostCommon<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  for (const [v, n] of counts) {
    if (n > bestCount) {
      best = v;
      bestCount = n;
    }
  }
  return best;
}

export function detectHotspots(allPoints: DetectionPoint[], now: Date, rule: Rule = HOTSPOT_RULE): ClusterResult[] {
  const radiusM = rule.radiusM ?? HOTSPOT_RULE.radiusM;
  // Sorted by id so every step below visits points in one fixed order: the same input in
  // any order gives the same sites, codes and memberships.
  const points = withinWindow(allPoints, now, rule.windowDays).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Spatial index: points by cell. A cell's shortest side bounds how many rings of cells
  // a `radiusM` search has to look through (two at precision 7 anywhere in India).
  const cellOf = points.map((p) => encodeGeohash(p.latitude, p.longitude, rule.cellPrecision));
  const byCell = new Map<string, number[]>();
  cellOf.forEach((cell, i) => {
    const list = byCell.get(cell);
    if (list) list.push(i);
    else byCell.set(cell, [i]);
  });
  const ringsFor = new Map<string, number>();
  const rings = (cell: string) => {
    let r = ringsFor.get(cell);
    if (r === undefined) {
      const b = geohashBounds(cell);
      const mid = (b.south + b.north) / 2;
      const side = Math.min(
        distanceMetres({ latitude: b.south, longitude: b.west }, { latitude: b.north, longitude: b.west }),
        distanceMetres({ latitude: mid, longitude: b.west }, { latitude: mid, longitude: b.east }),
      );
      r = Math.max(1, Math.ceil(radiusM / side));
      ringsFor.set(cell, r);
    }
    return r;
  };

  // Every point's neighbours within the radius, itself included.
  const near: number[][] = points.map((p, i) => {
    const out: number[] = [];
    for (const cell of cellBlock(cellOf[i], rings(cellOf[i])))
      for (const j of byCell.get(cell) ?? []) if (distanceMetres(p, points[j]) <= radiusM) out.push(j);
    return out.sort((a, b) => a - b);
  });
  const core = near.map((list) => list.length >= rule.minDetections);

  // Sites: connected components over core points.
  const site = new Array<number>(points.length).fill(-1);
  let sites = 0;
  for (let start = 0; start < points.length; start++) {
    if (!core[start] || site[start] !== -1) continue;
    const id = sites++;
    site[start] = id;
    const queue = [start];
    while (queue.length) {
      const i = queue.shift()!;
      for (const j of near[i]) {
        if (core[j] && site[j] === -1) {
          site[j] = id;
          queue.push(j);
        }
      }
    }
  }

  // Border points join the site of their nearest core (ties: the lower index).
  for (let i = 0; i < points.length; i++) {
    if (core[i]) continue;
    let best = -1;
    let bestDistance = Infinity;
    for (const j of near[i]) {
      if (!core[j]) continue;
      const d = distanceMetres(points[i], points[j]);
      if (d < bestDistance) {
        bestDistance = d;
        best = j;
      }
    }
    if (best !== -1) site[i] = site[best];
  }

  const members = Array.from({ length: sites }, () => [] as number[]);
  site.forEach((id, i) => {
    if (id !== -1) members[id].push(i);
  });

  const clusters = members
    // Border points split between two sites can leave one short; it is not a site then.
    .filter((list) => list.length >= rule.minDetections)
    .map((list) => {
      const cells = [...new Set(list.map((i) => cellOf[i]))].sort();
      return summarise(cells, list.map((i) => points[i]));
    });

  // Busiest first: that is the order a van round should take.
  return clusters.sort((a, b) => b.detections.length - a.detections.length || a.code.localeCompare(b.code));
}

function summarise(cells: string[], detections: DetectionPoint[]): ClusterResult {
  const center = {
    latitude: detections.reduce((s, p) => s + p.latitude, 0) / detections.length,
    longitude: detections.reduce((s, p) => s + p.longitude, 0) / detections.length,
  };
  // Half a cell's diagonal: a detection is somewhere in its cell, not at its centre.
  const b = geohashBounds(cells[0]);
  const halfCell = distanceMetres({ latitude: b.south, longitude: b.west }, { latitude: b.north, longitude: b.east }) / 2;
  const radiusM = Math.round(
    Math.max(...detections.map((p) => distanceMetres(center, p))) + halfCell,
  );
  const times = detections.map((p) => p.recordedAt.getTime());
  const categories = detections.map((p) => p.category).filter((c): c is MaterialCategory => c !== null);
  const hazardous = categories.filter((c) => c === "hazardous").length;
  return {
    code: `HS-${cells[0]}`,
    cells,
    detections,
    center,
    radiusM,
    wardCode: mostCommon(detections.map((p) => p.wardCode).filter((w): w is string => w !== null)),
    firstSeenAt: new Date(Math.min(...times)),
    lastSeenAt: new Date(Math.max(...times)),
    topCategory: mostCommon(categories),
    hazardShare: categories.length ? hazardous / categories.length : 0,
    totalMassG: detections.reduce((s, p) => s + (p.massG ?? 0), 0),
  };
}

export interface WardPressure {
  wardCode: string;
  detections: number;
  perKm2: number;
  /** 0–100, relative to the busiest ward in the same window. Not an absolute scale. */
  pressure: number;
  hotspots: number;
}

/**
 * Ward pressure: detections per km² in the window, scaled so the busiest ward is 100.
 *
 * Relative on purpose. "94/100" on the old fixture read like a measured absolute; it
 * was a typed-in number. A ratio against the busiest ward is computable, honest about
 * what it is, and still answers the only question a ward officer asks of it — where
 * the load is concentrated.
 */
export function wardPressure(
  points: DetectionPoint[],
  clusters: ClusterResult[],
  wards: { code: string; areaKm2: number }[],
): WardPressure[] {
  const counts = new Map<string, number>();
  for (const p of points) if (p.wardCode) counts.set(p.wardCode, (counts.get(p.wardCode) ?? 0) + 1);
  const hotspotCounts = new Map<string, number>();
  for (const c of clusters) if (c.wardCode) hotspotCounts.set(c.wardCode, (hotspotCounts.get(c.wardCode) ?? 0) + 1);

  const rows = wards.map((w) => {
    const detections = counts.get(w.code) ?? 0;
    return { wardCode: w.code, detections, perKm2: w.areaKm2 > 0 ? detections / w.areaKm2 : 0, hotspots: hotspotCounts.get(w.code) ?? 0 };
  });
  const max = Math.max(0, ...rows.map((r) => r.perKm2));
  return rows
    .map((r) => ({ ...r, perKm2: Math.round(r.perKm2 * 10) / 10, pressure: max > 0 ? Math.round((100 * r.perKm2) / max) : 0 }))
    .sort((a, b) => b.pressure - a.pressure || a.wardCode.localeCompare(b.wardCode));
}
