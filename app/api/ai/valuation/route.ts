import { analyseItem } from "@/lib/ai/analyse";
import { aiErrorResponse, authorizeUser, jsonResponse, readPayload } from "@/lib/ai/http";
import { archiveRequests, archiveWarning } from "@/lib/s3/archive";
import { recordPricedItem, pricedRecordWarning } from "@/lib/records/items";
import { recordSubmission, submissionWarning } from "@/lib/s3/intakes";
import { archiveAndRecord, recordWarning } from "@/lib/s3/media-assets";

/**
 * POST /api/ai/valuation — identify, assay, price, gate. One submission in, one
 * priced item out.
 *
 * Everything with a rupee sign on it is computed after the model has finished, from
 * the rate card, on this side of the wire. See `lib/ai/analyse.ts` for why.
 *
 * The submitted media is archived in S3 beside the model call, so the photograph a
 * price came from is still there after the request that priced it, and a
 * `media_assets` row records what that key was. A storage or database fault is
 * reported in `storage.error` / `records.error` and in the warnings; it never becomes
 * the reason a paid-for analysis is thrown away.
 *
 * The submission itself is recorded once the price exists — an `intakes` row carrying
 * this request's priced id, so the evidence is reachable from the valuation rather than
 * only from its own content hash. See `lib/s3/intakes.ts`.
 */

// No segment config: a POST-only handler is dynamic by definition, and this build's
// `cacheComponents` rejects both `dynamic` and `runtime` exports in route files.

export async function POST(request: Request) {
  // Guarded as the screen is guarded: this is the `/valuation` capability, and a
  // session alone is not authority to run it. The user comes back out of the guard
  // because the archive is signed with their Cognito subject.
  const access = await authorizeUser(request, "/valuation");
  if (!access.ok) return access.denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "bad_request", message: "Body must be JSON." }, 400);
  }

  const parsed = readPayload(body);
  if (!parsed.ok) return parsed.response;

  // Both awaited, both independent — see the longer note in the intake route for why
  // the archive runs beside the model rather than after it, and why a storage
  // failure is reported instead of thrown.
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

  const kept = archived.status === "fulfilled" ? archived.value : null;

  if (analysed.status === "rejected") {
    // The bytes and their rows are already written and are not rolled back: a valuation
    // that failed still has evidence, which is the whole reason the archive runs beside
    // the model instead of after it.
    if (kept && kept.storage.objects.length > 0) {
      console.error(
        `[s3] kept ${kept.storage.objects.length} object(s) for a request the analysis failed`,
      );
    }
    return aiErrorResponse(analysed.reason);
  }

  const analysis = analysed.value;
  const storage = kept?.storage ?? null;
  const records = kept?.records ?? null;
  const warnings = [...analysis.warnings];
  for (const warning of [storage ? archiveWarning(storage) : null, records ? recordWarning(records) : null]) {
    if (warning) warnings.push(warning);
  }

  // The submission row. Last, because it needs both halves of the request — the objects
  // the archive stored and the identity the price carries — and awaited, for the reason
  // the archive is: see the longer note in `app/api/ai/intake/route.ts`.
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

  /**
   * The priced record: the item, its assay, the price and the verdict, written once the
   * submission row exists to hang them off. `lib/records/items.ts` argues the ordering;
   * what matters here is that a failed analysis writes none of it — there is no price to
   * record — and that none of it can make this request fail after the model has answered.
   */
  const priced = await recordPricedItem({
    intakeId: submission?.submission?.id ?? null,
    analysis,
  });
  const pricedNote = pricedRecordWarning(priced);
  if (pricedNote) warnings.push(pricedNote);

  return jsonResponse({ ...analysis, warnings, storage, records, submission, priced });
}
