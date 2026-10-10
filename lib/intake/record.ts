import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import { database } from "@/db/client";
import { publicDbError } from "@/lib/db-error";
import {
  collectors,
  gatekeeperVerdicts,
  geopoints,
  intakes,
  itemHazards,
  items,
  materialLines,
  wards as wardsTable,
} from "@/db/schema";
import type { AiIntakeResult } from "@/lib/ai/proposal";
import { lineValue } from "@/lib/format";
import { WARDS, WARD_SOURCE, wardForPoint } from "@/lib/geo/wards";
import type { ArchiveOutcome } from "@/lib/s3/archive";
import type { MediaRecordOutcome } from "@/lib/s3/media-assets";

/**
 * Recording a submission: the first time the intake loop writes its own rows.
 *
 * Until this file, a priced submission left behind evidence in S3 and a
 * `media_assets` row, and nothing else — no `intakes` row, so the valuation could not be
 * found from its evidence, and no location, so the hotspot map had nothing real to
 * aggregate. This writes, in one transaction:
 *
 *   intakes → items → material_lines, item_hazards, gatekeeper_verdicts → geopoints
 *
 * The same four rules the archive lives by:
 *
 * 1. **A record, never a gate.** It runs after the analysis has answered. A failure is
 *    reported in `error` and in the response's warnings; it never turns an analysis the
 *    collector is already looking at into an error page.
 * 2. **Idempotent on the evidence.** `intakes_media_uq` makes the evidence row the
 *    identity of an intake, so the same photograph submitted twice is one intake, one
 *    item and one geopoint — a retry cannot double a hotspot's count.
 * 3. **No database is `configured: false`.** The request still answers.
 * 4. **Only evidence-backed submissions are recorded.** `intakes.media_id` is NOT NULL:
 *    a typed note with no photo or voice note has nothing to stand on, and is not
 *    filed as if it did.
 *
 * Location is a measurement, not a requirement. A submission without GPS is still an
 * intake; it simply contributes no point to the map. A fix outside Mumbai is recorded
 * as a geopoint with no ward, because the coordinates are true even when the city is not
 * the pilot's.
 */

export interface CapturedLocation {
  latitude: number;
  longitude: number;
  /** Device-reported horizontal accuracy, metres. */
  accuracyM?: number;
}

export interface RecordIntakeInput {
  result: AiIntakeResult;
  storage: ArchiveOutcome | null;
  records: MediaRecordOutcome | null;
  location?: CapturedLocation;
  /** A `collectors.id` chosen on the intake screen; omitted means the walk-in collector. */
  collectorId?: string;
  note?: string;
}

export interface IntakeRecordOutcome {
  configured: boolean;
  /** True when this call wrote the rows; false when the evidence was already recorded. */
  inserted: boolean;
  intakeId: string | null;
  intakeCode: string | null;
  itemId: string | null;
  location: { wardCode: string | null; wardName: string | null; accuracyM: number | null } | null;
  /** Why nothing was written, when that was a decision rather than a fault. */
  skipped: string | null;
  error: string | null;
}

const WALK_IN_CODE = "C-WALKIN";

