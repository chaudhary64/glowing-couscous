import { and, eq, gt, inArray, isNotNull, like } from "drizzle-orm";

import { database } from "@/db/client";
import { publicDbError } from "@/lib/db-error";
import {
  gatekeeperVerdicts,
  geopoints,
  hotspotClusters,
  hotspotDetections,
  items,
  materialLines,
  wards as wardsTable,
} from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import { CELL_PRECISION, encodeGeohash, geohashCenter } from "@/lib/geo/geohash";
import { areaByCode, fileLocation } from "@/lib/geo/areas";
import { INDIA_BOUNDS, districtByCode } from "@/lib/geo/districts";
import { WARDS } from "@/lib/geo/wards";
import { ensureArea } from "@/lib/intake/location";
import type { MaterialCategory } from "@/lib/types";

import { HOTSPOT_RULE, detectHotspots, wardPressure, withinWindow, type ClusterResult, type DetectionPoint } from "./cluster";

/**
 * The hotspot map's data: real geopoints from the database, and nothing else.
 *
 * There is no sample, no fixture and no fallback. With no geotagged intakes the map is
 * empty and says so — an empty map is true, and a demo map with invented sites would be
 * a false statement about where e-waste is piling up in a real city.
 *
 * Clusters are computed on every read, from the points, by `detectHotspots` — never
 * read back as stored numbers. `hotspot_clusters` holds what a person *decided* about a
 * site (a van was assigned, it was cleared), keyed by the cluster's stable code; that is
 * the only thing on this screen that is not derivable, so it is the only thing stored.
 * `hotspot_detections` is written by a recompute as the audit trail of which items made
 * a site hot. `db/schema/geo.ts` argues the same split.
 *
 * Privacy: points leave the server snapped to their ~38 m geohash cell (precision 8).
 * A geopoint is where a collector stood with their phone; the map needs the street,
 * not the doorway.
 *
 * One kind of site is not computed: a **van call**. A collector standing at a pile taps
 * [Call Van] and the position becomes an open site, stored in `hotspot_clusters` under a
 * `CV-` code so it can never collide with a detected `HS-` site. It is a request, not a
 * detection — it adds no point, no heat and no ward pressure, so nobody can draw a
 * hotspot by tapping a button; it only puts a stop on the van round for an operator to
 * assign or clear like any other site.
 */

export type ClusterStatus = "open" | "van_assigned" | "cleared";

/** Codes of called sites. Detected sites are `HS-` + their lowest geohash cell. */
export const VAN_CALL_PREFIX = "CV-";

/** How large a called site is drawn: the ~150 m cell the call was filed to, as a radius. */
const VAN_CALL_RADIUS_M = 75;

/**
 * Who may call a van to where they stand. The Collector is the seat this exists for — the
 * person at the pile — and the Admin holds every seat. An Operator or Officer dispatches
 * or receives vans rather than calling one, and a Viewer's map is read-only.
 */
export const VAN_CALLERS: readonly Role[] = ["eco-admin", "eco-collector"];

export const mayCallVan = (role: Role | null): boolean => role !== null && VAN_CALLERS.includes(role);

export interface HeatmapFilter {
  category?: MaterialCategory;
  hazardousOnly?: boolean;
}

export interface HeatmapPoint {
  latitude: number;
  longitude: number;
  wardCode: string | null;
  category: MaterialCategory | null;
  /** Days before `generatedAt`; lets the map fade older points without shipping dates. */
  ageDays: number;
}

export interface HeatmapCluster {
  code: string;
  label: string;
  wardCode: string | null;
  wardName: string | null;
  latitude: number;
  longitude: number;
  radiusM: number;
  detections: number;
  topCategory: MaterialCategory | null;
  hazardSharePct: number;
  totalMassKg: number;
  firstSeenAt: string;
  lastSeenAt: string;
  status: ClusterStatus;
  /** Found by the hotspot rule, or called to by someone standing there. */
  origin: "detected" | "called";
}

export interface HeatmapWard {
  code: string;
  name: string;
  areaKm2: number;
  detections: number;
  perKm2: number;
  pressure: number;
  hotspots: number;
}

/** A district's pressure, across India. Only districts with a detection are listed. */
export interface HeatmapDistrict extends HeatmapWard {
  state: string | null;
}

