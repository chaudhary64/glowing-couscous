/**
 * `npm run s3:check` — is the media archive actually working, against the real bucket?
 *
 * Not a mocked test. It uses the same module the routes use, the same environment the
 * app reads and the same bucket, over the network. A check that passes against a fake
 * proves nothing about whether a photograph survives a request; this one is the
 * `db:check` of the S3 integration.
 *
 * What it proves, in order:
 *
 *   1. the configuration resolves, and says which bucket and region it resolved to
 *   2. an object is written under the content-addressed key, with the right MIME type
 *      and a digest that matches one computed here
 *   3. S3 itself reports an AES-256 encrypted object, not an unencrypted one
 *   4. reading the object back returns the exact bytes that went in
 *   5. the same bytes land on the same key a second time (idempotent, so a retry
 *      cannot produce a duplicate)
 *   6. *different* bytes land on a different key
 *   7. a row is recorded in `media_assets` for the object, its columns describe the
 *      bytes that were written, and re-recording is one row rather than two
 *   8. the uploader's Cognito subject resolves through `users.cognito_sub`
 *   9. an unreachable database is reported in seconds rather than thrown, and does not
 *      stop the bytes being archived; two simultaneous identical submissions are one row
 *  10. an `intakes` row is written under the id the price carries, pointing at the object
 *      the archive wrote; re-recording is one row; the evidence listing carries the
 *      submission and an id looks that object back up; the `restrict` foreign key refuses
 *      to let the object be deleted out from under it; and a second object under a taken id
 *      is reported, not mis-joined
 *  11. a presigned read returns the exact bytes, is bounded in both directions, expires,
 *      and refuses a key this archive could not have written
 *  12. the credential cannot write outside the `media/` prefix it was scoped to
 *  13. with no bucket configured the module degrades instead of throwing, which is
 *      what keeps the AI routes working on a laptop with no AWS credentials
 *
 * It writes seven small probe objects, one `media_assets` row per object, one `intakes`
 * row, and one throwaway `users` row, and removes all of it before exiting — including
 * when it stops early, which is what the crash handler below is for. Nothing else in the
 * bucket or either table is read, written or removed.
 *
 * The database half is the same bargain as the S3 half: it is optional, and with no
 * `DATABASE_URL` it reports that the recording is switched off rather than failing.
 *
 * Run it as `npm run s3:check`, which supplies `.env.local`. On Node it relies on
 * native TypeScript stripping (Node 22.18+ / 23.6+ run `.ts` files without a flag).
 */
import { createHash } from "node:crypto";

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { eq, inArray, sql } from "drizzle-orm";

import { closeDatabase, database } from "../db/client.ts";
import { intakes, mediaAssets, users } from "../db/schema/index.ts";
import {
  archiveClient,
  archiveConfigured,
  archiveMediaParts,
  credentialSource,
  extensionFor,
  mediaKey,
  presignRead,
} from "../lib/s3/archive.ts";
import { forgetSubmissions, recordSubmission } from "../lib/s3/intakes.ts";
import {
  archiveAndRecord,
  findMediaAssetBySubmissionCode,
  forgetMediaRecords,
  listEvidence,
  recordArchivedObjects,
} from "../lib/s3/media-assets.ts";

/** The archive is checked as the operator reads it: every row, no scope cut. */
const ALL = { kind: "all" } as const;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failures++;
}

const PROBE_A = Buffer.from("ecoepr archive probe A — a stand-in for one photograph");
const PROBE_B = Buffer.from("ecoepr archive probe B — different bytes, different key");

const cleanup: { key: string }[] = [];

/** Set when the row half runs, so cleanup can remove the throwaway `users` row too. */
let userProbeSub: string | null = null;

/**
 * Ids of the `intakes` rows this run recorded, captured as they are written.
 *
 * Captured rather than re-derived at cleanup time, because a query that looks the rows
 * up through the media rows it has just deleted can only ever return nothing: the check
 * for "nothing was left behind" has to be able to fail.
 */
const probeSubmissionIds: string[] = [];

/**
 * The connection string this process started with.
 *
 * Captured because the sections below deliberately point `DATABASE_URL` at an
 * unreachable host to see what that does. If the run stops in the middle of one of those
 * sections, cleanup would otherwise find no database and quietly remove nothing — which
 * is how a crash leaves a probe row in a shared table. Restoring the original first makes
 * cleanup independent of whatever the test was doing when it died.
 */
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

/**
 * Remove everything this run created, whatever happened.
 *
 * Called at the end of a normal run and by the handlers below on a bad one. Best effort
 * by design: the earlier the crash, the less there is to remove, and a cleanup that
 * throws must not mask the failure that caused it.
 */
