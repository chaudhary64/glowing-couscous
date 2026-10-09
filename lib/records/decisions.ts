import { and, desc, eq, isNull } from "drizzle-orm";

import { database, databaseConfigured } from "@/db/client";
import { gatekeeperVerdicts, items, validationDecisions, valuations } from "@/db/schema";

import { resolveUserId } from "./users";

import type { StoredDecision, StoredDecisionKind } from "@/lib/types";

/**
 * The human half of the gatekeeper: the decision that closes a hold.
 *
 * The validation queue used to keep its decisions in component state and say so on
 * screen — "decisions vanish on reload" — which made the one screen whose entire job is
 * a human judgement the only one that forgot it had been made. `validation_decisions`
 * has been in the schema for exactly this row since it was applied, including the
 * column that makes a correction possible without erasing the first answer.
 *
 * Three properties, and they are the same three the archive holds itself to:
 *
 * 1. **Approving is the only outcome that releases money.** The other two end the item
 *    without a payable credit, and which one it was is recorded, because "why was this
 *    not paid?" is the question this table exists to answer a year later.
 *
 * 2. **A correction is a new row.** Nothing here updates a decision in place or deletes
 *    one. Taking a second decision on the same item marks the previous row `undone_at`
 *    and inserts a new one, so the audit trail keeps both the first answer and the fact
 *    that it was revisited — which is what the queue's undo always promised on screen.
 *
 * 3. **A decision can fail without losing the analysis.** Missing `DATABASE_URL` is
 *    `configured: false`; a failed write is returned in `error` and logged. The route
 *    turns that into a sentence for the officer rather than a 500.
 *
 * The decider is resolved through `users.cognito_sub`. Where no `users` row exists the
 * column stays null, which is the honest answer rather than attributing a judgement to
 * whoever happens to be signed in under a name nobody stored.
 */

export interface DecisionInput {
  /** `items.code` — the id the priced result carries and the queue shows. */
  itemCode: string;
  decision: StoredDecisionKind;
  /** The officer's own words, where they gave any. */
  reason?: string | null;
  /** Cognito `sub` of the officer taking the decision. */
  decidedByCognitoSub?: string | null;
}

export interface DecisionOutcome {
  configured: boolean;
  decision: StoredDecision | null;
  error: string | null;
}

/** What the route tells the officer when a decision did not reach the database. */
export function decisionWarning(outcome: DecisionOutcome): string | null {
  if (!outcome.configured) {
    return "The decision was not recorded: this deployment has no database configured, so the queue cannot keep it. Nothing was changed.";
  }
  if (outcome.error) {
    return `The decision was not recorded: ${outcome.error}. Nothing was changed, so the item is still waiting.`;
  }
  return null;
}

function decisionFailure(error: unknown, action: string): DecisionOutcome {
  const cause =
    error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
  const message = (cause ?? (error instanceof Error ? error.message : String(error)))
    .replace(/\s+/g, " ")
    .trim();
  console.error(`[db] ${action} failed`, message);
  return { configured: true, decision: null, error: message.slice(0, 200) };
}

/**
 * Record one decision on a held item.
 *
 * One transaction: the previous live decision for the item is marked undone, the new row
 * is written, and the verdict it resolves is stamped `reviewed_at` so the gatekeeper's
 * own record shows that a person looked at it. Half of that landing is worse than none
 * of it — a decision with an unmarked verdict would put the item back in the queue the
 * next time somebody rebuilt it from the verdict side.
 */
