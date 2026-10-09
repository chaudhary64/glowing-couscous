import { eq, inArray } from "drizzle-orm";

import { database, databaseConfigured } from "@/db/client";
import { mediaAssets, users } from "@/db/schema";

import {
  archiveMediaParts,
  type ArchiveOutcome,
  type ArchiveRequest,
  type ArchivedObject,
} from "./archive";

/**
 * The database half of the archive: one `media_assets` row per object written.
 *
 * Until now the response carried a storage key and nothing inserted the row, so
 * `media_assets.storage_key` — a column with a unique index whose entire purpose is
 * derived identity — held nothing, and the evidence a price came from could only be
 * found by recomputing a SHA-256 by hand. This writes the row, which is what makes a
 * content-addressed key usable: given the key, the row says what it *was*(a photo or
 * a voice note, of what size, submitted by whom, when).
 *
 * Four decisions carry this file:
 *
 * 1. **The row is a record of the object, never a gate on it.** The write happens after
 *    the bytes are already in S3, and a failure here is reported in `records.error`. It
 *    does not delete the object, does not throw, and does not turn a paid-for analysis
 *    into an error page. The reverse order would be worse: a row pointing at an object
 *    that was never written is a lie the database would tell forever.
 *
 * 2. **Idempotent, because the key is.** `media_assets_storage_key_uq` is a real unique
 *    index, so the insert leans on it with `ON CONFLICT DO NOTHING`. The same photograph
 *    submitted twice is one object *and* one row, and a retry whose response was lost
 *    cannot manufacture a second row claiming a second upload.
 *
 * 3. **No `DATABASE_URL` is `configured: false`, not an error.** The same posture as the
 *    archive and the model: an integration that is switched off says so, and the request
 *    still answers.
 *
 * 4. **Attribution is resolved, not assumed.** The session carries a Cognito `sub`;
 *    `media_assets.uploader_user_id` is a `users.id`. They are joined by
 *    `users.cognito_sub`, and when no row exists yet the column stays `null` — which the
 *    schema already allows, because a voice note arrives through an operator's phone for
 *    a collector who has no account at all.
 *
 * Nothing in this file imports `next/*`: the storage layer is exercised from Node by
 * `npm run s3:check`, and a module that drags the request runtime in cannot be. For the
 * same reason it stays clear of `next/*` in its *dependencies* too — see
 * `scripts/ts-paths.mjs` for the resolver that lets that check import this file at all.
 */

/** Who to credit for the upload, as the session knows them. */
export interface MediaAttribution {
  /** The signed-in user's Cognito subject; resolved to `users.id` when a row exists. */
  uploaderCognitoSub?: string | null;
  /** A `collectors.id`, when the submission was made on a known collector's behalf. */
  collectorId?: string | null;
}

/** One row, as it stands after the write. */
export interface MediaRecord {
  storageKey: string;
  /** `media_assets.id` — the surrogate key a screen would link to. */
  id: string;
  /** True when this call created the row; false when it was already there. */
  inserted: boolean;
}

export interface MediaRecordOutcome {
  /** False when there is no `DATABASE_URL`: the recording is off, not broken. */
  configured: boolean;
  records: MediaRecord[];
  /** Set when the database was configured and the write still failed. Never thrown. */
  error: string | null;
}

/**
 * The sentence a screen should show when the archive was written to S3 but the row was
 * not recorded.
 *
 * Worth saying out loud, because the object exists and only the record of it is
 * missing: a later reader looking the key up in `media_assets` finds nothing, so the
 * failure has to be visible while the operator is still looking at the submission.
 */
export function recordWarning(outcome: MediaRecordOutcome): string | null {
  if (!outcome.configured) return null;
  if (outcome.error) {
    return `The evidence was archived but not recorded in the database: ${outcome.error}. The file is in S3 under its key; nothing can find it from a valuation until the row exists.`;
  }
  return null;
}

/**
 * Resolve the session's Cognito subject to a `users.id`, or `null`.
 *
 * `null` is a normal answer, not a failure: no user row is created here because
 * creating one is provisioning (`users.full_name` is `NOT NULL`), which is a different
 * piece of work than keeping evidence. The column is nullable for exactly this reason.
 */