async function runCleanup(): Promise<void> {
  // First, before anything else: put the environment back, so the row cleanup below has a
  // connection whatever the section that failed was doing.
  if (ORIGINAL_DATABASE_URL) process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;

  const client = configured?.client;
  const bucket = config?.bucket;
  if (client && bucket) {
    for (const { key } of cleanup) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      console.log(`deleted ${key}`);
    }
    console.log(`${cleanup.length} probe object(s) removed; the bucket holds nothing this check created`);
  }

  const probeKeys = cleanup.map(({ key }) => key);
  if (db && probeKeys.length > 0) {
    // The submissions go first, and this order is not a preference: `intakes.media_id` is
    // a `restrict` foreign key, so the database itself refuses to remove an object while a
    // submission points at it. That constraint is the point — it is what stops the
    // evidence a decision was taken on from being deleted out from under it — and a
    // cleanup that ignored it would either fail or have to weaken it.
    const submissions = await forgetSubmissions(probeKeys);
    const forgotten = await forgetMediaRecords(probeKeys);
    const remaining = await db.db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(inArray(mediaAssets.storageKey, probeKeys));
    console.log(`${submissions} probe submission(s) and ${forgotten} probe row(s) removed`);
    check("no probe row is left behind", remaining.length === 0, `${remaining.length} left`);
    const leftSubmissions =
      probeSubmissionIds.length > 0
        ? await db.db.select({ id: intakes.id }).from(intakes).where(inArray(intakes.id, probeSubmissionIds))
        : [];
    check("no probe submission is left behind", leftSubmissions.length === 0, `${leftSubmissions.length} left`);
  }

  // The probe user goes last, and only its own row: the table it was inserted into is
  // shared with everything else that will ever use this database.
  if (db && userProbeSub) {
    const probeUsers = await db.db
      .delete(users)
      .where(eq(users.cognitoSub, userProbeSub))
      .returning({ id: users.id });
    console.log(`${probeUsers.length} probe user row(s) removed`);
  }

  await closeDatabase();
}

/**
 * A crash must not leave probe objects in a shared bucket or probe rows in a shared
 * database, so both are cleaned up before the process is allowed to die.
 */
async function crashOut(error: unknown): Promise<void> {
  console.error(`\nThe check stopped early: ${error instanceof Error ? error.stack : String(error)}`);
  try {
    await runCleanup();
  } catch (cleanupError) {
    console.error("cleanup after the crash also failed:", cleanupError);
  }
  process.exit(1);
}
process.on("uncaughtException", (error) => void crashOut(error));
process.on("unhandledRejection", (error) => void crashOut(error));

/* ------------------------------------------------------------ 1. configuration */
// The app's own client, not a second one: see the note on `archiveClient`. Anything
// this script does with a different identity proves nothing about the app.
const configured = archiveClient();
const config = configured?.config ?? null;
console.log("--- configuration ---");
console.log(`bucket: ${config?.bucket ?? "(unset)"}`);
console.log(`region: ${config?.region ?? "(unset)"}`);
console.log(`prefix: ${config?.prefix ?? "(unset)"}`);
// Which provider is in play, never the value: `S3_ACCESS_KEY_ID` is the name this app
// can actually be given on Amplify, `AWS_ACCESS_KEY_ID` only works off it.
const source = credentialSource();
console.log(`credentials: ${source}`);
if (source === "default chain") {
  console.log(
    "  Note: no S3 key was found, so the SDK is using whatever this machine already has\n" +
      "  (usually the admin profile in ~/.aws/credentials). The write outside the prefix below\n" +
      "  will then succeed, and that failure is the point of the check: it means the app is\n" +
      "  running with far more access than it should.",
  );
}
check("the bucket and region resolve from the environment", config !== null);
check("archiveConfigured() agrees with the resolved configuration", archiveConfigured() === (config !== null));

if (!configured || !config) {
  console.log(
    "\nNo S3_BUCKET/S3_REGION, so there is nothing to check against. This is also why the\n" +
      "archive is reported as `configured: false` rather than as a failure at request time.",
  );
  process.exit(failures === 0 ? 0 : 1);
}

const client = configured.client;
const sha256hex = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/* ------------------------------------------------------- 2. write and describe */
console.log("\n--- archive a photo ---");
const first = await archiveMediaParts([
  { kind: "photo", media: { mimeType: "image/jpeg", dataBase64: PROBE_A.toString("base64") } },
]);

