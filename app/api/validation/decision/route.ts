import { authorizeUser, jsonResponse } from "@/lib/ai/http";
import { decisionWarning, recordDecision, undoDecision } from "@/lib/records/decisions";

import type { StoredDecisionKind } from "@/lib/types";

/**
 * POST /api/validation/decision — the officer's answer on a held item.
 *
 * The validation queue recorded its decisions in component state and said so on screen,
 * because there was nowhere to put them: `validation_decisions` has existed in the schema
 * since it was applied and had no writer. This route is that writer, and it is the reason
 * the queue's own footer no longer has to admit that a reload forgets the work.
 *
 * Three things it is careful about:
 *
 * 1. **It is guarded as the screen is.** This is the `/validation` capability, and the
 *    authority matrix decides it, not the presence of a cookie. The decision carries a
 *    name — `decided_by_user_id` resolves through `users.cognito_sub` — so an anonymous
 *    but signed-in account must not be able to write one.
 *
 * 2. **It never loses the earlier answer.** Superseding a decision marks the previous row
 *    undone; the undo below is a mark too. Nothing here deletes, because the trail a brand
 *    asks for is the one that shows a judgement was revisited, not one that shows a single
 *    clean answer.
 *
 * 3. **It never invents a decision.** Only the three outcomes the enum declares are
 *    accepted, and the short ids the queue's buttons use are mapped to them here rather
 *    than stored: the enum is the vocabulary of the table, and a button label is not.
 */

/** The queue's three buttons, mapped to the enum the schema declares. */
const ACTIONS: Record<string, StoredDecisionKind> = {
  recyclable: "approved_recyclable",
  reuse: "sent_to_reuse",
  reject: "rejected_non_ewaste",
  approved_recyclable: "approved_recyclable",
  sent_to_reuse: "sent_to_reuse",
  rejected_non_ewaste: "rejected_non_ewaste",
};

const DECIDING = {
  subject: "Recording a validation decision",
  signIn: "decide a held item",
  refuse: "decide a held item",
};

export async function POST(request: Request) {
  const access = await authorizeUser(request, "/validation", DECIDING);
  if (!access.ok) return access.denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "bad_request", message: "Body must be JSON." }, 400);
  }

  if (typeof body !== "object" || body === null) {
    return jsonResponse({ error: "bad_request", message: "Body must be a JSON object." }, 400);
  }

  const raw = body as Record<string, unknown>;
  const itemCode = String(raw.item ?? raw.itemCode ?? "").trim();
  const decision = ACTIONS[String(raw.decision ?? "").trim()];
  const reason = typeof raw.reason === "string" ? raw.reason : null;

  if (!itemCode) {
    return jsonResponse(
      { error: "bad_request", message: "An item id is required — the one the queue shows." },
      400,
    );
  }
  if (!decision) {
    return jsonResponse(
      {
        error: "bad_request",
        message: "Decision must be one of approved_recyclable, sent_to_reuse or rejected_non_ewaste.",
      },
      400,
    );
  }

  const outcome = await recordDecision({
    itemCode,
    decision,
    reason,
    decidedByCognitoSub: access.user.sub,
  });

  if (!outcome.configured) {
    return jsonResponse(
      {
        error: "records_unavailable",
        message:
          "This deployment has no database configured, so a decision cannot be recorded. Nothing was changed.",
      },
      503,
    );
  }
  if (!outcome.decision) {
    return jsonResponse(
      { error: "decision_failed", message: decisionWarning(outcome) ?? "The decision was not recorded." },
      409,
    );
  }

  return jsonResponse({
    decision: outcome.decision,
    decidedBy: access.user.name ?? access.user.email ?? null,
    warning: decisionWarning(outcome),
  });
}

/**
 * DELETE /api/validation/decision?id=… — take a decision back.
 *
 * A mark rather than a delete, for the reason in `lib/records/decisions.ts`: the item
 * returns to the pending queue, and the record of the decision that was taken back
 * stays where an auditor can find it.
 */
export async function DELETE(request: Request) {
  const access = await authorizeUser(request, "/validation", DECIDING);
  if (!access.ok) return access.denied;

  const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
  if (!id) {
    return jsonResponse({ error: "bad_request", message: "A decision id is required." }, 400);
  }

  const outcome = await undoDecision(id, access.user.sub);
  if (!outcome.configured) {
    return jsonResponse(
      { error: "records_unavailable", message: "This deployment has no database configured." },
      503,
    );
  }
  if (!outcome.decision) {
    return jsonResponse(
      { error: "undo_failed", message: decisionWarning(outcome) ?? "The decision was not undone." },
      409,
    );
  }

  return jsonResponse({ decision: outcome.decision });
}