async function resolveUploader(
  db: NonNullable<ReturnType<typeof database>>["db"],
  cognitoSub: string | null | undefined,
): Promise<string | null> {
  if (!cognitoSub) return null;
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.cognitoSub, cognitoSub))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Write one row per archived object, and report what the table holds afterwards.
 *
 * Two statements, in this order: an insert that ignores a key it already has, then a
 * read of every key this call touched. The read is what makes the result honest for a
 * retry — the insert returns only the rows it created, so a second identical submission
 * would otherwise report nothing while the row is plainly there.
 */
export async function recordArchivedObjects(
  objects: ArchivedObject[],
  attribution: MediaAttribution = {},
): Promise<MediaRecordOutcome> {
  if (!databaseConfigured()) return { configured: false, records: [], error: null };
  if (objects.length === 0) return { configured: true, records: [], error: null };

  const connection = database();
  if (!connection) return { configured: false, records: [], error: null };

  try {
    const uploaderUserId = await resolveUploader(connection.db, attribution.uploaderCognitoSub);

    const inserted = await connection.db
      .insert(mediaAssets)
      .values(
        objects.map((object) => ({
          kind: object.kind,
          storageKey: object.key,
          mimeType: object.mimeType,
          byteSize: object.byteSize,
          checksumSha256: object.checksumSha256,
          uploaderUserId,
          collectorId: attribution.collectorId ?? null,
          // The bytes are in S3 by the time this runs, so "uploaded" is now.
          uploadedAt: new Date(),
        })),
      )
      // The unique index is the idempotence: content-addressed keys mean a retry is
      // the same row, and DO NOTHING is what keeps the second attempt from failing.
      .onConflictDoNothing({ target: mediaAssets.storageKey })
      .returning({ id: mediaAssets.id, storageKey: mediaAssets.storageKey });

    const created = new Set(inserted.map((row) => row.storageKey));
    const rows = await connection.db
      .select({ id: mediaAssets.id, storageKey: mediaAssets.storageKey })
      .from(mediaAssets)
      .where(inArray(mediaAssets.storageKey, objects.map((object) => object.key)));

    return {
      configured: true,
      records: rows.map((row) => ({
        storageKey: row.storageKey,
        id: row.id,
        inserted: created.has(row.storageKey),
      })),
      error: null,
    };
  } catch (error) {
    // The inner cause, not the wrapper. Drizzle wraps a driver failure in a message that
    // is the whole `insert into "media_assets" (…) values (…)` statement followed by its
    // parameters — a wall of SQL whose only useful part, "connect ETIMEDOUT" or
    // "password authentication failed", is one level down in `cause`. That wrapper would
    // be what an operator read in the warning sentence, so the cause is what is reported.
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
    const message = (cause ?? (error instanceof Error ? error.message : String(error)))
      .replace(/\s+/g, " ")
      .trim();
    console.error("[db] recording the archived media failed", message);
    return { configured: true, records: [], error: message.slice(0, 200) };
  }
}

/**
 * Archive the parts of one request, then record them. What the routes call.
 *
 * Sequenced deliberately: the rows describe objects that must already exist, so the
 * record step cannot start until the archive has finished. Both are awaited by the
 * caller before it answers, because work still in flight when the response is written
 * can be cut off with it on this host.
 */
export async function archiveAndRecord(
  requests: ArchiveRequest[],
  attribution: MediaAttribution = {},
): Promise<{ storage: ArchiveOutcome; records: MediaRecordOutcome | null }> {
  const storage = await archiveMediaParts(requests);
  // Nothing was written, so there is nothing to record — and an unconfigured archive
  // must not produce a database message about a bucket that was never used.
  if (storage.objects.length === 0) {
    return { storage, records: storage.configured ? await recordArchivedObjects([], attribution) : null };
  }
  return { storage, records: await recordArchivedObjects(storage.objects, attribution) };
}

/**
 * Remove rows for the given keys, returning how many went.
 *
 * Exists for `npm run s3:check`, which has to leave the table as it found it, and for
 * an operator cleaning up after a failed probe. It is not a retention policy: deleting
 * evidence is a compliance decision, and `intakes.media_id` is a `restrict` foreign key
 * precisely so that ordinary deletion cannot do it by accident.
 */
export async function forgetMediaRecords(keys: string[]): Promise<number> {
  if (keys.length === 0) return 0;
  const connection = database();
  if (!connection) return 0;
  const removed = await connection.db
    .delete(mediaAssets)
    .where(inArray(mediaAssets.storageKey, keys))
    .returning({ id: mediaAssets.id });
  return removed.length;
}
