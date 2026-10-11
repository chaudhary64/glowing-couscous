import { eq, inArray } from "drizzle-orm";

import { database, databaseConfigured } from "@/db/client";
import { intakes, mediaAssets } from "@/db/schema";
import { formatMass } from "@/lib/format";

import type { MediaKind } from "./archive";
import type { MediaRecord } from "./media-assets";

/**
 * The submission half of the archive: one `intakes` row per priced request.
 *
 * `media_assets` answers "what is this object". It does not answer "whose submission
 * was it, and what did it become", which is the question a reviewer actually asks —
 * and until this file existed the archive could only be searched by recomputing a
 * SHA-256 by hand. `intakes.media_id` has been sitting there as a `restrict` foreign
 * key waiting for exactly this write.
 *
 * Four decisions carry the file:
 *
 * 1. **The row is written after the price, not beside the bytes.** The bytes are
 *    archived in parallel with the model call, but a submission is only a submission
 *    once something has priced it: `code` below *is* the identity the priced result
 *    carries, so there is nothing to write until the model has answered. A request
 *    whose analysis failed keeps its objects and their `media_assets` rows and gets no
 *    intake row — there is no price for it to be found from, and inventing an id would
 *    be the one thing this row must never do.
 *
 * 2. **The code is the id already on screen.** A live submission is known by
 *    `LIVE-2026-04318826` (`AiAnalysis.id`, shown by every screen that renders a live
 *    result), so the row is stored under that string and an operator holding a
 *    valuation can look its evidence up in one indexed read on `intakes_code_uq`.
 *    Minting a second, separate sample id would give one submission two names, and
 *    neither of them would be the one the person is looking at. One submission
 *    resolves to one item, so the item that lands later carries the same identity
 *    rather than a copy of it.
 *
 * 3. **One asset per submission, and it is the primary one.** `intakes_media_uq` makes
 *    `media_id` unique, so a photograph with a voice note beside it is one submission
 *    pointing at the photograph; the clip is archived and listed, but not separately
 *    joined. That is the schema's decision, restated here rather than worked around,
 *    and this file reports which key it linked so a screen can say the same thing.
 *
 * 4. **Nothing here decides whether a request succeeds.** Same bargain as the archive
 *    and the media row: a missing `DATABASE_URL` is `configured: false`, a failure is
 *    returned in `error` and logged, and a paid-for analysis is never turned into an
 *    error page because a row could not be written.
 *
 * The collector on the row is nullable, and null is the honest answer: the request
 * arriving at `/api/ai/*` carries a session for the operator and nothing at all about
 * the person who owns the material. Collectors are provisioned separately, and
 * `collectors.user_id` is the column that will connect the two when that lands.
 */

/** What a route knows about a submission once the model has answered. */
export interface SubmissionInput {
  /** The `media_assets` rows the archive wrote for this request. */
  records: MediaRecord[];
  /** The identity the priced result carries — `AiAnalysis.id`. */
  pricedCode: string;
  /** What the model read the item to be, for the one line an operator sees. */
  label: string;
  massGrams: number;
  /** How it was read. All three columns exist for this and are nullable. */
  extraction?: {
    model?: string | null;
    confidence?: number | null;
    latencyMs?: number | null;
  };
  /** A `collectors.id`, when the submission was made on a known collector's behalf. */
  collectorId?: string | null;
}

/** The row, as it stands after the write. */
export interface SubmissionRecord {
  id: string;
  code: string;
  /** The archived object this submission points at, by its content-addressed key. */
  storageKey: string;
  /** The asset's own kind, which is also the submission's `mode`. */
  mode: MediaKind;
  /** True when this call created the row; false when it was already there. */
  created: boolean;
}

export interface SubmissionOutcome {
  /** False when there is no `DATABASE_URL`: nothing is recorded, nothing is broken. */
  configured: boolean;
  submission: SubmissionRecord | null;
  /** Set when the database was configured and the write still failed. Never thrown. */
  error: string | null;
}

/**
 * The sentence a screen should show when the object was archived but the submission
 * was not recorded.
 *
 * Worth its own wording because the two failures have different repairs: no media row
 * means nothing can list the object at all, while no intake row means the object is
 * listed and cannot be found *from* the valuation, which is the whole point of the row.
 */
export function submissionWarning(outcome: SubmissionOutcome): string | null {
  if (!outcome.configured) return null;
  if (outcome.error) {
    return `The submission was archived and priced but not recorded: ${outcome.error}. The photograph is in S3 under its key and the valuation is priced, but nothing joins the two yet.`;
  }
  return null;
}

/** "Dell laptop mainboard, 1.45 kg" — the one line the row keeps about the item. */
function submissionSummary(label: string, massGrams: number): string {
  const named = label.trim();
  return named ? `${named}, ${formatMass(massGrams)}` : formatMass(massGrams);
}