check("the archive reports a configured, error-free write", first.configured && first.error === null, first.error ?? "");
check("exactly one object was written", first.objects.length === 1, `${first.objects.length}`);
// The source rides in every response so a deployment that has quietly fallen back to
// some other identity is visible on the screen rather than only in a bucket listing.
check("the outcome names the credential source", first.credentialSource === credentialSource(), String(first.credentialSource));
check("the credential source is the scoped key, not the machine's default profile", credentialSource() === "S3_ACCESS_KEY_ID", credentialSource());

const object = first.objects[0];
if (!object) {
  console.log("\nnothing was archived, so the rest of the check cannot run");
  process.exit(1);
}
cleanup.push({ key: object.key });

const expectedKey = mediaKey(config.prefix, sha256hex(PROBE_A), "image/jpeg");
check("the key is content-addressed, from this prefix", object.key === expectedKey, object.key);
check(
  "the key shape is media/<2 hex>/<sha256>.<ext>",
  /^media\/[0-9a-f]{2}\/[0-9a-f]{64}\.(jpg|bin)$/.test(object.key),
  object.key,
);
check("the recorded byte size is the byte size", object.byteSize === PROBE_A.length, `${object.byteSize}`);
check("the recorded digest is the digest of the bytes", object.checksumSha256 === sha256hex(PROBE_A));

console.log("\n--- what S3 itself reports about that object ---");
const head = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: object.key }));
check("the object exists in the bucket", head.ContentLength === PROBE_A.length, `${head.ContentLength} bytes`);
check("the content type is the one that was submitted", head.ContentType === "image/jpeg", String(head.ContentType));
check("S3 encrypted it with AES-256", head.ServerSideEncryption === "AES256", String(head.ServerSideEncryption));
check("the kind is carried as object metadata", head.Metadata?.kind === "photo", String(head.Metadata?.kind));
check("the digest is carried as object metadata", head.Metadata?.sha256 === sha256hex(PROBE_A));

/* ------------------------------------------------------------- 3. read it back */
console.log("\n--- read it back ---");
const got = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: object.key }));
const body = Buffer.from(await got.Body!.transformToByteArray());
check("the bytes that come back are the bytes that went in", body.equals(PROBE_A), `${body.length} bytes`);

/* --------------------------------------------------- 4. the same bytes, again */
console.log("\n--- the same bytes a second time ---");
const again = await archiveMediaParts([
  { kind: "photo", media: { mimeType: "image/jpeg", dataBase64: PROBE_A.toString("base64") } },
]);
check(
  "identical bytes resolve to the identical key, so a retry cannot duplicate",
  again.objects[0]?.key === object.key,
  again.objects[0]?.key ?? "(none)",
);

/* ------------------------------------------------------- 5. different bytes */
console.log("\n--- different bytes ---");
const other = await archiveMediaParts([
  { kind: "voice", media: { mimeType: "audio/webm", dataBase64: PROBE_B.toString("base64") } },
]);
const voice = other.objects[0];
if (voice) cleanup.push({ key: voice.key });
check("different bytes resolve to a different key", voice !== undefined && voice.key !== object.key, String(voice?.key));
check("a voice note keeps its own extension", voice?.key.endsWith(".webm") === true, String(voice?.key));
check("extensionFor() maps the accepted types", extensionFor("image/png") === "png" && extensionFor("audio/ogg") === "ogg");
check("extensionFor() does not invent an extension it does not know", extensionFor("application/zip") === "bin");

/* ------------------------- 6. the row that makes the key findable afterwards */
console.log("\n--- recording the archive in media_assets ---");
const db = database();
console.log(`database: ${db ? "connected" : "(no DATABASE_URL, so this half is off)"}`);

