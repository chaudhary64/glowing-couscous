import { analyseItem } from "@/lib/ai/analyse";
import { aiErrorResponse, authorizeUser, jsonResponse, readPayload } from "@/lib/ai/http";
import { archiveRequests, archiveWarning } from "@/lib/s3/archive";
import { recordSubmission, submissionWarning } from "@/lib/s3/intakes";
import { archiveAndRecord, recordWarning } from "@/lib/s3/media-assets";

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
 * one. A `media_assets` row goes with each object, which is what lets that question
 * be answered from the database rather than from a bucket listing, and the `intakes`
 * row written once the decision exists is what ties it to the submission it was made
 * on — see `lib/s3/intakes.ts`.
 */

export async function POST(request: Request) {
  // Guarded as the screen is guarded: the only caller is the validation queue, so
  // this is the `/validation` capability. The user comes back out of the guard because
  // the archive is signed with their Cognito subject.
  const access = await authorizeUser(request, "/validation");
  if (!access.ok) return access.denied;

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
    archiveAndRecord(archiveRequests(parsed.payload), {
      uploaderCognitoSub: access.user.sub,
    }),
  ]);

  if (analysed.status === "rejected") {
    // Same as the intake route: a failed analysis still leaves the bytes and the row
    // behind, so the refusal cannot be told later without the evidence for it.
    if (archived.status === "fulfilled" && archived.value.storage.objects.length > 0) {
      console.error(
        `[s3] kept ${archived.value.storage.objects.length} object(s) for a request the analysis failed`,
      );
    }
    return aiErrorResponse(analysed.reason);
  }

  const analysis = analysed.value;
  const kept = archived.status === "fulfilled" ? archived.value : null;
  const storage = kept?.storage ?? null;
  const records = kept?.records ?? null;
  const warnings = [...analysis.warnings];
  for (const warning of [storage ? archiveWarning(storage) : null, records ? recordWarning(records) : null]) {
    if (warning) warnings.push(warning);
  }

  // The submission row, written once the decision exists. A rejected item is recorded
  // like any other: "show me the photograph you turned away" is the question this row
  // has to be able to answer. Last and awaited — see the note in the intake route.
  const submission = records
    ? await recordSubmission({
        records: records.records,
        pricedCode: analysis.id,
        label: analysis.identified.itemLabel,
        massGrams: analysis.identified.massGrams,
        extraction: {
          model: analysis.source.model,
          confidence: analysis.gatekeeper.confidence,
          latencyMs: analysis.source.latencyMs,
        },
      })
    : null;
  const submissionNote = submission ? submissionWarning(submission) : null;
  if (submissionNote) warnings.push(submissionNote);

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
      warnings,
      source: analysis.source,
      storage,
      records,
      submission,
    });
}
