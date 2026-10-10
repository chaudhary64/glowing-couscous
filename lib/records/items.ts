import { eq } from "drizzle-orm";

import { database, databaseConfigured } from "@/db/client";
import {
  gatekeeperVerdicts,
  intakeFields,
  itemHazards,
  items,
  materialLines,
  valuations,
  verdictSignals,
} from "@/db/schema";
import { formatMass, parseIstStamp } from "@/lib/format";

import type { AiAnalysis } from "@/lib/ai/proposal";
import type { ExtractedField } from "@/lib/types";

/**
 * The priced record: what the model read, and what the rate card made it worth.
 *
 * Until this file, the pipeline's real half stopped at the submission. A priced
 * request wrote an `intakes` row — the photograph, how it was read and one summary
 * line — and then the item, its assay, the price and the verdict lived only in the
 * response that produced them. `docs/README.md` said so out loud: "the parsed record
 * is not kept ... the priced figures live only in the response that produced it".
 * That is the gap this closes, and it closes it in the schema's own order.
 *
 * Six tables, one transaction, one reason each:
 *
 * | Table | Why it exists | What would be a lie without it |
 * |---|---|---|
 * | `intake_fields` | the parsed record, per field, with the source and confidence | "the parsed record is kept before valuation" |
 * | `items` | the thing that was priced, and the submission it came from | a price with nothing to attach it to |
 * | `material_lines` | the assay, priced at the moment of valuation | `gross = sum(lines)` recomputed from today's rates |
 * | `item_hazards` | what a recycler must be told before it accepts the load | a swollen cell routed to a board line |
 * | `valuations` | the money, and the card it came from | a collector shown a number no row remembers |
 * | `gatekeeper_verdicts` + `verdict_signals` | the decision, and what decided it | "the AI said so" with no evidence behind it |
 *
 * Four decisions carry the file:
 *
 * 1. **The rows are written after the price, in one transaction.** The schema's
 *    ordering is an argument: a valuation is computed, a verdict is issued against it,
 *    and a decision is taken by a human. An `items` row whose valuation is missing would
 *    be an item with no price, which is not a state this product has — so the item and
 *    everything hanging off it commit together or not at all. Same posture as
 *    `lib/s3/intakes.ts`: a request whose analysis failed writes none of this, because
 *    there is no price to record.
 *
 * 2. **The item hangs off the submission.** `items.intake_id` is `NOT NULL`, and that is
 *    the point — the price is reachable from the evidence, and the evidence is reachable
 *    from the price. When a request had no submission row to attach to (no bucket, no
 *    database, or an id already held by another submission), nothing is written and the
 *    response says which of those it was rather than writing a dangling item.
 *
 * 3. **Nothing is invented to fill a column.** The brand is null when the plate was
 *    unread, not the string "Unread": an EPR credit booked against a company called
 *    Unread is the exact failure `items.brand` is nullable to avoid. The image-quality
 *    column stays null because the model does not report one, and a made-up 1.00 beside
 *    a held item would be the most confident lie on the screen.
 *
 * 4. **A price never gates a request.** Missing `DATABASE_URL` is `configured: false`,
 *    a failed write is returned in `error` and logged, and an analysis an operator has
 *    already paid for is never turned into an error page because a row would not insert.
 *
 * The collector on the item is null, and since `0002_stormy_thunderbird.sql` that column
 * is nullable for exactly this reason — the same one migration `0001_outstanding_talisman`
 * gives for `intakes.collector_id`. Provisioning collectors is the separate job that
 * makes it non-null.
 */

/** Everything a route knows once the model has answered. */
export interface PricedRecordInput {
  /**
   * The `intakes` row this price belongs to, as `recordSubmission` returned it. Null
   * when the submission was not recorded — in which case the item is not either.
   */
  intakeId: string | null;
  /** The priced result: its id is the item's code, and its figures are the rows. */
  analysis: AiAnalysis;
  /** The fields the intake pass extracted, on the route that produces them. */
  fields?: ExtractedField[];
}

export interface PricedRecordOutcome {
  /** False when there is no `DATABASE_URL`: nothing is recorded, nothing is broken. */
  configured: boolean;
  /** True when this call created the item; false when its code was already held. */
  created: boolean;
  /** `items.code`, when a row exists — whatever this call did. */
  code: string | null;
  /** `items.id`, when a row exists. */
  itemId: string | null;
  /** How many `intake_fields` rows this call kept. */
  fieldsWritten: number;
  /** Set when the database was configured and the write still failed. Never thrown. */
  error: string | null;
}