export interface HeatmapData {
  configured: boolean;
  /** Geotagged, gatekeeper-accepted intakes inside the window, before any filter. */
  livePointCount: number;
  generatedAt: string;
  rule: typeof HOTSPOT_RULE;
  points: HeatmapPoint[];
  clusters: HeatmapCluster[];
  /** Mumbai's 24 BMC wards: the city-level view. */
  wards: HeatmapWard[];
  /** India's districts that have at least one detection, busiest first. */
  districts: HeatmapDistrict[];
  /** The box around every shown point; null when there are none. */
  bounds: { south: number; west: number; north: number; east: number } | null;
  /** What the map should open on: the points, or all of India when there are none. */
  frame: { south: number; west: number; north: number; east: number };
  filter: HeatmapFilter;
  error: string | null;
}

const PRIVACY_PRECISION = 8;
/** Points are loaded a little past the window so the map can show what aged out. */
const LOAD_DAYS = 30;

function dominantCategory(lines: { category: MaterialCategory; massG: number }[]): MaterialCategory | null {
  if (!lines.length) return null;
  if (lines.some((l) => l.category === "hazardous")) return "hazardous";
  const totals = new Map<MaterialCategory, number>();
  for (const l of lines) totals.set(l.category, (totals.get(l.category) ?? 0) + l.massG);
  return [...totals].sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Live detection points: geotagged intakes whose item the gatekeeper did not reject.
 * A rejected submission is a plastic bottle or a photo of a photo — it is not e-waste
 * pressure, and counting it would let anyone with a phone draw a hotspot.
 */
export async function loadLivePoints(now: Date): Promise<{ configured: boolean; points: DetectionPoint[]; error: string | null }> {
  const connection = database();
  if (!connection) return { configured: false, points: [], error: null };
  const { db } = connection;
  try {
    const since = new Date(now.getTime() - LOAD_DAYS * 86_400_000);
    const rows = await db
      .select({
        id: geopoints.id,
        latitude: geopoints.latitude,
        longitude: geopoints.longitude,
        recordedAt: geopoints.recordedAt,
        wardCode: wardsTable.code,
        itemId: items.id,
        label: items.deviceLabel,
        massG: items.massG,
      })
      .from(geopoints)
      .leftJoin(wardsTable, eq(wardsTable.id, geopoints.wardId))
      .leftJoin(items, eq(items.intakeId, geopoints.intakeId))
      .where(and(gt(geopoints.recordedAt, since), isNotNull(geopoints.intakeId)));

    const itemIds = rows.map((r) => r.itemId).filter((id): id is string => id !== null);
    const [lines, verdicts] = itemIds.length
      ? await Promise.all([
          db.select({ itemId: materialLines.itemId, category: materialLines.category, massG: materialLines.massG }).from(materialLines).where(inArray(materialLines.itemId, itemIds)),
          db.select({ itemId: gatekeeperVerdicts.itemId, verdict: gatekeeperVerdicts.verdict }).from(gatekeeperVerdicts).where(inArray(gatekeeperVerdicts.itemId, itemIds)),
        ])
      : [[], []];

    const rejected = new Set(verdicts.filter((v) => v.verdict === "rejected").map((v) => v.itemId));
    const linesByItem = new Map<string, { category: MaterialCategory; massG: number }[]>();
    for (const l of lines) {
      const list = linesByItem.get(l.itemId) ?? [];
      list.push({ category: l.category, massG: Number(l.massG) });
      linesByItem.set(l.itemId, list);
    }

    const points: DetectionPoint[] = rows
      .filter((r) => !(r.itemId && rejected.has(r.itemId)))
      .map((r) => {
        const latitude = Number(r.latitude);
        const longitude = Number(r.longitude);
        // The district always comes from the coordinates (it is not stored); the finest
        // area is the stored one, or filed now for a point recorded before it existed.
        const filing = fileLocation(latitude, longitude);
        return {
          id: r.id,
          latitude,
          longitude,
          recordedAt: r.recordedAt,
          wardCode: r.wardCode ?? filing.area?.code ?? null,
          districtCode: filing.district?.code ?? null,
          category: r.itemId ? dominantCategory(linesByItem.get(r.itemId) ?? []) : null,
          massG: r.massG !== null ? Number(r.massG) : null,
          itemId: r.itemId,
          label: r.label,
        };
      });
    return { configured: true, points, error: null };
  } catch (error) {
    return { configured: true, points: [], error: publicDbError("heatmap load", error) };
  }
}

interface StoredDecision {
  status: ClusterStatus;
  clearedAt: Date | null;
}

async function loadStatuses(codes: string[]): Promise<Map<string, StoredDecision>> {
  const connection = database();
  if (!connection || !codes.length) return new Map();
  const rows = await connection.db
    .select({ code: hotspotClusters.code, status: hotspotClusters.status, clearedAt: hotspotClusters.clearedAt })
    .from(hotspotClusters)
    .where(inArray(hotspotClusters.code, codes));
  return new Map(rows.map((r) => [r.code, { status: r.status, clearedAt: r.clearedAt }]));
}

/**
 * The status a site shows. A site an operator cleared stays cleared only while nothing new
 * has landed there: a detection recorded *after* the clearance means the dump came back,
 * and the site reads as open again rather than hiding behind an old decision.
 */
function effectiveStatus(cluster: ClusterResult, decision: StoredDecision | undefined): ClusterStatus {
  if (!decision) return "open";
  if (decision.status === "cleared" && decision.clearedAt && cluster.lastSeenAt > decision.clearedAt) return "open";
  return decision.status;
}

function matchesFilter(p: DetectionPoint, filter: HeatmapFilter): boolean {
  if (filter.hazardousOnly && p.category !== "hazardous") return false;
  if (filter.category && p.category !== filter.category) return false;
  return true;
}

/** Snap to the ~38 m privacy cell, the only precision a location leaves the server at. */
function snap(latitude: number, longitude: number): { latitude: number; longitude: number } {
  const c = geohashCenter(encodeGeohash(latitude, longitude, PRIVACY_PRECISION));
  return { latitude: Math.round(c.latitude * 1e5) / 1e5, longitude: Math.round(c.longitude * 1e5) / 1e5 };
}

function toCluster(c: ClusterResult, status: ClusterStatus): HeatmapCluster {
  const ward = areaByCode(c.wardCode);
  // The centre of four points is close to where people stood; it is snapped like a point.
  const centre = snap(c.center.latitude, c.center.longitude);
  return {
    code: c.code,
    // A real site has no name until a person gives it one; the ward and the cell are
    // what is actually known about it.
    label: `${ward ? ward.name.replace(/ \(.*\)$/, "") : "Outside India"} · cell ${c.cells[0]}`,
    wardCode: c.wardCode,
    wardName: ward?.name ?? null,
    latitude: centre.latitude,
    longitude: centre.longitude,
    radiusM: c.radiusM,
    detections: c.detections.length,
    topCategory: c.topCategory,
    hazardSharePct: Math.round(c.hazardShare * 100),
    totalMassKg: Math.round(c.totalMassG / 100) / 10,
    firstSeenAt: c.firstSeenAt.toISOString(),
    lastSeenAt: c.lastSeenAt.toISOString(),
    status,
    origin: "detected",
  };
}

/**
 * The van calls still in the window, as sites. The position is the centre of the cell the
 * code names, so a call leaves the server at ~150 m precision — coarser than a point.
 */
async function loadVanCalls(now: Date): Promise<HeatmapCluster[]> {
  const connection = database();
  if (!connection) return [];
  const since = new Date(now.getTime() - HOTSPOT_RULE.windowDays * 86_400_000);
  const rows = await connection.db
    .select({
      code: hotspotClusters.code,
      label: hotspotClusters.label,
      status: hotspotClusters.status,
      radiusM: hotspotClusters.radiusM,
      firstSeenAt: hotspotClusters.firstSeenAt,
      lastSeenAt: hotspotClusters.lastSeenAt,
      wardCode: wardsTable.code,
    })
    .from(hotspotClusters)
    .leftJoin(wardsTable, eq(wardsTable.id, hotspotClusters.wardId))
    .where(and(like(hotspotClusters.code, `${VAN_CALL_PREFIX}%`), gt(hotspotClusters.lastSeenAt, since)));
  return rows.map((r) => {
    const centre = geohashCenter(r.code.slice(VAN_CALL_PREFIX.length));
    const calledAt = (r.lastSeenAt ?? now).toISOString();
    return {
      code: r.code,
      label: r.label,
      wardCode: r.wardCode,
      wardName: areaByCode(r.wardCode)?.name ?? null,
      latitude: Math.round(centre.latitude * 1e5) / 1e5,
      longitude: Math.round(centre.longitude * 1e5) / 1e5,
      radiusM: r.radiusM ?? VAN_CALL_RADIUS_M,
      detections: 0,
      topCategory: null,
      hazardSharePct: 0,
      totalMassKg: 0,
      firstSeenAt: (r.firstSeenAt ?? now).toISOString(),
      lastSeenAt: calledAt,
      status: r.status,
      origin: "called",
    } satisfies HeatmapCluster;
  });
}

/**
 * Everything `/map` and `GET /api/heatmap` show. With no database it still answers, with
 * `configured: false`, so the caller can say why the map is empty instead of guessing.
 *
 * Sites are always detected on *every* accepted point. A filter narrows what is shown —
 * the heat, the ward pressure, and which sites are listed (those containing a matching
 * detection) — but never re-clusters. Re-clustering a subset would mint different site
 * codes, so a van assigned in one view would not exist in the other.
 */
export async function getHeatmap(options: { filter?: HeatmapFilter; now?: Date } = {}): Promise<HeatmapData> {
  const now = options.now ?? new Date();
  const filter = options.filter ?? {};
  const live = await loadLivePoints(now);
  const livePointCount = withinWindow(live.points, now).length;

  const inWindowAll = withinWindow(live.points, now);
  const found = detectHotspots(live.points, now);
  const filtered = Boolean(filter.hazardousOnly || filter.category);
  const shownPoints = inWindowAll.filter((p) => matchesFilter(p, filter));
  const shownSites = filtered ? found.filter((c) => c.detections.some((p) => matchesFilter(p, filter))) : found;

  let statuses = new Map<string, StoredDecision>();
  // A call carries no material, so a material filter has nothing to match it on.
  let calls: HeatmapCluster[] = [];
  let error = live.error;
  try {
    [statuses, calls] = await Promise.all([
      loadStatuses(shownSites.map((c) => c.code)),
      filtered ? Promise.resolve([]) : loadVanCalls(now),
    ]);
  } catch (e) {
    error = publicDbError("heatmap statuses", e);
  }

  const clusters = [
    ...shownSites.map((c) => toCluster(c, effectiveStatus(c, statuses.get(c.code)))),
    ...calls,
  ];
  const pressure = wardPressure(shownPoints, shownSites, WARDS);

  // District pressure across India: the same arithmetic, keyed by district, over the
  // districts that have anything in them (735 rows of zeros would say nothing).
  const byDistrict = (p: DetectionPoint) => ({ ...p, wardCode: p.districtCode ?? null });
  const districtPoints = shownPoints.map(byDistrict);
  const districtSites = shownSites.map((c) => {
    const centre = fileLocation(c.center.latitude, c.center.longitude);
    return { ...c, wardCode: centre.district?.code ?? null };
  });
  const touched = [...new Set(districtPoints.map((p) => p.wardCode).filter((code): code is string => code !== null))]
    .map((code) => districtByCode(code))
    .filter((d): d is NonNullable<typeof d> => d !== undefined);
  const districtPressure = wardPressure(districtPoints, districtSites, touched);
  const snappedPoints = shownPoints.map((p) => snap(p.latitude, p.longitude));
  const bounds = snappedPoints.length
    ? {
        south: Math.min(...snappedPoints.map((p) => p.latitude)),
        west: Math.min(...snappedPoints.map((p) => p.longitude)),
        north: Math.max(...snappedPoints.map((p) => p.latitude)),
        east: Math.max(...snappedPoints.map((p) => p.longitude)),
      }
    : null;

  return {
    configured: live.configured,
    livePointCount,
    generatedAt: now.toISOString(),
    rule: HOTSPOT_RULE,
    points: shownPoints.map((p, i) => {
      const snapped = snappedPoints[i];
      return {
        latitude: snapped.latitude,
        longitude: snapped.longitude,
        wardCode: p.wardCode,
        category: p.category,
        ageDays: Math.round(((now.getTime() - p.recordedAt.getTime()) / 86_400_000) * 10) / 10,
      };
    }),
    clusters,
    wards: pressure.map((row) => {
      const ward = areaByCode(row.wardCode)!;
      return { code: row.wardCode, name: ward.name, areaKm2: ward.areaKm2, detections: row.detections, perKm2: row.perKm2, pressure: row.pressure, hotspots: row.hotspots };
    }),
    districts: districtPressure.map((row) => {
      const district = districtByCode(row.wardCode)!;
      return {
        code: row.wardCode,
        name: district.name,
        state: district.state,
        areaKm2: district.areaKm2,
        detections: row.detections,
        perKm2: row.perKm2,
        pressure: row.pressure,
        hotspots: row.hotspots,
      };
    }),
    bounds,
    frame: bounds ?? INDIA_BOUNDS,
    filter,
    error,
  };
}

/**
 * Write the current live clusters and their detections: the audit trail of which items
 * made each site hot, as of now. Status, van assignment and clearance on existing rows
 * are left exactly as people set them.
 */
export async function recomputeClusters(now = new Date()): Promise<{ configured: boolean; clusters: number; detections: number; error: string | null }> {
  const connection = database();
  if (!connection) return { configured: false, clusters: 0, detections: 0, error: null };
  const live = await loadLivePoints(now);
  if (live.error) return { configured: true, clusters: 0, detections: 0, error: live.error };
  const found = detectHotspots(live.points, now);
  try {
    let detections = 0;
    // Area rows are ensured before the transaction (see ensureArea).
    const areaIds = new Map<string, string | null>();
    for (const c of found) if (c.wardCode && !areaIds.has(c.wardCode)) areaIds.set(c.wardCode, await ensureArea(connection.db, c.wardCode));
    await connection.db.transaction(async (tx) => {
      for (const c of found) {
        const wardId = c.wardCode ? areaIds.get(c.wardCode) : undefined;
        if (!wardId) continue; // hotspot_clusters.ward_id is required; an unfiled site waits.
        const [row] = await tx
          .insert(hotspotClusters)
          .values({
            code: c.code,
            wardId,
            label: `${areaByCode(c.wardCode)?.name ?? c.wardCode} · cell ${c.cells[0]}`,
            radiusM: c.radiusM,
            topCategory: c.topCategory,
            firstSeenAt: c.firstSeenAt,
            lastSeenAt: c.lastSeenAt,
          })
          .onConflictDoUpdate({
            target: hotspotClusters.code,
            set: { radiusM: c.radiusM, topCategory: c.topCategory, firstSeenAt: c.firstSeenAt, lastSeenAt: c.lastSeenAt, wardId },
          })
          .returning({ id: hotspotClusters.id });
        await tx.delete(hotspotDetections).where(eq(hotspotDetections.clusterId, row.id));
        if (c.detections.length) {
          await tx.insert(hotspotDetections).values(
            c.detections.map((d) => ({
              clusterId: row.id,
              geopointId: d.id,
              itemId: d.itemId,
              category: d.category,
              massG: d.massG !== null ? String(d.massG) : null,
              confidence: "1.000",
              contributionPct: String(Math.round((10_000 / c.detections.length)) / 100),
              detectedAt: d.recordedAt,
            })),
          ).onConflictDoNothing();
          detections += c.detections.length;
        }
      }
    });
    return { configured: true, clusters: found.length, detections, error: null };
  } catch (error) {
    return { configured: true, clusters: 0, detections: 0, error: publicDbError("heatmap recompute", error) };
  }
}

/**
 * Record a decision about a live site. The cluster must be hot right now — a code that
 * no longer clusters is refused rather than resurrected, so a stale screen cannot
 * dispatch a van to a site the data no longer supports.
 */
export async function setClusterStatus(code: string, status: ClusterStatus, now = new Date()): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const connection = database();
  if (!connection) return { ok: false, status: 503, message: "No database is configured, so there is no site to act on." };

  // A called site is not recomputed from points, so it is acted on where it is stored.
  if (code.startsWith(VAN_CALL_PREFIX)) {
    const updated = await connection.db
      .update(hotspotClusters)
      .set({
        status,
        vanAssignedAt: status === "van_assigned" ? now : status === "open" ? null : undefined,
        clearedAt: status === "cleared" ? now : status === "open" ? null : undefined,
      })
      .where(eq(hotspotClusters.code, code))
      .returning({ id: hotspotClusters.id });
    if (!updated.length) return { ok: false, status: 404, message: "That van call is not on file. Refresh the map." };
    return { ok: true };
  }

  const live = await loadLivePoints(now);
  const cluster = detectHotspots(live.points, now).find((c) => c.code === code);
  if (!cluster) return { ok: false, status: 404, message: "That site is not a hotspot in the current window. Refresh the map." };
  const wardId = cluster.wardCode ? await ensureArea(connection.db, cluster.wardCode) : null;
  if (!wardId) return { ok: false, status: 409, message: "This site is outside India, so there is no district to dispatch from." };

  const stamps = {
    vanAssignedAt: status === "van_assigned" ? now : status === "open" ? null : undefined,
    clearedAt: status === "cleared" ? now : status === "open" ? null : undefined,
  };
  await connection.db
    .insert(hotspotClusters)
    .values({
      code,
      wardId,
      label: `${areaByCode(cluster.wardCode)?.name ?? cluster.wardCode} · cell ${cluster.cells[0]}`,
      radiusM: cluster.radiusM,
      topCategory: cluster.topCategory,
      firstSeenAt: cluster.firstSeenAt,
      lastSeenAt: cluster.lastSeenAt,
      status,
      vanAssignedAt: stamps.vanAssignedAt ?? null,
      clearedAt: stamps.clearedAt ?? null,
    })
    .onConflictDoUpdate({ target: hotspotClusters.code, set: { status, ...stamps } });
  return { ok: true };
}