if (db) {
  // The composition the routes actually call — archive beside the model, then record —
  // rather than the two halves separately, so this covers the wiring too.
  const probeSub = `s3-check-${Date.now()}`;
  userProbeSub = probeSub;
  const [probeUser] = await db.db
    .insert(users)
    .values({ cognitoSub: probeSub, fullName: "S3 check probe" })
    .returning({ id: users.id });

  const PROBE_C = Buffer.from("ecoepr archive probe C — the object behind a database row");
  const recorded = await archiveAndRecord(
    [{ kind: "photo", media: { mimeType: "image/jpeg", dataBase64: PROBE_C.toString("base64") } }],
    { uploaderCognitoSub: probeSub },
  );

  const probeKey = recorded.storage.objects[0]?.key;
  if (probeKey) cleanup.push({ key: probeKey });

  check(
    "the archive writes the object it records",
    recorded.storage.objects.length === 1,
    `${recorded.storage.objects.length} object(s)`,
  );
  check(
    "the response carries a signed read for what it just wrote",
    recorded.storage.readUrls.length === 1 && recorded.storage.readUrls[0]?.key === probeKey,
    `${recorded.storage.readUrls.length} read url(s)`,
  );
  check(
    "the outcome reports the recording as configured",
    recorded.records?.configured === true && recorded.records.error === null,
    recorded.records?.error ?? "",
  );
  check(
    "exactly one row was inserted",
    recorded.records?.records.length === 1 && recorded.records.records[0]?.inserted === true,
    `${recorded.records?.records.length ?? 0}`,
  );

  const rows = probeKey
    ? await db.db.select().from(mediaAssets).where(eq(mediaAssets.storageKey, probeKey)).limit(1)
    : [];
  const row = rows[0];
  check("the row is in the table under its key", row !== undefined, probeKey ?? "(no key)");
  check("the row records what kind of media it was", row?.kind === "photo", String(row?.kind));
  check("the row records the MIME type as submitted", row?.mimeType === "image/jpeg", String(row?.mimeType));
  check("the row records the byte size of the object", row?.byteSize === PROBE_C.length, `${row?.byteSize}`);
  check("the row records the digest, so it agrees with the key", row?.checksumSha256 === sha256hex(PROBE_C));
  check("the row is timestamped", row?.uploadedAt instanceof Date, String(row?.uploadedAt));
  check(
    "the uploader's Cognito subject resolves through users.cognito_sub",
    row?.uploaderUserId === probeUser.id,
    `${row?.uploaderUserId} vs ${probeUser.id}`,
  );

  // The retry case: the bytes are already there, so the row must not be doubled by a
  // resubmission that has the same content.
  const reRecorded = await recordArchivedObjects(recorded.storage.objects);
  check(
    "re-recording the same object inserts nothing and reports the existing row",
    reRecorded.records.length === 1 && reRecorded.records[0]?.inserted === false,
    `inserted=${reRecorded.records[0]?.inserted}`,
  );
  const sameKey = probeKey
    ? await db.db
        .select({ id: mediaAssets.id })
        .from(mediaAssets)
        .where(eq(mediaAssets.storageKey, probeKey))
    : [];
  check("the unique index held: one row, not two", sameKey.length === 1, `${sameKey.length} rows`);

  // Recording must be switchable off without breaking a request, exactly as the archive
  // and the model are.
  const savedDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const withoutDb = await recordArchivedObjects(recorded.storage.objects);
  check("with no DATABASE_URL the recording reports configured: false", withoutDb.configured === false);
  check("...and records nothing without calling it an error", withoutDb.error === null && withoutDb.records.length === 0);
  if (savedDatabaseUrl) process.env.DATABASE_URL = savedDatabaseUrl;

  // The two deadlines on a connection, asserted by asking the server what it thinks.
  // An unset statement_timeout is the difference between "the database is slow" being a
  // reported failure and the platform killing the request with nothing to read.
  const timeoutRows = (await db.db.execute(sql`show statement_timeout`)) as unknown as {
    rows: { statement_timeout: string }[];
  };
  const statementTimeout = timeoutRows.rows[0]?.statement_timeout ?? "(none)";
  check(
    "a stalled query is bounded by a statement timeout",
    statementTimeout !== "0" && statementTimeout !== "(none)",
    statementTimeout,
  );

  // The other half of the degradation story: switched on but unreachable. Not the same
  // case as unset, and the one that happens in production. The address is in a reserved
  // range that never answers, so this is the worst version of it rather than a polite one.
  process.env.DATABASE_URL = "postgresql://probe:probe@10.255.255.1:5432/ecoepr?sslmode=no-verify";
  const startedAt = Date.now();
  const unreachable = await recordArchivedObjects(recorded.storage.objects);
  const waitedMs = Date.now() - startedAt;
  check(
    "an unreachable database is reported as an error, not thrown into the request",
    unreachable.configured === true && unreachable.error !== null,
    (unreachable.error ?? "no error").slice(0, 70),
  );
  check(
    "...and it gives up in seconds rather than spending the request's whole budget",
    waitedMs < 15_000,
    `${waitedMs} ms`,
  );

  // The claim the route depends on: a database outage is a recording failure, not an
  // archiving failure. The bytes are already in S3 by the time this runs.
  const PROBE_D = Buffer.from("ecoepr archive probe D — archived while the database is down");
  const whileDown = await archiveAndRecord([
    { kind: "photo", media: { mimeType: "image/jpeg", dataBase64: PROBE_D.toString("base64") } },
  ]);
  const downKey = whileDown.storage.objects[0]?.key;
  if (downKey) cleanup.push({ key: downKey });
  check(
    "a dead database does not stop the object being archived",
    whileDown.storage.objects.length === 1 && whileDown.storage.error === null,
    `${whileDown.storage.objects.length} object(s)`,
  );
  check(
    "...while the response says plainly that the row is missing",
    whileDown.records?.error !== null && whileDown.records !== null,
    (whileDown.records?.error ?? "no error").slice(0, 60),
  );
  if (savedDatabaseUrl) process.env.DATABASE_URL = savedDatabaseUrl;

  // Two collectors tapping submit at the same moment is not hypothetical, and the unique
  // index is the only thing standing between it and a duplicate row.
  const PROBE_E = Buffer.from("ecoepr archive probe E — two identical submissions at once");
  const atOnce = (await Promise.all([
    archiveAndRecord([
      { kind: "photo", media: { mimeType: "image/jpeg", dataBase64: PROBE_E.toString("base64") } },
    ]),
    archiveAndRecord([
      { kind: "photo", media: { mimeType: "image/jpeg", dataBase64: PROBE_E.toString("base64") } },
    ]),
  ])) as Awaited<ReturnType<typeof archiveAndRecord>>[];
  const raceKey = atOnce[0]?.storage.objects[0]?.key;
  if (raceKey) cleanup.push({ key: raceKey });
  check("two identical submissions at once resolve to the same key", raceKey !== undefined && raceKey === atOnce[1]?.storage.objects[0]?.key, String(raceKey));
  check(
    "...and neither call fails on the unique index",
    atOnce.every((result) => result.records?.error === null),
    atOnce.map((result) => result.records?.error ?? "ok").join(" / "),
  );
  const raceRows = raceKey
    ? await db.db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.storageKey, raceKey))
    : [];
  check("...and the table holds one row, not two", raceRows.length === 1, `${raceRows.length} rows`);
  check(
    "...with exactly one of the two calls reporting the insert",
    atOnce.filter((result) => result.records?.records[0]?.inserted === true).length === 1,
    atOnce.map((result) => String(result.records?.records[0]?.inserted)).join(" / "),
  );

  /* ------------- 7. the submission that ties an object to the price it produced ----- */
  // The join this row exists for. Everything above proves the object is archived and
  // described; this proves it can be found *from* the submission that priced it.
  console.log("\n--- recording the submission behind an object ---");

  /**
   * A submission id nothing else in the table holds.
   *
   * In the older four-digit shape of a live id (`LIVE-2026-0431`; live ids now carry
   * eight digits from a hash of the evidence) but probed for, because older rows or a run
   * that crashed in the past could have left the same four digits behind and this check
   * must not fail on somebody else's row — that is what cleanup is for, not what a
   * passing check is for.
   */
  let probeCode = `LIVE-2026-${String(Date.now() % 10_000).padStart(4, "0")}`;
  for (let step = 0; step < 10; step += 1) {
    const clash = await db.db.select({ id: intakes.id }).from(intakes).where(eq(intakes.code, probeCode));
    if (clash.length === 0) break;
    probeCode = `LIVE-2026-${String((Number(probeCode.slice(-4)) + 1) % 10_000).padStart(4, "0")}`;
  }

  const PROBE_F = Buffer.from("ecoepr archive probe F — the object a submission is recorded against");
  const forSubmission = await archiveAndRecord(
    [{ kind: "photo", media: { mimeType: "image/jpeg", dataBase64: PROBE_F.toString("base64") } }],
    { uploaderCognitoSub: probeSub },
  );
  const submissionKey = forSubmission.storage.objects[0]?.key;
  if (submissionKey) cleanup.push({ key: submissionKey });

  const submission = await recordSubmission({
    records: forSubmission.records?.records ?? [],
    pricedCode: probeCode,
    label: "Probe board",
    // 1500, not 1450: the assertion below is about the sentence the row stores, and
    // 1.45 kg formats to "1.4 kg" through `formatMass`'s one decimal place. A probe that
    // has to explain its own arithmetic is a worse probe.
    massGrams: 1500,
    extraction: { model: "probe:model", confidence: 0.9, latencyMs: 1234 },
  });
  if (submission.submission) probeSubmissionIds.push(submission.submission.id);

  check(
    "the submission row is written for a priced request",
    submission.configured && submission.submission !== null && submission.error === null,
    submission.error ?? "",
  );
  check(
    "...and it points at the object the archive just wrote",
    submission.submission?.storageKey === submissionKey,
    String(submission.submission?.storageKey),
  );
  check(
    "...under the id the price carries, so it is found by an id already on screen",
    submission.submission?.code === probeCode,
    String(submission.submission?.code),
  );

  const submissionRows = await db.db
    .select({
      code: intakes.code,
      mode: intakes.mode,
      summary: intakes.summary,
      collectorId: intakes.collectorId,
      submittedAt: intakes.submittedAt,
      model: intakes.extractionModel,
      confidence: intakes.extractionConfidence,
      latencyMs: intakes.extractionLatencyMs,
    })
    .from(intakes)
    .where(eq(intakes.code, probeCode));
  const submissionRow = submissionRows[0];
  check("the row is in the intakes table, by that id", submissionRow !== undefined, `${submissionRows.length} row(s)`);
  check("the row records the mode of the object it points at", submissionRow?.mode === "photo", String(submissionRow?.mode));
  check(
    "the row records one line about what the submission was",
    submissionRow?.summary === "Probe board, 1.5 kg",
    String(submissionRow?.summary),
  );
  check(
    "the row records how it was read, which is what those three columns are for",
    submissionRow?.model === "probe:model" &&
      submissionRow?.confidence === "0.900" &&
      submissionRow?.latencyMs === 1234,
    `${submissionRow?.model} / ${submissionRow?.confidence} / ${submissionRow?.latencyMs}`,
  );
  check("the row is timestamped as a submission", submissionRow?.submittedAt instanceof Date, String(submissionRow?.submittedAt));
  // Null is the honest answer, not a gap: the request carries an operator's session and
  // says nothing at all about whose material it is. See `lib/s3/intakes.ts`.
  check(
    "no collector is invented for a submission that knows of none",
    submissionRow?.collectorId === null,
    String(submissionRow?.collectorId),
  );

  // The retry case, the same one the media row has: same bytes, same key, same submission.
  const resubmitted = await recordSubmission({
    records: forSubmission.records?.records ?? [],
    pricedCode: probeCode,
    label: "Probe board",
    massGrams: 1500,
  });
  check(
    "re-recording the same submission inserts nothing and reports the existing row",
    resubmitted.submission !== null && resubmitted.submission.created === false,
    `created=${resubmitted.submission?.created}`,
  );
  const doubled = await db.db.select({ id: intakes.id }).from(intakes).where(eq(intakes.code, probeCode));
  check("the unique index held: one submission, not two", doubled.length === 1, `${doubled.length} rows`);

  // The reader's path, exactly as the evidence screen takes it: the listing carries the
  // submission per object. Without it the archive is a bucket of digests.
  const listing = await listEvidence(ALL, 60);
  const listed = listing.assets.find((asset) => asset.storageKey === submissionKey);
  check(
    "the evidence listing joins the submission onto its object",
    listed?.submissionCode === probeCode,
    String(listed?.submissionCode),
  );
  check(
    "...and carries when it was recorded",
    typeof listed?.submittedAt === "string",
    String(listed?.submittedAt),
  );

  // The lookup the evidence screen offers from here on: an operator holding an id off a
  // priced result pastes it and gets the object behind it. The same read the page takes,
  // entered from the other end of the join — one indexed read on `intakes_code_uq`.
  const found = await findMediaAssetBySubmissionCode(ALL, probeCode);
  check(
    "the id a valuation carries resolves to the object behind it",
    found.asset?.storageKey === submissionKey,
    String(found.asset?.storageKey),
  );
  check(
    "...and carries the one line the submission kept about what it was",
    found.summary === "Probe board, 1.5 kg",
    String(found.summary),
  );
  check(
    "...and describes the object the way the listing does, so both reads agree",
    found.asset !== null && listed !== undefined && found.asset.id === listed.id,
    `${found.asset?.id} / ${listed?.id}`,
  );
  // An id nothing holds is an answer, not an error: the screen says "nothing is archived
  // under that id" and the operator retypes it. Six digits, where every id this app mints
  // ends in four, so the probe cannot collide with a real one.
  const unknownId = await findMediaAssetBySubmissionCode(ALL, `LIVE-2026-${String(Date.now()).slice(-6)}`);
  check(
    "an id nothing holds resolves to nothing rather than an error",
    unknownId.configured && unknownId.asset === null && unknownId.error === null,
    unknownId.error ?? "no error",
  );

  // The constraint, not a convention, is what keeps evidence attached: the object cannot
  // simply be deleted while a submission points at it.
  let refused = false;
  try {
    await forgetMediaRecords(submissionKey ? [submissionKey] : []);
  } catch {
    refused = true;
  }
  check("the object cannot be deleted while a submission points at it", refused);
  const stillThere = submissionKey
    ? await db.db.select({ id: mediaAssets.id }).from(mediaAssets).where(eq(mediaAssets.storageKey, submissionKey))
    : [];
  check("...so the evidence it protects is still in place", stillThere.length === 1, `${stillThere.length} row(s)`);

  // Should a second object ever arrive under an id already taken (ids are a hash of the
  // evidence; before that, of the description), it is archived, listed and reported as
  // unjoined rather than being given a row that would point at somebody else's evidence.
  const PROBE_G = Buffer.from("ecoepr archive probe G — a second object under a taken submission id");
  const secondObject = await archiveAndRecord(
    [{ kind: "photo", media: { mimeType: "image/jpeg", dataBase64: PROBE_G.toString("base64") } }],
    { uploaderCognitoSub: probeSub },
  );
  const secondKey = secondObject.storage.objects[0]?.key;
  if (secondKey) cleanup.push({ key: secondKey });
  const taken = await recordSubmission({
    records: secondObject.records?.records ?? [],
    pricedCode: probeCode,
    label: "Probe board",
    massGrams: 1500,
  });
  check(
    "a second object under a taken submission id is reported, not silently mis-joined",
    taken.submission === null && taken.error !== null,
    (taken.error ?? "no error").slice(0, 80),
  );
  check(
    "...and its own row is still archived, so the refusal cost nothing",
    secondKey !== undefined && secondObject.records?.records[0]?.inserted === true,
    String(secondKey),
  );

  // And the posture the other halves have: switched off is not broken.
  delete process.env.DATABASE_URL;
  const noDatabase = await recordSubmission({
    records: forSubmission.records?.records ?? [],
    pricedCode: probeCode,
    label: "Probe board",
    massGrams: 1500,
  });
  check("with no DATABASE_URL the submission reports configured: false", noDatabase.configured === false);
  check(
    "...and records nothing without calling it an error",
    noDatabase.error === null && noDatabase.submission === null,
  );
  const noDatabaseLookup = await findMediaAssetBySubmissionCode(ALL, probeCode);
  check(
    "with no DATABASE_URL the id lookup reports configured: false",
    noDatabaseLookup.configured === false && noDatabaseLookup.asset === null && noDatabaseLookup.error === null,
    noDatabaseLookup.error ?? "",
  );
  if (savedDatabaseUrl) process.env.DATABASE_URL = savedDatabaseUrl;
} else {
  console.log(
    "  No DATABASE_URL, so there is no table to check against. This is the same posture the\n" +
      "  archive takes with no bucket: the rows are off, the request still answers.",
  );
}