/**
 * What a screen should say when the price exists and the rows do not.
 *
 * Four different repairs, so four different sentences. A missing database is not
 * reported at all — the deployment that runs without one is a supported shape, not a
 * fault — while a code collision is an ordinary collision that the operator should see
 * rather than a silent no-op.
 */
export function pricedRecordWarning(outcome: PricedRecordOutcome): string | null {
  if (!outcome.configured) return null;
  if (outcome.error) {
    return `The item was priced but not recorded: ${outcome.error}. The price in this response is not stored anywhere, so it cannot be reached from the evidence archive.`;
  }
  if (!outcome.itemId) {
    return "The item was priced but not recorded: it has no submission row to belong to, and an item is only kept under the submission it came from.";
  }
  if (!outcome.created) {
    return `The item id ${outcome.code} already belongs to an item recorded earlier, so this submission was priced without a second item or valuation row. The earlier record is the one on file.`;
  }
  return null;
}

/** A numeric column takes the string Postgres reads exactly, not a float that rounds. */
function numeric(value: number, places = 2): string {
  return value.toFixed(places);
}

/**
 * The brand as stored: the plate read, or null.
 *
 * `lib/ai/parse.ts` defaults an unread plate to the string "Unread" so a screen can
 * print it, and that string must not reach an EPR column — see the note at the top.
 */
function storedBrand(brand: string): string | null {
  const trimmed = brand.trim();
  if (trimmed.length === 0) return null;
  return /^(unread|unknown|n\/a|none)$/i.test(trimmed) ? null : trimmed;
}

/**
 * Record one priced submission, and report what the database holds afterwards.
 *
 * One transaction. The insert into `items` yields to both unique indexes it can
 * collide with — `items_code_uq` when the same item is priced twice, and
 * `items_intake_uq` when a submission is re-run — and `returning` says which of those
 * happened. Only a row this call created gets children: the assay and the verdict
 * belong to the price they were computed for, and a second valuation row against the
 * first submission's evidence would be a number attributed to the wrong photograph.
 */