export async function recordDecision(input: DecisionInput): Promise<DecisionOutcome> {
  if (!databaseConfigured()) {
    return { configured: false, decision: null, error: null };
  }
  const connection = database();
  if (!connection) return { configured: false, decision: null, error: null };

  try {
    const { db } = connection;
    const [item] = await db
      .select({
        id: items.id,
        code: items.code,
        label: items.deviceLabel,
      })
      .from(items)
      .where(eq(items.code, input.itemCode))
      .limit(1);

    if (!item) {
      return {
        configured: true,
        decision: null,
        error: `no item is on file under ${input.itemCode}`,
      };
    }

    const decidedByUserId = input.decidedByCognitoSub
      ? await resolveUserId(input.decidedByCognitoSub)
      : null;
    const reason = input.reason?.trim() ? input.reason.trim().slice(0, 600) : null;

    const written = await db.transaction(async (tx) => {
      /*
        Supersede the previous answer, and only a live one.

        `isNull(undoneAt)` is not tidiness: without it this update would stamp a fresh
        `undone_at` on decisions that were already undone, rewriting the moment a
        correction was first taken back. The record of the first correction is exactly
        what an auditor asks for.
      */
      await tx
        .update(validationDecisions)
        .set({ undoneAt: new Date(), undoneByUserId: decidedByUserId })
        .where(
          and(
            eq(validationDecisions.itemId, item.id),
            isNull(validationDecisions.undoneAt),
          ),
        );

      // The verdict being resolved, so the decision points at what it answered rather
      // than at the item alone. Latest by `checked_at`, the same rule every read uses.
      const [verdict] = await tx
        .select({ id: gatekeeperVerdicts.id })
        .from(gatekeeperVerdicts)
        .where(eq(gatekeeperVerdicts.itemId, item.id))
        .orderBy(desc(gatekeeperVerdicts.checkedAt))
        .limit(1);

      const [row] = await tx
        .insert(validationDecisions)
        .values({
          itemId: item.id,
          verdictId: verdict?.id ?? null,
          decision: input.decision,
          reason,
          decidedByUserId,
          decidedAt: new Date(),
        })
        .returning({ id: validationDecisions.id, decidedAt: validationDecisions.decidedAt });

      if (!row) throw new Error("the decision row was not written");

      if (verdict) {
        await tx
          .update(gatekeeperVerdicts)
          .set({ reviewedAt: new Date(), reviewedByUserId: decidedByUserId })
          .where(eq(gatekeeperVerdicts.id, verdict.id));
      }

      const [valuation] = await tx
        .select({ netPaise: valuations.netToCollectorPaise })
        .from(valuations)
        .where(eq(valuations.itemId, item.id))
        .orderBy(desc(valuations.computedAt))
        .limit(1);

      return {
        id: row.id,
        decidedAt: row.decidedAt,
        netPaise: valuation?.netPaise ?? null,
      };
    });

    return {
      configured: true,
      error: null,
      decision: {
        id: written.id,
        itemCode: item.code,
        itemLabel: item.label,
        decision: input.decision,
        reason,
        decidedAt: written.decidedAt.toISOString(),
        decidedByName: null,
        undoneAt: null,
        netToCollector: written.netPaise === null ? null : Number(written.netPaise) / 100,
      },
    };
  } catch (error) {
    return decisionFailure(error, "recording a validation decision");
  }
}

/**
 * Take a decision back.
 *
 * A mark, not a delete: `undone_at` is the schema's own answer to the queue's undo, and
 * a row that was deleted would leave the reviewer's own record unable to show that the
 * first answer ever existed. The item returns to the pending list because every read
 * treats an undone decision as no decision.
 */
export async function undoDecision(
  decisionId: string,
  undoneByCognitoSub?: string | null,
): Promise<DecisionOutcome> {
  if (!databaseConfigured()) {
    return { configured: false, decision: null, error: null };
  }
  const connection = database();
  if (!connection) return { configured: false, decision: null, error: null };

  try {
    const undoneByUserId = undoneByCognitoSub
      ? await resolveUserId(undoneByCognitoSub)
      : null;

    const [row] = await connection.db
      .update(validationDecisions)
      .set({ undoneAt: new Date(), undoneByUserId })
      .where(eq(validationDecisions.id, decisionId))
      .returning({
        id: validationDecisions.id,
        decision: validationDecisions.decision,
        decidedAt: validationDecisions.decidedAt,
        undoneAt: validationDecisions.undoneAt,
      });

    if (!row) {
      return { configured: true, decision: null, error: "no decision is on file under that id" };
    }

    return {
      configured: true,
      error: null,
      decision: {
        id: row.id,
        itemCode: "",
        itemLabel: "",
        decision: row.decision as StoredDecisionKind,
        reason: null,
        decidedAt: row.decidedAt.toISOString(),
        decidedByName: null,
        undoneAt: row.undoneAt ? row.undoneAt.toISOString() : null,
        netToCollector: null,
      },
    };
  } catch (error) {
    return decisionFailure(error, "undoing a validation decision");
  }
}

