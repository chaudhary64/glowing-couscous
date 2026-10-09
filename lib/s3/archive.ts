import { createHash } from "node:crypto";

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * The media archive: where the photograph or voice note that produced a valuation
 * is actually kept.
 *
 * Until now those bytes arrived at `/api/ai/*` as base64, went out to the model in
 * the same request, and were dropped when the response was written. The rupee
 * figure outlived the evidence it came from. `db/schema/intake.ts` has always held
 * the slot for this — `media_assets.storage_key`, described there as "S3 object
 * key. The bucket and region are configuration, not data" — and the unique index
 * on that column is only meaningful if a key is derived from the file rather than
 * invented per submission.
 *
 * Four decisions carry the rest of this file:
 *
 * 1. **Content-addressed keys.** The key is the SHA-256 of the bytes, so the same
 *    photograph submitted twice is one object, not two, and the unique index on
 *    `storage_key` says what it looks like it says. A PUT is then idempotent: a
 *    retried request whose response was lost costs a write of bytes that are
 *    already there, not a second copy of them.
 *
 * 2. **S3 verifies the bytes.** The same digest goes out as `ChecksumSHA256`, so a
 *    truncated upload is refused by the service instead of being stored as the
 *    evidence a price was computed from.
 *
 * 3. **Credentials are read from this integration's own names, then the SDK's
 *    default chain.** The bucket and region are the only things required to switch
 *    the archive on, and a key handed over under `S3_ACCESS_KEY_ID` /
 *    `S3_SECRET_ACCESS_KEY` is used directly. The standard names cannot be used on
 *    Amplify at all — the service refuses them, see `explicitCredentials` — so the
 *    chain is what covers local work today and an instance role tomorrow, and the
 *    day Amplify's SSR compute gets the IAM role `amplify.yml` says it still lacks,
 *    nothing in this file changes.
 *
 * 4. **Storage never decides whether an analysis succeeds.** A failed write is
 *    reported in the response and in the server log; it does not throw away a
 *    model call that already cost money, and it does not pretend the archive is
 *    configured when it is not. The caller gets the truth either way.
 *
 * This module deliberately does not import `AiMediaPart` from `lib/ai/gemini`: the
 * input shape is structural, so storage stays independent of whichever provider is
 * answering.
 */

/** The two things an intake can hand over, matching `media_assets.kind`. */
export type MediaKind = "photo" | "voice";

/** Structurally `AiMediaPart`, without importing the AI layer to say so. */
export interface ArchiveMediaInput {
  mimeType: string;
  /** Base64 with no data-URL prefix — `readPayload` already stripped it. */
  dataBase64: string;
}

export interface ArchiveRequest {
  kind: MediaKind;
  media: ArchiveMediaInput;
}

export interface ArchivedObject {
  kind: MediaKind;
  bucket: string;
  /** `media/<sha256[0:2]>/<sha256>.<ext>` — see `mediaKey`. */
  key: string;
  mimeType: string;
  byteSize: number;
  /** Lowercase hex, the value the `media_assets.checksum_sha256` column expects. */
  checksumSha256: string;
}

export interface ArchiveOutcome {
  /** False when the bucket or region is unset: the archive is off, not broken. */
  configured: boolean;
  bucket: string | null;
  /**
   * Which credentials the write used, by name and never by value.
   *
   * Reported because the two answers mean very different things. An explicit
   * `S3_ACCESS_KEY_ID` is the key scoped to `media/*` in this one bucket. "default
   * chain" means whatever the machine already had — on a developer's laptop that is
   * usually the admin profile in `~/.aws/credentials`, which is why a write outside
   * the prefix will succeed there and fail in a deployment. That happened during this
   * integration's own testing: the keys went missing from `.env.local`, the SDK picked
   * up the admin profile, and `s3:check` caught it by refusing to let the write
   * through. Without this field in the response, nothing on the deployed side would
   * have said which identity was in force.
   */
  credentialSource: CredentialSource;
  objects: ArchivedObject[];
  /**
   * Set when the archive was configured and a write still failed. Never thrown:
   * the caller has a model result in hand by the time it reads this, and losing
   * that result to report a storage fault would be the worse of the two failures.
   */
  error: string | null;
}

export interface ArchiveConfig {
  bucket: string;
  region: string;
  prefix: string;
}

/**
 * The prefix every key lives under, and the boundary the IAM policy is written
 * against. Changing this without changing `EcoEPRMediaArchive` in IAM revokes the
 * app's own read and write access — the policy grants `media/*`, nothing wider.
 */
const DEFAULT_PREFIX = "media";

