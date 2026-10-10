/**
 * Heatmap integration tests — the real modules against a real, migrated Postgres.
 *
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres npm run test:heatmap:db
 *
 * The database must be a disposable one with `npm run db:migrate` applied (the same 39
 * tables, enums, foreign keys and unique indexes as RDS). The suite **refuses to run
 * against any host but localhost**, so it cannot write test rows into a shared database.
 *
 * Every row written here is test data in a throwaway database, which is the point: the
 * intake recorder, the ward filing, the clustering read, dispatch and recompute run
 * exactly as they do in production, against the real schema's constraints.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";

const url = process.env.TEST_DATABASE_URL ?? "";
const host = (() => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
})();
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  console.error("Refusing to run: TEST_DATABASE_URL must point at a local, disposable database.");
  process.exit(1);
}
process.env.DATABASE_URL = url;

const { closeDatabase, database } = await import("@/db/client");
const schema = await import("@/db/schema");
const { recordIntake, ensureWards, listCollectorChoices } = await import("@/lib/intake/record");
const { recordArchivedObjects } = await import("@/lib/s3/media-assets");
const { getHeatmap, setClusterStatus, recomputeClusters } = await import("@/lib/heatmap/store");
const { canOpen } = await import("@/lib/auth/roles");
const { distanceMetres } = await import("@/lib/geo/geohash");
const { eq, sql } = await import("drizzle-orm");

import type { AiIntakeResult } from "@/lib/ai/proposal";
import type { ArchiveOutcome, ArchivedObject } from "@/lib/s3/archive";

let db = database()!.db;
let mediaCounter = 0;

/** A test evidence object, recorded with the archive's own function. */
async function evidence(kind: "photo" | "voice" = "photo") {
  const checksum = createHash("sha256").update(`test-evidence-${++mediaCounter}-${Date.now()}`).digest("hex");
  const object: ArchivedObject = {
    kind,
    bucket: "test-bucket",
    key: `media/${checksum.slice(0, 2)}/${checksum}.${kind === "photo" ? "jpg" : "wav"}`,
    mimeType: kind === "photo" ? "image/jpeg" : "audio/wav",
    byteSize: 1024,
    checksumSha256: checksum,
  };
  const records = await recordArchivedObjects([object]);
  assert.equal(records.error, null, `media record failed: ${records.error}`);
  const storage = { configured: true, bucket: "test-bucket", objects: [object], error: null } as unknown as ArchiveOutcome;
  return { storage, records };
}

/** An analysed item shaped exactly as `analyseIntake` returns it. */
function analysed(opts: { verdict?: "verified" | "rejected" | "review"; hazardous?: boolean; condition?: string } = {}): AiIntakeResult {
  const hazardous = opts.hazardous ?? false;
  return {
    fields: [],
    voiceNote: null,
    warnings: [],
    source: { provider: "foundry", model: "test-model", latencyMs: 1234, calledAt: new Date().toISOString(), inputs: ["photo"] },
    analysis: {
      id: "test",
      identified: {
        itemClass: "pcb",
        className: hazardous ? "Battery pack" : "Laptop mainboard",
        cpcb: "ITEW1",
        itemLabel: hazardous ? "Li-ion battery pack" : "Laptop motherboard",
        brand: "TestBrand",
        condition: opts.condition ?? "dead",
        unitCount: 1,
        stateCode: "MH",
        hazards: hazardous ? ["Lithium cell — fire risk"] : [],
        massGrams: 400,
        hazardous,
      },
      materials: hazardous
        ? [{ id: "li", name: "Lithium cells", symbol: "Li", category: "hazardous", massGrams: 300, ratePerKg: 0, handling: "Authorised recycler only" }]
        : [
            { id: "cu", name: "Copper traces", symbol: "Cu", category: "base", massGrams: 60, ratePerKg: 540, handling: "Smelter recovered" },
            { id: "au", name: "Gold plating", symbol: "Au", category: "precious", massGrams: 0.2, ratePerKg: 5_000_000, handling: "Refined" },
          ],
      valuation: {},
      gatekeeper: { verdict: opts.verdict ?? "verified", confidence: 0.93, modelVersion: "test-gk-1", reason: "Test reason." },
      summary: {},
      matchedFixtureId: null,
      source: { provider: "foundry", model: "test-model", latencyMs: 1234, calledAt: new Date().toISOString(), inputs: ["photo"] },
      warnings: [],
    },
  } as unknown as AiIntakeResult;
}