/* ------------------------------------------------- 8. a signed read of it */
console.log("\n--- reading an archived object back through a presigned URL ---");
const signed = await presignRead(object.key);
check("presignRead() signs a key this archive writes", signed.ok, signed.ok ? "" : signed.reason);

if (signed.ok) {
  const url = new URL(signed.url);
  check(
    "the URL is a SigV4 presign for this bucket, key and expiry",
    url.searchParams.get("X-Amz-Signature") !== null &&
      url.searchParams.get("X-Amz-Expires") === String(signed.expiresInSeconds),
    `${url.host} expires=${url.searchParams.get("X-Amz-Expires")}`,
  );
  check(
    "the signature is scoped to the object's own path",
    decodeURIComponent(url.pathname).endsWith(object.key),
    url.pathname,
  );

  // The end-to-end proof: the app's own scoped credential, over the network, through a
  // URL that carries no credentials of its own.
  const served = await fetch(signed.url);
  const servedBytes = Buffer.from(await served.arrayBuffer());
  check("the signed URL serves the object", served.status === 200, `HTTP ${served.status}`);
  check("the bytes that come back are the bytes that went in", servedBytes.equals(PROBE_A));
  check(
    "the object is served as it was stored",
    served.headers.get("content-type") === "image/jpeg" &&
      served.headers.get("content-disposition") === "inline",
    `${served.headers.get("content-type")} / ${served.headers.get("content-disposition")}`,
  );
  check(
    "the read is short-lived: five minutes by default",
    signed.expiresInSeconds === 300,
    `${signed.expiresInSeconds}s`,
  );
} else {
  console.log("  (no signature, so the read itself cannot be exercised)");
}

