import { eq } from "drizzle-orm";

import { database } from "@/db/client";
import { geopoints, intakes, items, wards as wardsTable } from "@/db/schema";
import { publicDbError } from "@/lib/db-error";
import { WARDS, WARD_SOURCE, wardForPoint } from "@/lib/geo/wards";

/**
 * Where a submission was made: the one thing the hotspot map needs that the intake
 * recorders do not already write.
 *
 * `lib/s3/intakes.ts` writes the `intakes` row and `lib/records/items.ts` the item, its
 * material lines, hazards, valuation and gatekeeper verdict. This file runs after both,
 * and only when the handset gave a fix: it files the point to its BMC ward, stamps the
 * ward and coordinates on that intake and its item, and writes one `geopoints` row —
 * the row `/map` aggregates.
 *
 * The same bargain as the recorders it follows:
 *
 * 1. **A record, never a gate.** A failure is returned in `error` and the response's
 *    warnings; it never turns an analysis the collector is looking at into an error.
 * 2. **Idempotent per intake.** An intake that already has a geopoint keeps it, so a
 *    retried request cannot add a second point to a hotspot's count.
 * 3. **No database is `configured: false`.**
 *
 * A fix outside the 24 wards is still recorded — the coordinates are true even when the
 * city is not Mumbai — but it is filed to no ward.
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
  wardCode: string | null;
  wardName: string | null;
  accuracyM: number | null;
  /** Why nothing was written, when that was a decision rather than a fault. */
  skipped: string | null;
  error: string | null;
}

type Db = NonNullable<ReturnType<typeof database>>["db"];

/**
 * Every BMC ward as a `wards` row, created once per process. Returns code → id.
 *
 * Must run on the connection, never inside a transaction: the result is cached for the
 * life of the process, and ids read inside a transaction that later rolls back would be
 * cached as if they existed — every later geopoint would then fail its foreign key.
 */
export async function ensureWards(db: Db): Promise<Map<string, string>> {
  const cache = globalThis as unknown as { __ecoeprWardIds?: Map<string, string> };
  if (cache.__ecoeprWardIds && cache.__ecoeprWardIds.size === WARDS.length) return cache.__ecoeprWardIds;

  await db
    .insert(wardsTable)
    .values(
      WARDS.map((ward) => ({
        code: ward.code,
        name: ward.name,
        city: WARD_SOURCE.city,
        centroidLatitude: String(ward.centroid.latitude),
        centroidLongitude: String(ward.centroid.longitude),
        boundaryGeoJson: { type: "MultiPolygon", coordinates: ward.boundary, attribution: WARD_SOURCE.attribution },
      })),
    )
    .onConflictDoNothing({ target: wardsTable.code });

  const rows = await db.select({ id: wardsTable.id, code: wardsTable.code }).from(wardsTable);
  const map = new Map(rows.map((row) => [row.code, row.id]));
  cache.__ecoeprWardIds = map;
  return map;
}

const outcome = (patch: Partial<LocationOutcome>): LocationOutcome => ({
  configured: true,
  recorded: false,
  wardCode: null,
  wardName: null,
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
  const ward = wardForPoint(latitude, longitude);
  const base = { wardCode: ward?.code ?? null, wardName: ward?.name ?? null, accuracyM: accuracyM ?? null };

  try {
    const wardIds = ward ? await ensureWards(connection.db) : new Map<string, string>();
    return await connection.db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: geopoints.id }).from(geopoints).where(eq(geopoints.intakeId, input.intakeId!)).limit(1);
      if (existing) return outcome({ ...base, skipped: "This submission already has a location; it was not counted twice." });

      const coords = { wardCode: ward?.code ?? null, latitude: String(latitude), longitude: String(longitude) };
      await tx.update(intakes).set(coords).where(eq(intakes.id, input.intakeId!));
      await tx.update(items).set(coords).where(eq(items.intakeId, input.intakeId!));
      await tx.insert(geopoints).values({
        intakeId: input.intakeId!,
        wardId: ward ? wardIds.get(ward.code) ?? null : null,
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
  if (result.recorded && !result.wardCode) return "The location is outside the 24 BMC wards of Mumbai; it was recorded but not filed to a ward.";
  return null;
}