/**
 * The primary asset of a request: the photograph when there is one, otherwise the
 * clip.
 *
 * The photograph wins because it is what the item was identified from and what a
 * reviewer asks to see; a voice note beside it is the collector's words *about* the
 * thing in the frame, not a second submission. This is the same choice
 * `analyseIntake` makes when it decides an intake's mode.
 */
function primaryRecord(records: MediaRecord[]): MediaRecord | null {
  return records.find((record) => record.kind === "photo") ?? records[0] ?? null;
}

/**
 * Confidence, as the `numeric(4,3)` column wants it: a string, to three places.
 *
 * Stored exactly as the model reported it. Clamping here would turn an out-of-range
 * answer into a respectable-looking one, and the column is wide enough that an absurd
 * value fails loudly at the insert instead of being quietly rounded into the scale.
 */
function confidenceValue(confidence: number | null | undefined): string | null {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) return null;
  return confidence.toFixed(3);
}

/**
 * Record one submission, and report what the table holds afterwards.
 *
 * Two statements, in this order: an insert that yields to any unique index it collides
 * with, then a read of the row for the asset this call archived. The read is what makes
 * the answer honest for a retry — the insert returns only the rows it created — and it
 * is also how a collision is detected at all: if the priced id is already held by a
 * different submission, nothing is written for this asset and `error` says so instead
 * of the row silently pointing at somebody else's evidence.
 */
export async function recordSubmission(input: SubmissionInput): Promise<SubmissionOutcome> {
  if (!databaseConfigured()) return { configured: false, submission: null, error: null };

  const primary = primaryRecord(input.records);
  // Nothing was archived, so there is no object to point at and no row to write:
  // `media_id` is `NOT NULL`, and a submission with no evidence is not a submission.
  if (!primary) return { configured: true, submission: null, error: null };

  const connection = database();
  if (!connection) return { configured: false, submission: null, error: null };

  try {
    const inserted = await connection.db
      .insert(intakes)
      .values({
        code: input.pricedCode,
        // Null is the honest answer, not a gap: see the note at the top of the file.
        collectorId: input.collectorId ?? null,
        mode: primary.kind,
        mediaId: primary.id,
        summary: submissionSummary(input.label, input.massGrams),
        submittedAt: new Date(),
        extractionModel: input.extraction?.model ?? null,
        extractionConfidence: confidenceValue(input.extraction?.confidence),
        extractionLatencyMs: input.extraction?.latencyMs ?? null,
      })
      // Two unique indexes can refuse this row and both refusals are ordinary:
      // `intakes_media_uq` because a retry of the same bytes is the same submission,
      // and `intakes_code_uq` because an identical item priced twice is reported by the
      // same id. DO NOTHING keeps the first from failing; the read below tells the two
      // apart, which a targeted `target:` could not do in one statement.
      .onConflictDoNothing()
      .returning({ id: intakes.id, code: intakes.code });

    const created = inserted.some((row) => row.code === input.pricedCode);

    const [row] = await connection.db
      .select({ id: intakes.id, code: intakes.code })
      .from(intakes)
      .where(eq(intakes.mediaId, primary.id))
      .limit(1);

    if (!row) {
      // The insert was refused because the id is already held by another submission, so
      // this asset is archived and listed but joined to nothing. Said out loud rather
      // than left as a missing join.
      return {
        configured: true,
        submission: null,
        error: `the submission id ${input.pricedCode} already belongs to another submission, so this object was not joined to one`,
      };
    }

    return {
      configured: true,
      submission: {
        id: row.id,
        code: row.code,
        storageKey: primary.storageKey,
        mode: primary.kind,
        created,
      },
      error: null,
    };
  } catch (error) {
    // The inner cause, not the wrapper — the same reason the media write reports it:
    // Drizzle wraps a driver failure in the whole statement plus its parameters, and the
    // part worth reading ("connect ETIMEDOUT") is one level down in `cause`.
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
    const message = (cause ?? (error instanceof Error ? error.message : String(error)))
      .replace(/\s+/g, " ")
      .trim();
    console.error("[db] recording the submission failed", message);
    return { configured: true, submission: null, error: message.slice(0, 200) };
  }
}

/**
 * Remove the submissions that point at the given objects, returning how many went.
 *
 * Exists for `npm run s3:check`, which has to leave both tables as it found them — and
 * which cannot simply delete the media rows first, because `intakes.media_id` is a
 * `restrict` foreign key: the whole point of that constraint is that the evidence a
 * decision was taken on cannot be removed from under it. Like `forgetMediaRecords`,
 * this is cleanup for a probe and not a retention policy.
 */
export async function forgetSubmissions(storageKeys: string[]): Promise<number> {
  if (storageKeys.length === 0) return 0;
  const connection = database();
  if (!connection) return 0;
  const removed = await connection.db
    .delete(intakes)
    .where(
      inArray(
        intakes.mediaId,
        connection.db
          .select({ id: mediaAssets.id })
          .from(mediaAssets)
          .where(inArray(mediaAssets.storageKey, storageKeys)),
      ),
    )
    .returning({ id: intakes.id });
  return removed.length;
}