/**
 * Credentials handed over under this integration's own names.
 *
 * Amplify Hosting refuses any environment variable beginning with `AWS` — the API
 * answers `Environment variables cannot start with the reserved prefix "AWS"` — so
 * `AWS_ACCESS_KEY_ID` is not a name a deployed copy of this app can be given, and an
 * `amplify.yml` that copies it through can never match anything. These two names are
 * what the deployment uses instead; both are optional, and with neither set the
 * SDK's own chain decides (a shared profile locally, an instance role on compute that
 * has one).
 *
 * Nothing here is logged, echoed into a response, or written into an object key — the
 * values are handed to the SDK and nowhere else.
 */
function explicitCredentials(): { accessKeyId: string; secretAccessKey: string } | null {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) return null;
  return { accessKeyId, secretAccessKey };
}

export type CredentialSource = "S3_ACCESS_KEY_ID" | "AWS_ACCESS_KEY_ID" | "default chain";

/** Which provider the process is using, never a value. Reported in the response. */
export function credentialSource(): CredentialSource {
  if (explicitCredentials()) return "S3_ACCESS_KEY_ID";
  if (process.env.AWS_ACCESS_KEY_ID?.trim()) return "AWS_ACCESS_KEY_ID";
  return "default chain";
}

export function archiveConfig(): ArchiveConfig | null {
  const bucket = process.env.S3_BUCKET?.trim();
  // `S3_REGION` wins because it names this integration; `AWS_REGION` is the name
  // the SDK and every AWS tool already use, so honour it too rather than making a
  // deployment set the same value twice.
  const region = (process.env.S3_REGION?.trim() || process.env.AWS_REGION?.trim()) ?? "";
  if (!bucket || !region) return null;

  const prefix = (process.env.S3_PREFIX?.trim() || DEFAULT_PREFIX).replace(/^\/+|\/+$/g, "");
  return { bucket, region, prefix: prefix || DEFAULT_PREFIX };
}

export function archiveConfigured(): boolean {
  return archiveConfig() !== null;
}

/**
 * Clients are cached per bucket+region on `globalThis` so a development reload
 * reuses the connection pool instead of building a new one per module instance —
 * the same reason a database client is parked there. Nothing about the client is
 * a secret: it holds no credentials of its own, only the provider chain.
 */
const clientCache = globalThis as unknown as { __ecoeprS3Clients?: Map<string, S3Client> };

function clientFor(config: ArchiveConfig): S3Client {
  clientCache.__ecoeprS3Clients ??= new Map();
  const credentials = explicitCredentials();
  // The credential *source* is part of the key, not the values: a client built for
  // one source must not be handed back for another, and a secret has no business
  // being a map key.
  const cacheKey = `${config.bucket}:${config.region}:${credentials ? "explicit" : "chain"}`;
  const existing = clientCache.__ecoeprS3Clients.get(cacheKey);
  if (existing) return existing;

  const client = new S3Client({
    region: config.region,
    ...(credentials ? { credentials } : {}),
  });
  clientCache.__ecoeprS3Clients.set(cacheKey, client);
  return client;
}

/**
 * The client the app itself uses, and the configuration behind it.
 *
 * Exported so `s3:check` can verify the identity the routes actually run as, instead of
 * building a second client with its own idea of credentials. That difference is not
 * academic: the first version of the check did build its own, which quietly fell back to
 * the machine's admin profile, and it reported that the app's key could write outside
 * its prefix when the app's key could not. A check that authenticates as something
 * other than the thing under test is worse than no check.
 */
export function archiveClient(): { client: S3Client; config: ArchiveConfig } | null {
  const config = archiveConfig();
  if (!config) return null;
  return { client: clientFor(config), config };
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/flac": "flac",
};

/**
 * A real extension for the types the routes accept, and an honest `bin` for
 * anything else. The extension is for a human reading the bucket listing, never
 * for the app: the MIME type is stored as object metadata, so nothing downstream
 * has to guess from a suffix.
 */
export function extensionFor(mimeType: string): string {
  return EXTENSIONS[mimeType.toLowerCase().split(";")[0].trim()] ?? "bin";
}

/**
 * `media/<first two hex digits>/<sha256>.<ext>`.
 *
 * The two-character fan-out keeps any one prefix listing bounded, which is the
 * usual reason object stores are keyed this way. Every byte of identity in the key
 * comes from the content; nothing in it comes from the request, the clock or the
 * user, so two collectors submitting the same photograph land on the same object.
 */
export function mediaKey(prefix: string, checksumHex: string, mimeType: string): string {
  return `${prefix}/${checksumHex.slice(0, 2)}/${checksumHex}.${extensionFor(mimeType)}`;
}