// The clamp, at both ends: the floor keeps a caller from minting a URL that expires
// before a browser can use it, the ceiling keeps a capability from outliving the work.
const floored = await presignRead(object.key, 1);
const capped = await presignRead(object.key, 999_999);
check("a one-second request is raised to the 30-second floor", floored.ok && floored.expiresInSeconds === 30, `${floored.ok ? floored.expiresInSeconds : floored.reason}s`);
check("a ten-day request is cut to the one-hour ceiling", capped.ok && capped.expiresInSeconds === 3600, `${capped.ok ? capped.expiresInSeconds : capped.reason}s`);

// Anything that is not a key this archive writes is refused before it is signed, so a
// read request cannot be used to walk the bucket or to probe for guessable names.
const rejected = [
  "",
  "media",
  "s3-check-outside-prefix.txt",
  `other/${object.key}`,
  `media/abc/${sha256hex(PROBE_A)}.jpg`,
  `media/ab/${sha256hex(PROBE_A).slice(0, 63)}.jpg`,
  `media/ab/${sha256hex(PROBE_A).toUpperCase()}.jpg`,
  `media/ab/${sha256hex(PROBE_A)}`,
  `media/ab/${sha256hex(PROBE_A)}.jpg/../../etc/passwd`,
  "../media/ab/abcdef.jpg",
];
const signedAnyway = await Promise.all(rejected.map((key) => presignRead(key)));
check(
  "every key of the wrong shape is refused, not signed",
  signedAnyway.every((result) => !result.ok && result.reason === "invalid_key"),
  signedAnyway.map((r) => (r.ok ? "signed" : r.reason)).join(","),
);

