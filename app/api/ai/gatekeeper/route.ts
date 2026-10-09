import { analyseItem } from "@/lib/ai/analyse";
import { aiErrorResponse, authorize, jsonResponse, readPayload } from "@/lib/ai/http";

/**
 * POST /api/ai/gatekeeper — the same pass as valuation, answered as a decision.
 *
 * The screen that consumes this one is asking a single question: may this be
 * credited? So the response is the boolean with everything that produced it — the
 * matched class, the reject rule that fired, the signals, and the confidence —
 * plus what the item *would* have drawn, which is the number that makes the rule
 * feel real. A rejected item still carries its withheld credit for that reason.
 */

export async function POST(request: Request) {
  const denied = await authorize(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "bad_request", message: "Body must be JSON." }, 400);
  }

  const parsed = readPayload(body);
  if (!parsed.ok) return parsed.response;

  try {
    const analysis = await analyseItem({
      media: [parsed.payload.photo, parsed.payload.audio].filter(
        (part): part is NonNullable<typeof part> => part !== undefined,
      ),
      note: parsed.payload.note,
      declaredMassGrams: parsed.payload.declaredMassGrams,
    });

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
      warnings: analysis.warnings,
      source: analysis.source,
    });
  } catch (error) {
    return aiErrorResponse(error);
  }
}