function code(prefix: string): string {
  const d = new Date();
  const ymd = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `${prefix}-${ymd}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

const empty = (patch: Partial<IntakeRecordOutcome>): IntakeRecordOutcome => ({
  configured: true,
  inserted: false,
  intakeId: null,
  intakeCode: null,
  itemId: null,
  location: null,
  skipped: null,
  error: null,
  ...patch,
});

type Db = NonNullable<ReturnType<typeof database>>["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

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

/** The collector to file under: the chosen one if it exists, otherwise the walk-in row. */
async function resolveCollector(tx: Tx, collectorId: string | undefined): Promise<string> {
  if (collectorId && /^[0-9a-f-]{36}$/i.test(collectorId)) {
    const [found] = await tx.select({ id: collectors.id }).from(collectors).where(eq(collectors.id, collectorId)).limit(1);
    if (found) return found.id;
  }
  await tx
    .insert(collectors)
    .values({ code: WALK_IN_CODE, fullName: "Walk-in (unregistered collector)", city: "Mumbai", notes: "Created by the intake recorder for submissions made without choosing a collector." })
    .onConflictDoNothing({ target: collectors.code });
  const [walkIn] = await tx.select({ id: collectors.id }).from(collectors).where(eq(collectors.code, WALK_IN_CODE)).limit(1);
  return walkIn.id;
}

export async function recordIntake(input: RecordIntakeInput): Promise<IntakeRecordOutcome> {
  const connection = database();
  if (!connection) return empty({ configured: false });

  const analysis = input.result.analysis;
  if (!analysis) return empty({ skipped: "The model returned no priced item, so there is nothing to file." });

  // The evidence row this intake stands on: the photo when there is one, else the voice note.
  const kindByKey = new Map((input.storage?.objects ?? []).map((object) => [object.key, object.kind]));
  const rows = input.records?.records ?? [];
  const evidence = rows.find((row) => kindByKey.get(row.storageKey) === "photo") ?? rows[0];
  if (!evidence) {
    return empty({
      skipped: input.records?.error
        ? "The evidence was not recorded, so the intake had nothing to attach to."
        : "No photo or voice note was archived, so the submission has no evidence to file it under.",
    });
  }
  const mode = kindByKey.get(evidence.storageKey) === "photo" ? "photo" : "voice";

  const loc = input.location;
  const ward = loc ? wardForPoint(loc.latitude, loc.longitude) : null;

  try {
    const wardIds = ward ? await ensureWards(connection.db) : new Map<string, string>();
    return await connection.db.transaction(async (tx) => {
      // Idempotent on the evidence: an intake already standing on this media is the answer.
      const [existing] = await tx
        .select({ id: intakes.id, code: intakes.code, wardCode: intakes.wardCode })
        .from(intakes)
        .where(eq(intakes.mediaId, evidence.id))
        .limit(1);
      if (existing) {
        const [item] = await tx.select({ id: items.id }).from(items).where(eq(items.intakeId, existing.id)).limit(1);
        return empty({ intakeId: existing.id, intakeCode: existing.code, itemId: item?.id ?? null, skipped: "This evidence was already recorded as an intake; nothing was duplicated." });
      }

      const collectorId = await resolveCollector(tx, input.collectorId);
      const now = new Date();
      const id = analysis.identified;

      const [intake] = await tx
        .insert(intakes)
        .values({
          code: code("IN"),
          collectorId,
          mode,
          mediaId: evidence.id,
          summary: `${id.itemLabel} · ${id.className}`,
          submittedAt: now,
          wardCode: ward?.code ?? null,
          latitude: loc ? String(loc.latitude) : null,
          longitude: loc ? String(loc.longitude) : null,
          extractionModel: input.result.source.model,
          extractionLatencyMs: input.result.source.latencyMs,
          notes: input.note ?? null,
        })
        .returning({ id: intakes.id, code: intakes.code });

      const [item] = await tx
        .insert(items)
        .values({
          code: code("IT"),
          intakeId: intake.id,
          collectorId,
          deviceLabel: id.itemLabel,
          deviceCategory: id.className,
          brand: id.brand || null,
          condition: id.condition,
          massG: String(id.massGrams),
          wardCode: ward?.code ?? null,
          latitude: loc ? String(loc.latitude) : null,
          longitude: loc ? String(loc.longitude) : null,
        })
        .returning({ id: items.id });

      if (analysis.materials.length) {
        await tx.insert(materialLines).values(
          analysis.materials.map((line, ordinal) => ({
            itemId: item.id,
            materialName: line.name,
            symbol: line.symbol,
            category: line.category,
            massG: String(line.massGrams),
            shareOfItemPct: id.massGrams > 0 ? String(Math.min(100, Math.round((10_000 * line.massGrams) / id.massGrams) / 100)) : null,
            ratePaisePerKg: Math.round(line.ratePerKg * 100),
            valuePaise: lineValue(line.massGrams, line.ratePerKg) * 100,
            handlingNote: line.handling,
            hazardous: line.category === "hazardous",
            ordinal,
          })),
        );
      }
      if (id.hazards.length) {
        await tx.insert(itemHazards).values(id.hazards.map((label, ordinal) => ({ itemId: item.id, label, source: "model", ordinal })));
      }
      await tx.insert(gatekeeperVerdicts).values({
        itemId: item.id,
        verdict: analysis.gatekeeper.verdict,
        confidence: String(analysis.gatekeeper.confidence),
        modelVersion: analysis.gatekeeper.modelVersion,
        reason: analysis.gatekeeper.reason ?? null,
        latencyMs: input.result.source.latencyMs,
        checkedAt: now,
      });

      if (loc) {
        await tx.insert(geopoints).values({
          intakeId: intake.id,
          wardId: ward ? wardIds.get(ward.code) ?? null : null,
          latitude: String(loc.latitude),
          longitude: String(loc.longitude),
          accuracyM: loc.accuracyM !== undefined ? Math.round(loc.accuracyM) : null,
          source: "gps",
          recordedAt: now,
        });
      }

      return empty({
        inserted: true,
        intakeId: intake.id,
        intakeCode: intake.code,
        itemId: item.id,
        location: loc ? { wardCode: ward?.code ?? null, wardName: ward?.name ?? null, accuracyM: loc.accuracyM ?? null } : null,
      });
    });
  } catch (error) {
    return empty({ error: publicDbError("intake record", error) });
  }
}

/** One sentence for the response's warnings, or null when there is nothing to say. */
export function intakeRecordWarning(outcome: IntakeRecordOutcome): string | null {
  if (!outcome.configured) return null;
  if (outcome.error) return `The analysis is complete, but the intake was not recorded: ${outcome.error}`;
  if (outcome.inserted && !outcome.location) return "Recorded without a location, so this intake adds no point to the hotspot map.";
  if (outcome.inserted && outcome.location && !outcome.location.wardCode) return "The location is outside the 24 BMC wards of Mumbai; it was recorded but not filed to a ward.";
  return null;
}

/** Collectors for the intake screen's picker, walk-in first. Empty when the database is off. */
export async function listCollectorChoices(limit = 50): Promise<{ id: string; label: string }[]> {
  const connection = database();
  if (!connection) return [];
  try {
    const rows = await connection.db
      .select({ id: collectors.id, code: collectors.code, name: collectors.fullName })
      .from(collectors)
      .orderBy(collectors.fullName)
      .limit(limit);
    return rows
      .sort((a, b) => (a.code === WALK_IN_CODE ? -1 : b.code === WALK_IN_CODE ? 1 : 0))
      .map((row) => ({ id: row.id, label: `${row.name} · ${row.code}` }));
  } catch (error) {
    console.error("[intake] collector list failed:", error instanceof Error ? error.message : error);
    return [];
  }
}