export type VanCallOutcome =
  | { ok: true; code: string; status: ClusterStatus; areaName: string; repeated: boolean }
  | { ok: false; status: number; message: string };

/**
 * Call a van to a position: the site is the ~150 m cell the position falls in, filed to
 * its ward or district. Calling twice from the same cell is one site, not two — the call
 * is refreshed, and a site that was cleared reopens, because the pile came back. A site a
 * van is already assigned to stays assigned.
 */
export async function callVan(latitude: number, longitude: number, now = new Date()): Promise<VanCallOutcome> {
  const connection = database();
  if (!connection) return { ok: false, status: 503, message: "No database is configured, so the call cannot be recorded." };
  const { area } = fileLocation(latitude, longitude);
  if (!area) {
    return { ok: false, status: 409, message: "This position is outside India's districts, so there is no area to send a van to." };
  }
  const areaName = area.name.replace(/ \(.*\)$/, "");
  try {
    const { db } = connection;
    const wardId = await ensureArea(db, area.code);
    if (!wardId) return { ok: false, status: 409, message: "This area could not be filed, so there is no area to send a van to." };

    const cell = encodeGeohash(latitude, longitude, CELL_PRECISION);
    const code = `${VAN_CALL_PREFIX}${cell}`;
    const created = await db
      .insert(hotspotClusters)
      .values({
        code,
        wardId,
        label: `${areaName} · van called · cell ${cell}`,
        radiusM: VAN_CALL_RADIUS_M,
        status: "open",
        firstSeenAt: now,
        lastSeenAt: now,
        notes: "Called from the hotspot map.",
      })
      .onConflictDoNothing({ target: hotspotClusters.code })
      .returning({ id: hotspotClusters.id });
    if (created.length) return { ok: true, code, status: "open", areaName, repeated: false };

    const [existing] = await db
      .select({ status: hotspotClusters.status })
      .from(hotspotClusters)
      .where(eq(hotspotClusters.code, code))
      .limit(1);
    const reopen = existing?.status === "cleared";
    const status: ClusterStatus = reopen ? "open" : (existing?.status ?? "open");
    await db
      .update(hotspotClusters)
      .set(reopen ? { lastSeenAt: now, status, clearedAt: null, vanAssignedAt: null } : { lastSeenAt: now })
      .where(eq(hotspotClusters.code, code));
    return { ok: true, code, status, areaName, repeated: true };
  } catch (error) {
    return { ok: false, status: 500, message: publicDbError("van call", error) };
  }
}