export async function recordPricedItem(input: PricedRecordInput): Promise<PricedRecordOutcome> {
  const outcome: PricedRecordOutcome = {
    configured: false,
    created: false,
    code: null,
    itemId: null,
    fieldsWritten: 0,
    error: null,
  };

  if (!databaseConfigured()) return outcome;
  outcome.configured = true;
  outcome.code = input.analysis.id;

  // No submission row means no evidence to hang the item off. `items.intake_id` is
  // NOT NULL on purpose, so this is a refusal rather than a dangling row.
  if (!input.intakeId) return outcome;

  const connection = database();
  if (!connection) {
    outcome.configured = false;
    return outcome;
  }

  const { analysis } = input;
  const { identified } = analysis;

  try {
    const result = await connection.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(items)
        .values({
          code: analysis.id,
          intakeId: input.intakeId as string,
          // Null is the honest answer: the request carries an operator's session and
          // says nothing about whose material this is.
          collectorId: null,
          deviceLabel: identified.itemLabel,
          deviceCategory: identified.className,
          brand: storedBrand(identified.brand),
          condition: identified.condition,
          massG: numeric(identified.massGrams),
          recoveredAt: new Date(),
        })
        // Two unique indexes can refuse this row and both refusals are ordinary:
        // `items_code_uq` because the same item priced twice is one item, and
        // `items_intake_uq` because one submission resolves to exactly one item. No
        // `target` is named so both are absorbed; the reads below then tell them apart,
        // which a targeted clause could not do in one statement.
        .onConflictDoNothing()
        .returning({ id: items.id });

      const created = inserted[0]?.id ?? null;
      if (!created) {
        // The id already belongs to an item: this is a re-price of the same thing, and
        // the earlier record is the one on file.
        const [existing] = await tx
          .select({ id: items.id })
          .from(items)
          .where(eq(items.code, analysis.id))
          .limit(1);
        if (existing) return { created: false, itemId: existing.id, fieldsWritten: 0, error: null };

        // Otherwise the submission itself already resolved to an item — a second
        // analysis of one upload. Recorded as its own sentence rather than as a driver
        // error, because the repair is different: this is not a duplicate price, it is
        // a second price for the same photograph.
        const [byIntake] = await tx
          .select({ code: items.code })
          .from(items)
          .where(eq(items.intakeId, input.intakeId as string))
          .limit(1);
        return {
          created: false,
          itemId: null,
          fieldsWritten: 0,
          error: byIntake
            ? `the submission already resolved to the item ${byIntake.code}, so this price was not recorded as a second item`
            : `the item ${analysis.id} could not be written and no row holds its submission`,
        };
      }

      const fields = input.fields ?? [];
      if (fields.length > 0) {
        await tx
          .insert(intakeFields)
          .values(
            fields.map((field, index) => ({
              intakeId: input.intakeId as string,
              label: field.label,
              valueText: field.value,
              confidence: numeric(field.confidence, 3),
              source: field.source,
              ordinal: index,
            })),
          )
          // `intake_fields_label_uq` makes a field one row: re-running extraction for
          // the same submission supersedes the field rather than stacking a second.
          .onConflictDoNothing();
      }

      if (analysis.materials.length > 0) {
        await tx.insert(materialLines).values(
          analysis.materials.map((line, index) => ({
            itemId: created,
            materialName: line.name,
            symbol: line.symbol,
            category: line.category,
            massG: numeric(line.massGrams),
            // Stored, not recomputed on read: a line is priced at the moment of
            // valuation, and recomputing from today's card would restate a payout.
            ratePaisePerKg: line.ratePerKg * 100,
            valuePaise:
              Math.round((line.massGrams / 1000) * line.ratePerKg) * 100,
            handlingNote: line.handling,
            hazardous: line.category === "hazardous",
            ordinal: index,
          })),
        );
      }

      if (identified.hazards.length > 0) {
        await tx.insert(itemHazards).values(
          identified.hazards.map((label, index) => ({
            itemId: created,
            label,
            // Traceable to the model that flagged it, so a false alarm can be read
            // back to the answer that raised it.
            source: analysis.source.model,
            ordinal: index,
          })),
        );
      }

      const [valuation] = await tx
        .insert(valuations)
        .values({
          itemId: created,
          version: 1,
          grossValuePaise: analysis.valuation.grossValue * 100,
          handlingFeePaise: analysis.valuation.handlingFee * 100,
          netToCollectorPaise: analysis.valuation.netToCollector * 100,
          eprCreditPaise: analysis.valuation.eprCreditInr * 100,
          rateBasis: analysis.valuation.rateBasis,
          // The card publishes its expiry as an IST stamp; the column is a
          // `timestamptz`, so the string is converted rather than stored as text.
          validUntil: parseIstStamp(analysis.valuation.validUntil),
          summary: `${identified.itemLabel}, ${formatMass(identified.massGrams)}`,
          confidence: numeric(analysis.gatekeeper.confidence, 3),
          model: analysis.source.model,
          computedAt: new Date(),
        })
        .returning({ id: valuations.id });

      const [verdict] = await tx
        .insert(gatekeeperVerdicts)
        .values({
          itemId: created,
          verdict: analysis.gatekeeper.verdict,
          confidence: numeric(analysis.gatekeeper.confidence, 3),
          modelVersion: analysis.gatekeeper.modelVersion,
          matchedClass: analysis.gatekeeper.matchedClass,
          reason: analysis.gatekeeper.reason,
          latencyMs: analysis.source.latencyMs,
          checkedAt: new Date(),
        })
        .returning({ id: gatekeeperVerdicts.id });

      if (verdict && analysis.gatekeeper.signals.length > 0) {
        await tx.insert(verdictSignals).values(
          analysis.gatekeeper.signals.map((signal, index) => ({
            verdictId: verdict.id,
            label: signal.label,
            value: signal.value,
            ordinal: index,
          })),
        );
      }

      // The valuation id is read only to keep the transaction honest about what it
      // wrote: a valuation row is the one thing the price cannot exist without.
      if (!valuation) throw new Error("the valuation row was not written");

      return { created: true, itemId: created, fieldsWritten: fields.length, error: null };
    });

    return {
      configured: true,
      created: result.created,
      code: analysis.id,
      itemId: result.itemId,
      fieldsWritten: result.fieldsWritten,
      error: result.error,
    };
  } catch (error) {
    // The inner cause, not Drizzle's wrapper around the whole statement plus its
    // parameters — the same reason the archive reports it that way.
    const cause =
      error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
    const message = (cause ?? (error instanceof Error ? error.message : String(error)))
      .replace(/\s+/g, " ")
      .trim();
    console.error("[db] recording the priced item failed", message);
    return { ...outcome, error: message.slice(0, 200) };
  }
}