// A signature says the URL is well-formed, not that the object exists. Worth asserting,
// because the alternative — HEAD on every read — costs a round trip per image.
const unwrittenKey = `media/aa/${"0".repeat(64)}.jpg`;
const unwritten = await presignRead(unwrittenKey);
check("a well-formed key that was never written still signs", unwritten.ok, unwritten.ok ? "" : unwritten.reason);
if (unwritten.ok) {
  const missing = await fetch(unwritten.url);
  check(
    "...and its GET is refused by S3 rather than served",
    missing.status === 403 || missing.status === 404,
    `HTTP ${missing.status}`,
  );
}

// Expiry, tested for real: a signature below this module's own floor, then a wait. This
// is S3 refusing a stale signature, not this code refusing to make one.
const shortLived = await getSignedUrl(
  client,
  new GetObjectCommand({ Bucket: config.bucket, Key: object.key }),
  { expiresIn: 1 },
);
await new Promise((resolve) => setTimeout(resolve, 2_500));
const stale = await fetch(shortLived);
check(
  "a signature past its expiry is refused by S3",
  stale.status === 400 || stale.status === 403,
  `HTTP ${stale.status}`,
);

/* ------------------------------------------- 9. the credential is really scoped */
console.log("\n--- the credential against a key outside the prefix ---");
let outsideAllowed = true;
let outsideReason = "";
try {
  await client.send(
    new PutObjectCommand({ Bucket: config.bucket, Key: "s3-check-outside-prefix.txt", Body: "should not be allowed" }),
  );
} catch (error) {
  outsideAllowed = false;
  outsideReason = error instanceof Error ? error.message.slice(0, 90) : String(error);
}
check(
  "writing outside the media/ prefix is refused",
  !outsideAllowed,
  outsideAllowed ? "the write succeeded, which means the credential is broader than the policy" : outsideReason,
);
if (outsideAllowed) {
  // Leave the bucket as it was found, even when the check itself failed.
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: "s3-check-outside-prefix.txt" }));
}

/* ------------------------------------------------ 10. degrade without a bucket */
console.log("\n--- with the archive switched off ---");
const savedBucket = process.env.S3_BUCKET;
const savedRegion = process.env.S3_REGION;
delete process.env.S3_BUCKET;
delete process.env.S3_REGION;

const off = await archiveMediaParts([
  { kind: "photo", media: { mimeType: "image/jpeg", dataBase64: PROBE_A.toString("base64") } },
]);
check("an unconfigured archive reports configured: false", off.configured === false);
check("an unconfigured archive still reports where credentials would come from", typeof off.credentialSource === "string", String(off.credentialSource));
check("an unconfigured archive writes nothing", off.objects.length === 0);
check("an unconfigured archive is not an error", off.error === null);
check("an unconfigured archive does not throw, so the route still answers", true);

if (savedBucket) process.env.S3_BUCKET = savedBucket;
if (savedRegion) process.env.S3_REGION = savedRegion;

/* ------------------------------------------------------------- 11. clean up */
console.log("\n--- cleanup ---");
await runCleanup();

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