const KURLA = { latitude: 19.0728, longitude: 72.8834 };

/**
 * Drop every pooled connection and open fresh ones.
 *
 * Needed only for PGlite's socket server, which this suite usually runs against: after a
 * failed parameterised query it sends one stray `parseComplete`, and the next query on
 * that connection reads empty rows. Reproduced with the bare `pg` driver and no app code,
 * so it is a test-server bug, not an app one; real Postgres does not need this.
 */
async function freshConnections() {
  await closeDatabase();
  db = database()!.db;
}
async function rows(table: string): Promise<number> {
  const result = await db.execute(sql.raw(`select count(*)::int as n from ${table}`));
  return Number((result.rows[0] as { n: number }).n);
}

before(async () => {
  // A clean slate in the throwaway database.
  await db.execute(sql.raw(
    "truncate hotspot_detections, hotspot_clusters, geopoints, gatekeeper_verdicts, item_hazards, material_lines, items, intakes, media_assets, collectors, wards cascade",
  ));
  (globalThis as { __ecoeprWardIds?: unknown }).__ecoeprWardIds = undefined;
});

after(async () => {
  await closeDatabase();
});

describe("wards", () => {
  it("creates all 24 BMC wards once, idempotently", async () => {
    const first = await ensureWards(db);
    assert.equal(first.size, 24);
    (globalThis as { __ecoeprWardIds?: unknown }).__ecoeprWardIds = undefined; // force a second insert attempt
    const second = await ensureWards(db);
    assert.equal(await rows("wards"), 24);
    assert.deepEqual([...second].sort(), [...first].sort());
    const [l] = await db.select().from(schema.wards).where(eq(schema.wards.code, "MCGM-L"));
    assert.equal(l.name, "L Ward (Kurla)");
    assert.equal((l.boundaryGeoJson as { type: string }).type, "MultiPolygon");
  });
});

describe("recording an intake", () => {
  it("writes intake, item, material lines, verdict and a geopoint filed to the right ward", async () => {
    const ev = await evidence();
    const out = await recordIntake({ result: analysed(), ...ev, location: { ...KURLA, accuracyM: 12 }, note: "test note" });
    assert.equal(out.error, null);
    assert.equal(out.inserted, true);
    assert.equal(out.location?.wardCode, "MCGM-L");
    assert.match(out.intakeCode ?? "", /^IN-\d{8}-[0-9A-F]{6}$/);

    const [intake] = await db.select().from(schema.intakes).where(eq(schema.intakes.id, out.intakeId!));
    assert.equal(intake.mode, "photo");
    assert.equal(intake.wardCode, "MCGM-L");
    assert.equal(Number(intake.latitude), KURLA.latitude);
    assert.equal(intake.extractionModel, "test-model");
    const [item] = await db.select().from(schema.items).where(eq(schema.items.intakeId, intake.id));
    assert.equal(item.deviceLabel, "Laptop motherboard");
    assert.equal(Number(item.massG), 400);
    const lines = await db.select().from(schema.materialLines).where(eq(schema.materialLines.itemId, item.id));
    assert.equal(lines.length, 2);
    const cu = lines.find((l) => l.symbol === "Cu")!;
    assert.equal(cu.ratePaisePerKg, 54_000); // ₹540/kg in paise
    assert.equal(cu.valuePaise, Math.round((60 / 1000) * 540) * 100);
    const [verdict] = await db.select().from(schema.gatekeeperVerdicts).where(eq(schema.gatekeeperVerdicts.itemId, item.id));
    assert.equal(verdict.verdict, "verified");
    const [point] = await db.select().from(schema.geopoints).where(eq(schema.geopoints.intakeId, intake.id));
    assert.equal(point.accuracyM, 12);
    assert.equal(point.source, "gps");
    const [ward] = await db.select().from(schema.wards).where(eq(schema.wards.id, point.wardId!));
    assert.equal(ward.code, "MCGM-L");
  });

  it("files a submission with no collector chosen under one walk-in collector", async () => {
    const all = await db.select().from(schema.collectors);
    assert.equal(all.length, 1);
    assert.equal(all[0].code, "C-WALKIN");
    const choices = await listCollectorChoices();
    assert.equal(choices[0].id, all[0].id);
  });

  it("honours a chosen collector, and ignores one that does not exist", async () => {
    const [sunita] = await db.insert(schema.collectors).values({ code: "C-TEST-1", fullName: "Test Collector" }).returning();
    const chosen = await recordIntake({ result: analysed(), ...(await evidence()), location: KURLA, collectorId: sunita.id });
    const [a] = await db.select().from(schema.intakes).where(eq(schema.intakes.id, chosen.intakeId!));
    assert.equal(a.collectorId, sunita.id);
    const bogus = await recordIntake({ result: analysed(), ...(await evidence()), location: KURLA, collectorId: "00000000-0000-4000-8000-000000000000" });
    const [b] = await db.select().from(schema.intakes).where(eq(schema.intakes.id, bogus.intakeId!));
    const [walkIn] = await db.select().from(schema.collectors).where(eq(schema.collectors.code, "C-WALKIN"));
    assert.equal(b.collectorId, walkIn.id);
  });

  it("is idempotent on the evidence: the same photo twice is one intake and one point", async () => {
    const ev = await evidence();
    const first = await recordIntake({ result: analysed(), ...ev, location: KURLA });
    const before = [await rows("intakes"), await rows("items"), await rows("geopoints")];
    const again = await recordIntake({ result: analysed(), ...ev, location: KURLA });
    assert.equal(again.inserted, false);
    assert.equal(again.intakeId, first.intakeId);
    assert.deepEqual([await rows("intakes"), await rows("items"), await rows("geopoints")], before);
  });

  it("records an intake with no location but adds no point", async () => {
    const before = await rows("geopoints");
    const out = await recordIntake({ result: analysed(), ...(await evidence()) });
    assert.equal(out.inserted, true);
    assert.equal(out.location, null);
    assert.equal(await rows("geopoints"), before);
  });

  it("records a fix outside Mumbai without filing it to a ward", async () => {
    const out = await recordIntake({ result: analysed(), ...(await evidence()), location: { latitude: 18.5204, longitude: 73.8567 } });
    assert.equal(out.location?.wardCode, null);
    const [point] = await db.select().from(schema.geopoints).where(eq(schema.geopoints.intakeId, out.intakeId!));
    assert.equal(point.wardId, null);
  });

  it("skips a submission with no evidence instead of inventing one", async () => {
    const before = await rows("intakes");
    const out = await recordIntake({ result: analysed(), storage: null, records: null, location: KURLA });
    assert.equal(out.inserted, false);
    assert.match(out.skipped ?? "", /No photo or voice note/);
    assert.equal(await rows("intakes"), before);
  });

});