/**
 * Base64 to bytes, rejecting anything that decodes to nothing. `readPayload` has
 * already checked the alphabet and the size, so this is a last guard against
 * archiving an empty object under a checksum of empty bytes.
 */
function decode(media: ArchiveMediaInput): Buffer {
  const bytes = Buffer.from(media.dataBase64.replace(/\s+/g, ""), "base64");
  if (bytes.length === 0) {
    throw new Error(`${media.mimeType} decoded to zero bytes, so there was nothing to archive.`);
  }
  return bytes;
}

/**
 * How long one object write may take before it is abandoned.
 *
 * Not a preference: Amplify Hosting cuts a server-rendered request off at around
 * thirty seconds, and `lib/ai/gemini.ts` deliberately spends up to 26 of them on
 * the model. Two uploads run beside that call rather than after it, so the ceiling
 * on their wait is what keeps the whole request inside the host's limit — storage
 * must not be the thing that turns a working analysis into a bare 504.
 */
const PUT_TIMEOUT_MS = 8_000;

/**
 * Archive every part of one request, in parallel, without ever rejecting.
 *
 * An unconfigured archive is not an error: it returns `configured: false` with no
 * objects, which is what lets the AI routes keep working on a laptop with no AWS
 * credentials — the same posture `aiConfigured()` already takes for the model.
 */
export async function archiveMediaParts(requests: ArchiveRequest[]): Promise<ArchiveOutcome> {
  const config = archiveConfig();
  if (!config) {
    return { configured: false, bucket: null, credentialSource: credentialSource(), objects: [], error: null };
  }
  if (requests.length === 0) {
    return { configured: true, bucket: config.bucket, credentialSource: credentialSource(), objects: [], error: null };
  }

  const client = clientFor(config);

  const settled = await Promise.allSettled(
    requests.map(async ({ kind, media }): Promise<ArchivedObject> => {
      const bytes = decode(media);
      const checksumHex = createHash("sha256").update(bytes).digest("hex");
      const key = mediaKey(config.prefix, checksumHex, media.mimeType);

      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: bytes,
          ContentType: media.mimeType,
          // Verified by S3 on write: a body that does not match this digest is
          // refused, so the archive cannot silently hold half a photograph.
          ChecksumSHA256: createHash("sha256").update(bytes).digest("base64"),
          // No `ServerSideEncryption` here on purpose. The bucket default is
          // AES-256 and is enforced by the bucket, so naming it per object would
          // only pin the archive to today's setting: switch the default to a KMS
          // key and these calls would keep overriding it.
          Metadata: {
            kind,
            // The hex digest as metadata is for the console reader; the column in
            // `media_assets` is written from the same value by the caller.
            sha256: checksumHex,
            app: "impactproof",
          },
          CacheControl: "private, no-store",
        }),
        // The deadline is per object, and the parts run concurrently, so two large
        // attachments cost one wait rather than two.
        { abortSignal: AbortSignal.timeout(PUT_TIMEOUT_MS) },
      );

      return {
        kind,
        bucket: config.bucket,
        key,
        mimeType: media.mimeType,
        byteSize: bytes.length,
        checksumSha256: checksumHex,
      };
    }),
  );

  const objects: ArchivedObject[] = [];
  const failures: string[] = [];
  for (const [index, result] of settled.entries()) {
    if (result.status === "fulfilled") {
      objects.push(result.value);
      continue;
    }
    const kind = requests[index]?.kind ?? "media";
    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    // The key and the reason, never the bytes and never a credential.
    console.error(`[s3] archiving the ${kind} failed`, message);
    failures.push(`${kind}: ${message.slice(0, 200)}`);
  }

  return {
    configured: true,
    bucket: config.bucket,
    credentialSource: credentialSource(),
    objects,
    error: failures.length > 0 ? failures.join("; ") : null,
  };
}

/** True when the request carries anything worth keeping. */
export function archiveRequests(payload: {
  photo?: ArchiveMediaInput;
  audio?: ArchiveMediaInput;
}): ArchiveRequest[] {
  const requests: ArchiveRequest[] = [];
  if (payload.photo) requests.push({ kind: "photo", media: payload.photo });
  if (payload.audio) requests.push({ kind: "voice", media: payload.audio });
  return requests;
}

/**
 * The sentence a screen should show when the archive is off or a write failed.
 *
 * Kept beside the outcome rather than in the routes so all three of them tell the
 * operator the same thing about the same event.
 */
export function archiveWarning(outcome: ArchiveOutcome): string | null {
  if (!outcome.configured) return null;
  if (outcome.error) {
    return `The submission was analysed but not archived: ${outcome.error}. The evidence is not in S3, so this valuation has no photograph behind it.`;
  }
  return null;
}
