/**
 * Heatmap integration tests — the real modules against a real, migrated Postgres.
 *
 *   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres npm run test:heatmap:db
 *
 * The database must be a disposable one with `npm run db:migrate` applied (the same
 * tables, enums, foreign keys and unique indexes as RDS). The suite **refuses to run
 * against any host but localhost**, so it cannot write test rows into a shared database.
 *
 * Submissions go through exactly the sequence `POST /api/ai/intake` runs: the archive's
 * `recordArchivedObjects`, then `recordSubmission` (the `intakes` row), then
 * `recordPricedItem` (item, material lines, hazards, valuation, verdict), then
 * `recordLocation` (ward filing and the geopoint `/map` counts).
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
const { ensureArea, recordLocation } = await import("@/lib/intake/location");
const { recordSubmission } = await import("@/lib/s3/intakes");
const { recordPricedItem } = await import("@/lib/records/items");
const { recordArchivedObjects } = await import("@/lib/s3/media-assets");
const { getHeatmap, setClusterStatus, recomputeClusters } = await import("@/lib/heatmap/store");
const { canOpen } = await import("@/lib/auth/roles");
const { distanceMetres } = await import("@/lib/geo/geohash");
const { fileLocation } = await import("@/lib/geo/areas");
const { eq, sql } = await import("drizzle-orm");

import type { AiAnalysis } from "@/lib/ai/proposal";
import type { CapturedLocation } from "@/lib/intake/location";
import type { ArchivedObject } from "@/lib/s3/archive";

let db = database()!.db;
let counter = 0;

const KURLA = { latitude: 19.0728, longitude: 72.8834 };
const PUNE = { latitude: 18.5286, longitude: 73.8743 };

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

/** A test evidence object, recorded with the archive's own function. */
async function evidence() {
  const checksum = createHash("sha256").update(`test-evidence-${++counter}-${Date.now()}`).digest("hex");
  const object: ArchivedObject = {
    kind: "photo",
    bucket: "test-bucket",
    key: `media/${checksum.slice(0, 2)}/${checksum}.jpg`,
    mimeType: "image/jpeg",
    byteSize: 1024,
    checksumSha256: checksum,
  };
  const records = await recordArchivedObjects([object]);
  assert.equal(records.error, null, `media record failed: ${records.error}`);
  return records.records;
}

/** A priced analysis, shaped exactly as `analyseIntake` returns it. */
function analysis(opts: { verdict?: "verified" | "rejected" | "review"; hazardous?: boolean } = {}): AiAnalysis {
  const hazardous = opts.hazardous ?? false;
  return {
    id: `LIVE-TEST-${String(++counter).padStart(4, "0")}`,
    identified: {
      itemClass: "pcb",
      className: hazardous ? "Battery pack" : "Laptop mainboard",
      cpcb: "ITEW1",
      itemLabel: hazardous ? "Li-ion battery pack" : "Laptop motherboard",
      brand: "TestBrand",
      condition: "dead",
      unitCount: 1,
      stateCode: "MH",
      hazards: hazardous ? ["Lithium cell — fire risk"] : [],
      massGrams: 400,
      hazardous,
    },
    materials: hazardous
      ? [{ id: "li", name: "Lithium cells", symbol: "Li", category: "hazardous", massGrams: 300, ratePerKg: 0, handling: "Authorised recycler only" }]
      : [{ id: "cu", name: "Copper traces", symbol: "Cu", category: "base", massGrams: 60, ratePerKg: 540, handling: "Smelter recovered" }],
    valuation: { grossValue: 32, handlingFee: 5, netToCollector: 27, eprCreditInr: 10, rateBasis: "Test rate card", validUntil: "2026-12-31" },
    gatekeeper: {
      verdict: opts.verdict ?? "verified",
      confidence: 0.93,
      modelVersion: "test-gk-1",
      matchedClass: "pcb",
      reason: "Test reason.",
      signals: [{ label: "Board visible", value: "yes" }],
    },
    summary: {},
    matchedFixtureId: null,
    source: { provider: "foundry", model: "test-model", latencyMs: 1234, calledAt: new Date().toISOString(), inputs: ["photo"] },
    warnings: [],
  } as unknown as AiAnalysis;
}