describe("the heatmap read", () => {
  it("turns four or more nearby real intakes into one site, in the right ward", async () => {
    const data = await getHeatmap();
    assert.equal(data.configured, true);
    // Kurla intakes recorded above with a location: first, chosen, bogus, idempotent = 4
    assert.equal(data.livePointCount, 4 + 1 /* the Pune point is a real detection, just unfiled */);
    assert.equal(data.clusters.length, 1);
    const site = data.clusters[0];
    assert.equal(site.wardCode, "MCGM-L");
    assert.equal(site.detections, 4);
    assert.equal(site.status, "open");
    assert.equal(data.wards[0].code, "MCGM-L");
    assert.equal(data.wards[0].pressure, 100);
  });

  it("never sends a raw coordinate: points and site centres are snapped to ~38 m", async () => {
    const data = await getHeatmap();
    for (const p of data.points.filter((pt) => pt.wardCode === "MCGM-L")) {
      assert.notDeepEqual([p.latitude, p.longitude], [KURLA.latitude, KURLA.longitude]);
      assert.ok(distanceMetres(p, KURLA) < 30, "snapped point is near the real one");
    }
    const site = data.clusters[0];
    assert.notDeepEqual([site.latitude, site.longitude], [KURLA.latitude, KURLA.longitude]);
  });

  it("does not count items the gatekeeper rejected", async () => {
    const before = (await getHeatmap()).livePointCount;
    await recordIntake({ result: analysed({ verdict: "rejected" }), ...(await evidence()), location: KURLA });
    assert.equal((await getHeatmap()).livePointCount, before);
  });

  it("keeps the same site code under the hazardous filter, and hides sites with no hazardous item", async () => {
    const all = await getHeatmap();
    assert.equal((await getHeatmap({ filter: { hazardousOnly: true } })).clusters.length, 0);
    await recordIntake({ result: analysed({ hazardous: true }), ...(await evidence()), location: KURLA });
    const hazardous = await getHeatmap({ filter: { hazardousOnly: true } });
    assert.equal(hazardous.clusters.length, 1);
    assert.equal(hazardous.clusters[0].code, all.clusters[0].code);
    assert.ok(hazardous.points.every((p) => p.category === "hazardous"));
  });
});

