import { analyseItem } from "@/lib/ai/analyse";
import { aiErrorResponse, authorize, jsonResponse, readPayload } from "@/lib/ai/http";
import {
  archiveMediaParts,
  archiveRequests,
  archiveWarning,
} from "@/lib/s3/archive";

/**
 * POST /api/ai/gatekeeper — the same pass as valuation, answered as a decision.
 *
 * The screen that consumes this one is asking a single question: may this be
 * credited? So the response is the boolean with everything that produced it — the
 * matched class, the reject rule that fired, the signals, and the confidence —
 * plus what the item *would* have drawn, which is the number that makes the rule
 * feel real. A rejected item still carries its withheld credit for that reason.
 *
 * The media behind the decision is archived in S3 alongside the model call, because
 * a decision to refuse a credit is exactly the one an operator gets asked to
 * justify: "show me the photograph you turned away" should have an answer that is
 * not a shrug, and it should be the same answer for a held item as for a credited
 * one.
 */

export async function POST(request: Request) {
  // Guarded as the screen is guarded: the only caller is the validation queue, so
  // this is the `/validation` capability.
  const denied = await authorize(request, "/validation");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "bad_request", message: "Body must be JSON." }, 400);
  }

  const parsed = readPayload(body);
  if (!parsed.ok) return parsed.response;

  // Awaited together, and independent: the archive runs beside the model call. See
  // the intake route for the full reasoning.
  const [analysed, archived] = await Promise.allSettled([
    analyseItem({
      media: [parsed.payload.photo, parsed.payload.audio].filter(
        (part): part is NonNullable<typeof part> => part !== undefined,
      ),
      note: parsed.payload.note,
      declaredMassGrams: parsed.payload.declaredMassGrams,
    }),
    archiveMediaParts(archiveRequests(parsed.payload)),
  ]);

  if (analysed.status === "rejected") return aiErrorResponse(analysed.reason);

  const analysis = analysed.value;
  const storage = archived.status === "fulfilled" ? archived.value : null;
  const warning = storage ? archiveWarning(storage) : null;

  const creditable = analysis.gatekeeper.verdict !== "rejected";
  return jsonResponse({
      id: analysis.id,
      subject: analysis.identified.itemLabel,
      brand: analysis.identified.brand,
      itemClass: analysis.identified.itemClass,
      cpcb: analysis.identified.cpcb,
      verdict: analysis.gatekeeper.verdict,
      creditable,
      confidence: analysis.gatekeeper.confidence,
      matchedClass: analysis.gatekeeper.matchedClass,
      ruleCode: analysis.gatekeeper.ruleCode,
      reason: analysis.gatekeeper.reason,
      signals: analysis.gatekeeper.signals,
      modelVersion: analysis.gatekeeper.modelVersion,
      checkedAt: analysis.gatekeeper.checkedAt,
      // Shown so a rejection is legible as a decision, not as a bug.
      withheldCreditInr: analysis.valuation.eprCreditInr,
      creditNote: analysis.valuation.eprCreditNote,
      massGrams: analysis.identified.massGrams,
      hazardous: analysis.identified.hazardous,
      warnings: warning ? [...analysis.warnings, warning] : analysis.warnings,
      source: analysis.source,
      storage,
    });
}
