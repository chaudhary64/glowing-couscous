import { eq } from "drizzle-orm";

import { database } from "@/db/client";
import { geopoints, intakes, items, wards as wardsTable } from "@/db/schema";
import { publicDbError } from "@/lib/db-error";
import { areaBoundary, areaByCode, fileLocation } from "@/lib/geo/areas";
import { DISTRICT_SOURCE } from "@/lib/geo/districts";
import { WARD_SOURCE } from "@/lib/geo/wards";

/**
 * Where a submission was made: the one thing the hotspot map needs that the intake
 * recorders do not already write.
 *
 * `lib/s3/intakes.ts` writes the `intakes` row and `lib/records/items.ts` the item, its
 * material lines, hazards, valuation and gatekeeper verdict. This file runs after both,
 * and only when the handset gave a fix: it files the point to its area — a Mumbai BMC
 * ward, or the district anywhere else in India (`lib/geo/areas.ts`) — stamps that area
 * and the coordinates on the intake and its item, and writes one `geopoints` row: the
 * row `/map` aggregates.
 *
 * The same bargain as the recorders it follows:
 *
 * 1. **A record, never a gate.** A failure is returned in `error` and the response's
 *    warnings; it never turns an analysis the collector is looking at into an error.
 * 2. **Idempotent per intake.** An intake that already has a geopoint keeps it, so a
 *    retried request cannot add a second point to a hotspot's count.
 * 3. **No database is `configured: false`.**
 *
 * A fix outside India is still recorded (the coordinates are true) but filed to no area.
 */

export interface CapturedLocation {
  latitude: number;
  longitude: number;
  /** Device-reported horizontal accuracy, metres. */
  accuracyM?: number;
}

export interface LocationOutcome {
  configured: boolean;
  /** True when this call wrote the geopoint; false when there was nothing to write. */
  recorded: boolean;
  /** The finest area the point was filed to: a BMC ward code, or an `IND-` district. */
  wardCode: string | null;
  /** That area's name, e.g. "L Ward (Kurla)" or "Pune". */
  wardName: string | null;
  areaKind: "ward" | "district" | null;
  /** The district and its state, for every point in India. */
  districtName: string | null;
  stateName: string | null;
  accuracyM: number | null;
  /** Why nothing was written, when that was a decision rather than a fault. */
  skipped: string | null;
  error: string | null;
}

type Db = NonNullable<ReturnType<typeof database>>["db"];

/**
 * The `wards` row for one filing area (a BMC ward or a district), created the first
 * time a point lands in it. Returns its id.
 *
 * Areas are added one at a time rather than all 759 up front: a district row carries
 * its boundary, and most of India's districts will never see a submission in a pilot.
 *
 * Must run on the connection, never inside a transaction: ids are cached for the life
 * of the process, and an id read inside a transaction that later rolls back would be
 * cached as if the row existed — every later geopoint there would fail its foreign key.
 */
export async function ensureArea(db: Db, code: string): Promise<string | null> {
  const cache = globalThis as unknown as { __ecoeprAreaIds?: Map<string, string> };
  cache.__ecoeprAreaIds ??= new Map();
  const known = cache.__ecoeprAreaIds.get(code);
  if (known) return known;

  const area = areaByCode(code);
  if (!area) return null;
  const source = area.kind === "ward" ? WARD_SOURCE : DISTRICT_SOURCE;
  await db
    .insert(wardsTable)
    .values({
      code: area.code,
      name: area.name,
      city: area.region ?? "India",
      centroidLatitude: String(area.centroid.latitude),
      centroidLongitude: String(area.centroid.longitude),
      boundaryGeoJson: { ...areaBoundary(area.code), kind: area.kind, attribution: source.attribution },
    })
    .onConflictDoNothing({ target: wardsTable.code });
  const [row] = await db.select({ id: wardsTable.id }).from(wardsTable).where(eq(wardsTable.code, code)).limit(1);
  if (row) cache.__ecoeprAreaIds.set(code, row.id);
  return row?.id ?? null;
}

const outcome = (patch: Partial<LocationOutcome>): LocationOutcome => ({
  configured: true,
  recorded: false,
  wardCode: null,
  wardName: null,
  areaKind: null,
  districtName: null,
  stateName: null,
  accuracyM: null,
  skipped: null,
  error: null,
  ...patch,
});

export async function recordLocation(input: {
  /** `intakes.id`, from `recordSubmission`. */
  intakeId: string | null | undefined;
  location: CapturedLocation | undefined;
}): Promise<LocationOutcome | null> {
  if (!input.location) return null; // nothing captured: nothing to say
  const connection = database();
  if (!connection) return outcome({ configured: false });
  if (!input.intakeId) {
    return outcome({ skipped: "The submission was not recorded, so its location had nothing to attach to." });
  }

  const { latitude, longitude, accuracyM } = input.location;
  const { area, district } = fileLocation(latitude, longitude);
  const base = {
    wardCode: area?.code ?? null,
    wardName: area?.name ?? null,
    areaKind: area?.kind ?? null,
    districtName: district?.name ?? null,
    stateName: district?.region ?? null,
    accuracyM: accuracyM ?? null,
  };

  try {
    const areaId = area ? await ensureArea(connection.db, area.code) : null;
    return await connection.db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: geopoints.id }).from(geopoints).where(eq(geopoints.intakeId, input.intakeId!)).limit(1);
      if (existing) return outcome({ ...base, skipped: "This submission already has a location; it was not counted twice." });

      const coords = { wardCode: area?.code ?? null, latitude: String(latitude), longitude: String(longitude) };
      await tx.update(intakes).set(coords).where(eq(intakes.id, input.intakeId!));
      await tx.update(items).set(coords).where(eq(items.intakeId, input.intakeId!));
      await tx.insert(geopoints).values({
        intakeId: input.intakeId!,
        wardId: areaId,
        latitude: String(latitude),
        longitude: String(longitude),
        accuracyM: accuracyM !== undefined ? Math.round(accuracyM) : null,
        source: "gps",
      });
      return outcome({ ...base, recorded: true });
    });
  } catch (error) {
    return outcome({ ...base, error: publicDbError("intake location", error) });
  }
}

/** One sentence for the response's warnings, or null when there is nothing to say. */
export function locationWarning(result: LocationOutcome | null): string | null {
  if (!result || !result.configured) return null;
  if (result.error) return `The analysis is complete, but its location was not recorded: ${result.error}`;
  if (result.skipped && !result.recorded && result.skipped.startsWith("The submission was not recorded")) return result.skipped;
  if (result.recorded && !result.wardCode) return "The location is outside India; it was recorded but not filed to any district.";
  return null;
}
