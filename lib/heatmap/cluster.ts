import {
  CELL_PRECISION,
  distanceMetres,
  encodeGeohash,
  geohashBounds,
  geohashNeighbours,
} from "@/lib/geo/geohash";
import type { MaterialCategory } from "@/lib/types";

/**
 * Hotspot detection: pure, deterministic, and the only place the rule lives.
 *
 * The rule is the one `/map` has always printed: **four or more detections inside one
 * geohash cell (~150 m) in a rolling 21-day window** make that cell hot. Hot cells that
 * touch — including diagonally — are one site, because a dumping ground does not stop
 * at a grid line. Everything else here is reporting on that set: where its middle is,
 * how wide it is, what dominates it, and when it was first and last seen.
 *
 * No database, no clock, no I/O. The caller passes the window's end as `now`, which is
 * what lets the tests pin an exact answer and lets a recompute be re-run and agree.
 */

export const HOTSPOT_RULE = {
  /** Detections a cell needs, inside the window, to count as hot. */
  minDetections: 4,
  windowDays: 21,
  cellPrecision: CELL_PRECISION,
} as const;

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

export function detectHotspots(
  allPoints: DetectionPoint[],
  now: Date,
  rule: { minDetections: number; windowDays: number; cellPrecision: number } = HOTSPOT_RULE,
): ClusterResult[] {
  const points = withinWindow(allPoints, now, rule.windowDays);

  const byCell = new Map<string, DetectionPoint[]>();
  for (const p of points) {
    const cell = encodeGeohash(p.latitude, p.longitude, rule.cellPrecision);
    const list = byCell.get(cell);
    if (list) list.push(p);
    else byCell.set(cell, [p]);
  }

  const hot = new Set([...byCell].filter(([, list]) => list.length >= rule.minDetections).map(([cell]) => cell));

  // Connected components over hot cells, 8-neighbourhood.
  const seen = new Set<string>();
  const clusters: ClusterResult[] = [];
  for (const start of [...hot].sort()) {
    if (seen.has(start)) continue;
    const cells: string[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const cell = queue.shift()!;
      cells.push(cell);
      for (const next of geohashNeighbours(cell)) {
        if (hot.has(next) && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    cells.sort();
    const detections = cells.flatMap((cell) => byCell.get(cell) ?? []);
    clusters.push(summarise(cells, detections));
  }

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
