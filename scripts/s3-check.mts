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
 *   7. the credential cannot write outside the `media/` prefix it was scoped to
 *   8. with no bucket configured the module degrades instead of throwing, which is
 *      what keeps the AI routes working on a laptop with no AWS credentials
 *
 * It writes two small probe objects and deletes both before exiting. Nothing else in
 * the bucket is read, written or removed.
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

import {
  archiveClient,
  archiveConfigured,
  archiveMediaParts,
  credentialSource,
  extensionFor,
  mediaKey,
} from "../lib/s3/archive.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` -- ${detail}` : ""}`);
  if (!ok) failures++;
}

const PROBE_A = Buffer.from("ecoepr archive probe A — a stand-in for one photograph");
const PROBE_B = Buffer.from("ecoepr archive probe B — different bytes, different key");

const cleanup: { key: string }[] = [];

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

/* ------------------------------------------- 6. the credential is really scoped */
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

/* ------------------------------------------------- 7. degrade without a bucket */
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

/* ------------------------------------------------------------- 8. clean up */
console.log("\n--- cleanup ---");
for (const { key } of cleanup) {
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  console.log(`deleted ${key}`);
}
console.log(`${cleanup.length} probe object(s) removed; the bucket holds nothing this check created`);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
