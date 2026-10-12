import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { database, databaseConfigured } from "@/db/client";
import { eprCreditNotes, intakes, items, mediaAssets, users } from "@/db/schema";
import type { Scope } from "@/lib/auth/scope";
import type { EvidenceAsset, VoiceNote } from "@/lib/types";

import {
  archiveMediaParts,
  type ArchiveOutcome,
  type ArchiveRequest,
  type ArchivedObject,
  type MediaKind,
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
  /**
   * Photo or voice, as stored.
   *
   * Carried so the submission that is written next can name its primary asset — the
   * photograph — without a second read whose answer the caller already holds.
   */
  kind: MediaKind;
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
      .select({ id: mediaAssets.id, storageKey: mediaAssets.storageKey, kind: mediaAssets.kind })
      .from(mediaAssets)
      .where(inArray(mediaAssets.storageKey, objects.map((object) => object.key)));

    return {
      configured: true,
      records: rows.map((row) => ({
        storageKey: row.storageKey,
        id: row.id,
        inserted: created.has(row.storageKey),
        kind: row.kind,
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
 * Write the recogniser's transcript back onto the voice asset it belongs to.
 *
 * The archive runs *beside* the model call, so when the row is written the transcript
 * does not exist yet — it is a product of the analysis, not of the bytes. `media_assets`
 * has carried `language`, `duration_seconds`, `transcript`, `translation` and `word_count`
 * columns since the schema was written and nothing filled them, which is why a screen
 * reading a stored voice submission back could not show what the collector said. This is
 * the one write that closes it.
 *
 * Keyed by the content-addressed storage key, so it targets the object the row already
 * describes and can never attach a transcript to a different clip. Like every write on
 * this path it reports and never throws: a stored transcript is worth having, and not
 * worth failing a price the operator has already paid for.
 */
export async function recordTranscript(
  storageKey: string,
  note: VoiceNote,
): Promise<{ configured: boolean; error: string | null }> {
  if (!databaseConfigured()) return { configured: false, error: null };
  const connection = database();
  if (!connection) return { configured: false, error: null };

  try {
    await connection.db
      .update(mediaAssets)
      .set({
        language: note.language,
        durationSeconds: note.durationSeconds,
        transcript: note.transcript,
        translation: note.translation,
        wordCount: note.words,
      })
      .where(eq(mediaAssets.storageKey, storageKey));
    return { configured: true, error: null };
  } catch (error) {
    const cause =
      error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
    const message = (cause ?? (error instanceof Error ? error.message : String(error)))
      .replace(/\s+/g, " ")
      .trim();
    console.error("[db] recording the transcript failed", message);
    return { configured: true, error: message.slice(0, 200) };
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

/**
 * The most recent objects in the archive, newest first — what a screen lists.
 *
 * A read, not a report. It carries no totals, because a total over a bounded window
 * reads as a total over the whole archive: the real count is a different query, and a
 * number that means two things is worse than no number.
 *
 * The uploader is resolved through `users.full_name` and is `null` far more often than
 * not, which is the honest answer rather than a placeholder name. Nothing creates a
 * `users` row on sign-in yet — `users.full_name` is `NOT NULL`, so provisioning is
 * genuinely a separate piece of work — and the column is nullable for exactly that
 * reason.
 *
 * The submission is joined in for the same reason the screen exists: an operator asking
 * "what is this photograph" is one question, and "which submission did it produce, and
 * what was that priced as" is the question they actually have. `intakes_code_uq` is what
 * makes that join an index read rather than a report.
 */
export interface MediaAssetListing {
  /** False when there is no `DATABASE_URL`: rows were never recorded, so nothing lists. */
  configured: boolean;
  assets: EvidenceAsset[];
  /** Set when the database was configured and the read still failed. Never thrown. */
  error: string | null;
}

/** Bounded so a screen cannot ask for the whole table by accident. */
const LIST_LIMIT_MAX = 60;

const LIST_LIMIT_DEFAULT = 24;

/**
 * The columns a screen reads, defined once.
 *
 * The listing and the id lookup below must describe an object the same way: the same
 * photograph reached by scrolling the archive and by pasting the id behind it has to
 * read identically, and one column list is what keeps the two from drifting.
 */
const assetColumns = {
  id: mediaAssets.id,
  storageKey: mediaAssets.storageKey,
  kind: mediaAssets.kind,
  mimeType: mediaAssets.mimeType,
  byteSize: mediaAssets.byteSize,
  checksumSha256: mediaAssets.checksumSha256,
  uploadedAt: mediaAssets.uploadedAt,
  uploaderName: users.fullName,
  // The submission this object produced, and the id it was priced under. Null for
  // everything archived before submissions were recorded, and for the clip beside a
  // photograph — `intakes_media_uq` links one asset per submission.
  submissionCode: intakes.code,
  submittedAt: intakes.submittedAt,
};

/** One row of that column set, as the driver hands it back. */
type AssetRow = {
  id: string;
  storageKey: string;
  kind: MediaKind;
  mimeType: string | null;
  byteSize: number | null;
  checksumSha256: string | null;
  uploadedAt: Date;
  uploaderName: string | null;
  submissionCode: string | null;
  submittedAt: Date | null;
};

/** The row, shaped for the client viewer — the one place its timestamps become ISO. */
function toAsset(row: AssetRow): EvidenceAsset {
  return {
    id: row.id,
    storageKey: row.storageKey,
    kind: row.kind,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    checksumSha256: row.checksumSha256,
    uploadedAt: row.uploadedAt.toISOString(),
    uploaderName: row.uploaderName,
    submissionCode: row.submissionCode,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
  };
}

/**
 * The evidence a scope reaches.
 *
 * The archive is the Operator's and the Admin's working record, so `all` reads it whole.
 * A Viewer reads only the evidence behind the credits their brand claimed: the media of
 * the submissions whose items an `epr_credit_notes` row names the brand on. Nothing writes
 * that table yet, so today a Viewer's archive says so in a sentence instead of listing
 * nothing. The other scopes cannot open `/evidence`, and are refused here as well, so
 * this read cannot be the hole a page guard forgot.
 */
type EvidenceFilter =
  | { kind: "all" }
  | { kind: "some"; mediaIds: string[] }
  | { kind: "refused"; message: string };

export const NO_CLAIM_ON_FILE =
  "No claim on file: this brand has no EPR credit note yet, so no evidence is claimed by it. The evidence behind an item appears here once a credit note names the brand.";

async function evidenceFilter(
  db: NonNullable<ReturnType<typeof database>>["db"],
  scope: Scope,
): Promise<EvidenceFilter> {
  switch (scope.kind) {
    case "all":
      return { kind: "all" };
    case "unresolved":
      return { kind: "refused", message: scope.reason };
    case "collector":
    case "facility":
      return {
        kind: "refused",
        message: "The evidence archive is read by an Operator, an Admin or a brand's Viewer; this account's scope reaches none of it.",
      };
    case "brand": {
      const rows = await db
        .select({ mediaId: intakes.mediaId })
        .from(eprCreditNotes)
        .innerJoin(items, eq(items.id, eprCreditNotes.itemId))
        .innerJoin(intakes, eq(intakes.id, items.intakeId))
        .where(eq(eprCreditNotes.brandOrganizationId, scope.organizationId));
      if (rows.length === 0) return { kind: "refused", message: NO_CLAIM_ON_FILE };
      return { kind: "some", mediaIds: rows.map((row) => row.mediaId) };
    }
  }
}

function withinMedia(filter: EvidenceFilter): SQL | undefined {
  if (filter.kind !== "some") return undefined;
  return filter.mediaIds.length ? inArray(mediaAssets.id, filter.mediaIds) : sql`false`;
}

/**
 * Whether a scope may read the object behind `storageKey`. `all` is answered without a
 * query, so the Operator's read keeps working when a row write failed beside a good object
 * (`app/api/media/read/route.ts`, decision 2); a narrower scope has to find the key among
 * the rows it reaches, because for it the row *is* the permission.
 */
export async function mayReadMediaKey(
  scope: Scope,
  storageKey: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (scope.kind === "all") return { ok: true };
  const connection = databaseConfigured() ? database() : null;
  if (!connection) return { ok: false, message: "There is no database to check this evidence against, so it cannot be read." };
  try {
    const filter = await evidenceFilter(connection.db, scope);
    if (filter.kind === "refused") return { ok: false, message: filter.message };
    const [row] = await connection.db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.storageKey, storageKey), withinMedia(filter)))
      .limit(1);
    return row ? { ok: true } : { ok: false, message: "This evidence is not among the credits this brand has claimed." };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim();
    console.error("[db] checking an evidence read against its scope failed", message);
    return { ok: false, message: "The evidence could not be checked against this account's scope, so it was not read." };
  }
}

export async function listEvidence(
  scope: Scope,
  limit: number = LIST_LIMIT_DEFAULT,
): Promise<MediaAssetListing> {
  if (!databaseConfigured()) return { configured: false, assets: [], error: null };
  const connection = database();
  if (!connection) return { configured: false, assets: [], error: null };

  const bounded = Math.min(Math.max(Math.round(limit), 1), LIST_LIMIT_MAX);

  try {
    const filter = await evidenceFilter(connection.db, scope);
    if (filter.kind === "refused") return { configured: true, assets: [], error: filter.message };
    const rows = await connection.db
      .select(assetColumns)
      .from(mediaAssets)
      // Left, not inner: evidence with no attributed uploader is still evidence, and an
      // inner join would silently hide every row the missing provisioning affects.
      .leftJoin(users, eq(users.id, mediaAssets.uploaderUserId))
      // Left for the same reason, one table further on: an object with no submission row
      // is listed and says so, rather than disappearing from the archive because the join
      // went missing. The join cannot fan out — `intakes_media_uq` makes `media_id`
      // unique — so a row here is still one asset.
      .leftJoin(intakes, eq(intakes.mediaId, mediaAssets.id))
      .where(withinMedia(filter))
      // `media_assets_uploaded_idx` covers this ordering, so the screen walks an index
      // rather than sorting the table.
      .orderBy(desc(mediaAssets.uploadedAt))
      .limit(bounded);

    return {
      configured: true,
      assets: rows.map(toAsset),
      error: null,
    };
  } catch (error) {
    // The inner cause, for the same reason the write path reports it: Drizzle wraps a
    // driver failure in the whole statement plus its parameters, and the part worth
    // reading — "connect ETIMEDOUT" — is one level down in `cause`.
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
    const message = (cause ?? (error instanceof Error ? error.message : String(error)))
      .replace(/\s+/g, " ")
      .trim();
    console.error("[db] listing the archived media failed", message);
    return { configured: true, assets: [], error: message.slice(0, 200) };
  }
}

/**
 * The archive read from the other end: the object behind the id a valuation carries.
 *
 * `listEvidence` answers "what was archived lately", which is the wrong
 * question for the operator holding an id off a priced result and asking what is behind
 * it. That id is `intakes.code` — the string every screen shows for the valuation — and
 * `intakes_code_uq` is what makes this one indexed read rather than a scan of the
 * submission half of the archive.
 *
 * Deliberately not a search: an exact id, one row, no wildcards. A lookup that guessed
 * at near-matches would hand an operator the photograph behind somebody else's
 * submission, which is the one mistake this screen must not make.
 *
 * It starts at `intakes` and joins *in* to the asset, where the listing starts at the
 * asset and joins out. A submission cannot exist without the object it points at
 * (`media_id` is `NOT NULL`), so the inner join here loses nothing; the listing's left
 * joins exist because an object can outlive its submission.
 */
export interface MediaAssetLookup {
  /** False when there is no `DATABASE_URL`: there is nothing to look an id up in. */
  configured: boolean;
  /**
   * The archived object the submission points at, or `null` when no submission row holds
   * that id — an answer, not a failure, and the screen says so in those words.
   */
  asset: EvidenceAsset | null;
  /** `intakes.summary` — the one line the submission kept about what it was. */
  summary: string | null;
  /** Set when the database was configured and the read still failed. Never thrown. */
  error: string | null;
}

/**
 * Long enough for any id this app mints, short enough that a pasted paragraph is not a
 * query: `intakes.code` is `text`, so nothing upstream stops a caller sending a novel.
 */
const LOOKUP_CODE_MAX = 120;

export async function findMediaAssetBySubmissionCode(
  scope: Scope,
  code: string,
): Promise<MediaAssetLookup> {
  if (!databaseConfigured()) return { configured: false, asset: null, summary: null, error: null };
  const connection = database();
  if (!connection) return { configured: false, asset: null, summary: null, error: null };

  const wanted = code.trim().slice(0, LOOKUP_CODE_MAX);
  // An empty box is not a failed lookup. Reported as `configured: true` with no asset, so
  // the screen can tell "you have not asked yet" apart from "the database is off".
  if (!wanted) return { configured: true, asset: null, summary: null, error: null };

  try {
    const filter = await evidenceFilter(connection.db, scope);
    if (filter.kind === "refused") return { configured: true, asset: null, summary: null, error: filter.message };
    // Out of scope reads as not found, so a pasted id cannot reveal that a submission exists.
    const [row] = await connection.db
      .select({ ...assetColumns, summary: intakes.summary })
      .from(intakes)
      .innerJoin(mediaAssets, eq(mediaAssets.id, intakes.mediaId))
      .leftJoin(users, eq(users.id, mediaAssets.uploaderUserId))
      .where(and(eq(intakes.code, wanted), withinMedia(filter)))
      .limit(1);

    if (!row) return { configured: true, asset: null, summary: null, error: null };
    return { configured: true, asset: toAsset(row), summary: row.summary, error: null };
  } catch (error) {
    // The inner cause, for the same reason the listing reports it: Drizzle wraps a driver
    // failure in the whole statement plus its parameters, and the part worth reading —
    // "connect ETIMEDOUT" — is one level down in `cause`.
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
    const message = (cause ?? (error instanceof Error ? error.message : String(error)))
      .replace(/\s+/g, " ")
      .trim();
    console.error("[db] looking the archived media up by submission id failed", message);
    return { configured: true, asset: null, summary: null, error: message.slice(0, 200) };
  }
}