describe("dispatch", () => {
  it("assigns a van, clears, and reopens a site, storing only the decision", async () => {
    const code = (await getHeatmap()).clusters[0].code;
    assert.deepEqual(await setClusterStatus(code, "van_assigned"), { ok: true });
    assert.equal((await getHeatmap()).clusters[0].status, "van_assigned");
    const [row] = await db.select().from(schema.hotspotClusters).where(eq(schema.hotspotClusters.code, code));
    assert.ok(row.vanAssignedAt);

    await setClusterStatus(code, "cleared");
    assert.equal((await getHeatmap()).clusters[0].status, "cleared");

    await setClusterStatus(code, "open");
    const [reopened] = await db.select().from(schema.hotspotClusters).where(eq(schema.hotspotClusters.code, code));
    assert.equal(reopened.status, "open");
    assert.equal(reopened.vanAssignedAt, null);
    assert.equal(reopened.clearedAt, null);
    assert.equal(await rows("hotspot_clusters"), 1);
  });

  it("reopens a cleared site by itself when a new detection lands after the clearance", async () => {
    const code = (await getHeatmap()).clusters[0].code;
    await setClusterStatus(code, "cleared");
    assert.equal((await getHeatmap()).clusters[0].status, "cleared");
    await new Promise((r) => setTimeout(r, 20));
    await recordIntake({ result: analysed(), ...(await evidence()), location: KURLA });
    assert.equal((await getHeatmap()).clusters[0].status, "open");
  });

  it("refuses a code that is not a site in the current window", async () => {
    const result = await setClusterStatus("HS-te7uzzz", "van_assigned");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.status, 404);
  });

  it("recompute writes one detection row per item, and re-running does not duplicate them", async () => {
    const site = (await getHeatmap()).clusters[0];
    const first = await recomputeClusters();
    assert.equal(first.error, null);
    assert.equal(first.clusters, 1);
    assert.equal(first.detections, site.detections);
    assert.equal(await rows("hotspot_detections"), site.detections);
    await recomputeClusters();
    assert.equal(await rows("hotspot_detections"), site.detections);
  });
});

describe("access", () => {
  it("lets every role view the map, but only operator and above dispatch", () => {
    for (const role of ["eco-owner", "eco-admin", "eco-officer", "eco-operator", "eco-viewer"] as const) {
      assert.equal(canOpen("/map", role).ok, true, `${role} should view /map`);
    }
    for (const role of ["eco-owner", "eco-admin", "eco-officer", "eco-operator"] as const) {
      assert.equal(canOpen("/map/dispatch", role).ok, true, `${role} should dispatch`);
    }
    assert.equal(canOpen("/map/dispatch", "eco-viewer").ok, false);
    assert.equal(canOpen("/map", null).ok, false);
    assert.equal(canOpen("/map/dispatch", null).ok, false);
  });
});

/**
 * Last on purpose. A deliberately failing write desyncs PGlite's socket server (a stray
 * `parseComplete`, reproduced with the bare `pg` driver and no app code), and on that
 * server the stray message can reach any connection. Running it last means nothing else
 * reads through a desynced connection. Real Postgres is unaffected.
 */
describe("atomicity", () => {
  it("is atomic: a failing write leaves no partial rows, and the next intake still works", async () => {
    (globalThis as { __ecoeprWardIds?: unknown }).__ecoeprWardIds = undefined;
    const before = [await rows("intakes"), await rows("items"), await rows("geopoints")];
    // An invalid enum value makes the item insert fail after the intake row was written.
    const bad = await recordIntake({ result: analysed({ condition: "exploded" }), ...(await evidence()), location: KURLA });
    assert.ok(bad.error, "expected the write to fail");
    // The reason, not the SQL: no statement text or submitted values reach the screen.
    assert.match(bad.error!, /invalid input value for enum item_condition/);
    assert.doesNotMatch(bad.error!, /insert into|params:|19\.0728/i);
    await freshConnections();
    assert.deepEqual([await rows("intakes"), await rows("items"), await rows("geopoints")], before);
    const good = await recordIntake({ result: analysed(), ...(await evidence()), location: KURLA });
    assert.equal(good.error, null, "a ward id cached from the failed attempt would break this insert");
    assert.equal(good.inserted, true);
  });
});