/** One submission through the same sequence the intake route runs. */
async function submit(opts: { location?: CapturedLocation; hazardous?: boolean; verdict?: "verified" | "rejected" | "review"; evidence?: Awaited<ReturnType<typeof evidence>>; priced?: AiAnalysis } = {}) {
  const media = opts.evidence ?? (await evidence());
  const priced = opts.priced ?? analysis({ hazardous: opts.hazardous, verdict: opts.verdict });
  const submission = await recordSubmission({
    records: media,
    pricedCode: priced.id,
    label: priced.identified.itemLabel,
    massGrams: priced.identified.massGrams,
    extraction: { model: priced.source.model, confidence: priced.gatekeeper.confidence, latencyMs: priced.source.latencyMs },
  });
  assert.equal(submission.error, null, `submission failed: ${submission.error}`);
  const item = await recordPricedItem({ intakeId: submission.submission?.id ?? null, analysis: priced, fields: [] });
  assert.equal(item.error, null, `priced item failed: ${item.error}`);
  const location = await recordLocation({ intakeId: submission.submission?.id, location: opts.location });
  return { media, priced, submission, item, location };
}

before(async () => {
  // A clean slate in the throwaway database.
  await db.execute(sql.raw(
    "truncate hotspot_detections, hotspot_clusters, geopoints, verdict_signals, gatekeeper_verdicts, valuations, item_hazards, material_lines, intake_fields, items, intakes, media_assets, collectors, wards cascade",
  ));
  (globalThis as { __ecoeprWardIds?: unknown }).__ecoeprWardIds = undefined;
});

after(async () => {
  await closeDatabase();
});

describe("filing areas", () => {
  it("creates an area row on first use, once, for a ward or a district", async () => {
    const ward = await ensureArea(db, "MCGM-L");
    (globalThis as { __ecoeprAreaIds?: unknown }).__ecoeprAreaIds = undefined; // force a second insert attempt
    assert.equal(await ensureArea(db, "MCGM-L"), ward);
    assert.equal(await rows("wards"), 1, "areas are added one at a time, not all up front");
    const [l] = await db.select().from(schema.wards).where(eq(schema.wards.code, "MCGM-L"));
    assert.equal(l.name, "L Ward (Kurla)");
    assert.equal((l.boundaryGeoJson as { type: string }).type, "MultiPolygon");

    const pune = fileLocation(PUNE.latitude, PUNE.longitude).district!;
    const id = await ensureArea(db, pune.code);
    assert.ok(id);
    const [d] = await db.select().from(schema.wards).where(eq(schema.wards.code, pune.code));
    assert.equal(d.name, "Pune");
    assert.match(d.city, /^Mah/);
    assert.equal(await ensureArea(db, "IND-not-a-code"), null);
  });
});

describe("recording a submission's location", () => {
  it("files the point to its ward and stamps the intake and item written by the pipeline", async () => {
    const { submission, item, location } = await submit({ location: { ...KURLA, accuracyM: 12 } });
    assert.equal(location?.recorded, true);
    assert.equal(location?.wardCode, "MCGM-L");
    assert.equal(location?.error, null);

    const intakeId = submission.submission!.id;
    const [intake] = await db.select().from(schema.intakes).where(eq(schema.intakes.id, intakeId));
    assert.equal(intake.wardCode, "MCGM-L");
    assert.equal(Number(intake.latitude), KURLA.latitude);
    const [itemRow] = await db.select().from(schema.items).where(eq(schema.items.id, item.itemId!));
    assert.equal(itemRow.wardCode, "MCGM-L");
    const [verdict] = await db.select().from(schema.gatekeeperVerdicts).where(eq(schema.gatekeeperVerdicts.itemId, item.itemId!));
    assert.equal(verdict.verdict, "verified");
    const [point] = await db.select().from(schema.geopoints).where(eq(schema.geopoints.intakeId, intakeId));
    assert.equal(point.accuracyM, 12);
    assert.equal(point.source, "gps");
    const [ward] = await db.select().from(schema.wards).where(eq(schema.wards.id, point.wardId!));
    assert.equal(ward.code, "MCGM-L");
  });

  it("is idempotent: a retried request does not add a second point", async () => {
    const first = await submit({ location: KURLA });
    const before = await rows("geopoints");
    const again = await recordLocation({ intakeId: first.submission.submission!.id, location: KURLA });
    assert.equal(again?.recorded, false);
    assert.match(again?.skipped ?? "", /already has a location/);
    assert.equal(await rows("geopoints"), before);
  });

  it("writes nothing when the handset gave no fix", async () => {
    const before = await rows("geopoints");
    const out = await submit();
    assert.equal(out.location, null);
    assert.equal(await rows("geopoints"), before);
  });

  it("files a fix elsewhere in India to its district", async () => {
    const out = await submit({ location: PUNE });
    assert.equal(out.location?.recorded, true);
    assert.equal(out.location?.areaKind, "district");
    assert.equal(out.location?.wardName, "Pune");
    assert.match(out.location?.stateName ?? "", /^Mah/);
    const [intake] = await db.select().from(schema.intakes).where(eq(schema.intakes.id, out.submission.submission!.id));
    assert.match(intake.wardCode ?? "", /^IND-/);
    const [point] = await db.select().from(schema.geopoints).where(eq(schema.geopoints.intakeId, out.submission.submission!.id));
    assert.ok(point.wardId, "a district is a filing area like a ward");
  });

  it("records a fix outside India without filing it", async () => {
    const out = await submit({ location: { latitude: 27.7172, longitude: 85.324 } }); // Kathmandu
    assert.equal(out.location?.recorded, true);
    assert.equal(out.location?.wardCode, null);
    const [point] = await db.select().from(schema.geopoints).where(eq(schema.geopoints.intakeId, out.submission.submission!.id));
    assert.equal(point.wardId, null);
  });

  it("refuses to attach a location to a submission that was not recorded", async () => {
    const before = await rows("geopoints");
    const out = await recordLocation({ intakeId: null, location: KURLA });
    assert.equal(out?.recorded, false);
    assert.match(out?.skipped ?? "", /not recorded/);
    assert.equal(await rows("geopoints"), before);
  });
});

describe("the heatmap read", () => {
  it("turns four or more nearby real intakes into one site, in the right ward", async () => {
    await submit({ location: KURLA });
    await submit({ location: KURLA });
    const data = await getHeatmap();
    assert.equal(data.configured, true);
    // Kurla submissions with a location: two above, two here = 4, plus Pune and Kathmandu.
    assert.equal(data.livePointCount, 4 + 2 /* Kathmandu is a real detection, just unfiled */);
    assert.equal(data.clusters.length, 1);
    const site = data.clusters[0];
    assert.equal(site.wardCode, "MCGM-L");
    assert.equal(site.detections, 4);
    assert.equal(site.status, "open");
    assert.equal(data.wards[0].code, "MCGM-L");
    assert.equal(data.wards[0].pressure, 100);
    // India by district: Mumbai Suburban (Kurla's district) and Pune, Kathmandu nowhere.
    const names = data.districts.map((d) => d.name).sort();
    assert.deepEqual(names, ["Mumbai Suburban", "Pune"]);
    assert.equal(data.districts.find((d) => d.name === "Mumbai Suburban")?.detections, 4);
    assert.ok(data.bounds && data.bounds.north > 19 && data.bounds.south < 19, "frames the real points");
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
    await submit({ verdict: "rejected", location: KURLA });
    assert.equal((await getHeatmap()).livePointCount, before);
  });

  it("keeps the same site code under the hazardous filter, and hides sites with no hazardous item", async () => {
    const all = await getHeatmap();
    assert.equal((await getHeatmap({ filter: { hazardousOnly: true } })).clusters.length, 0);
    await submit({ hazardous: true, location: KURLA });
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
    await submit({ location: KURLA });
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
    for (const role of ["eco-admin", "eco-officer", "eco-operator", "eco-viewer"] as const) {
      assert.equal(canOpen("/map", role).ok, true, `${role} should view /map`);
    }
    for (const role of ["eco-admin", "eco-officer", "eco-operator"] as const) {
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
  it("is atomic: a failing write leaves no partial stamps, and the next location still records", async () => {
    // An accuracy that overflows `geopoints.accuracy_m` (integer) fails the insert after
    // the intake and item were stamped inside the same transaction.
    const media = await evidence();
    const priced = analysis();
    const submission = await recordSubmission({
      records: media,
      pricedCode: priced.id,
      label: priced.identified.itemLabel,
      massGrams: priced.identified.massGrams,
      extraction: { model: "test-model", confidence: 0.9, latencyMs: 1 },
    });
    const item = await recordPricedItem({ intakeId: submission.submission!.id, analysis: priced, fields: [] });
    const points = await rows("geopoints");
    const bad = await recordLocation({ intakeId: submission.submission!.id, location: { ...KURLA, accuracyM: 1e12 } });
    assert.ok(bad?.error, "expected the write to fail");
    // The reason, not the SQL: no statement text or submitted values reach the screen.
    assert.match(bad!.error!, /out of range/i);
    assert.doesNotMatch(bad!.error!, /insert into|params:|19\.0728/i);
    await freshConnections();
    assert.equal(await rows("geopoints"), points);
    const [intake] = await db.select().from(schema.intakes).where(eq(schema.intakes.id, submission.submission!.id));
    assert.equal(intake.wardCode, null, "the intake must not keep a stamp from a rolled-back write");
    const [itemRow] = await db.select().from(schema.items).where(eq(schema.items.id, item.itemId!));
    assert.equal(itemRow.wardCode, null);

    const good = await recordLocation({ intakeId: submission.submission!.id, location: KURLA });
    assert.equal(good?.error, null, "a ward id cached from the failed attempt would break this insert");
    assert.equal(good?.recorded, true);
  });
});
