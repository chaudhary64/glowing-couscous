import { analyseIntake } from "@/lib/ai/analyse";
import { aiErrorResponse, authorizeUser, jsonResponse, readPayload } from "@/lib/ai/http";
import { archiveRequests, archiveWarning } from "@/lib/s3/archive";
import { recordSubmission, submissionWarning } from "@/lib/s3/intakes";
import { archiveAndRecord, recordWarning } from "@/lib/s3/media-assets";

/**
 * POST /api/ai/intake — a photo, a Hindi voice note, or both, in one round trip.
 *
 * This is the multi-modal path: the Hindi audio is transcribed by Azure Speech first,
 * and the verbatim transcript is read by the model alongside the photograph, so the
 * transcript and the item it describes come back together. The response carries the
 * extracted fields the collector can correct, the transcript in Devanagari with its
 * translation, and the priced item the same submission resolves to — because the
 * person standing in the lane should not have to upload twice to learn what they
 * will be paid.
 *
 * The photo and the voice note are also archived in S3 on the way through, so the
 * evidence a price was based on outlives the request that produced it, and a row for
 * each object is recorded in `media_assets` so the key can be resolved back to what it
 * was. See `lib/s3/archive.ts` for why the keys are content-addressed and why a
 * storage fault is reported rather than thrown, and `lib/s3/media-assets.ts` for why
 * the row is written after the bytes and never gates them.
 *
 * Once the price exists, the same request writes an `intakes` row joining the priced
 * result to the object it came from, so the archive can be read *from* a valuation
 * rather than only by its content hash. See `lib/s3/intakes.ts`.
 */

export async function POST(request: Request) {
  // Guarded as the screen is guarded: this is the `/intake` capability. The user comes
  // back out of the guard because the archive is signed with their Cognito subject.
  const access = await authorizeUser(request, "/intake");
  if (!access.ok) return access.denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "bad_request", message: "Body must be JSON." }, 400);
  }

  const parsed = readPayload(body);
  if (!parsed.ok) return parsed.response;

  const analyse = analyseIntake({
    media: [parsed.payload.photo, parsed.payload.audio].filter(
      (part): part is NonNullable<typeof part> => part !== undefined,
    ),
    note: parsed.payload.note,
    durationSeconds: parsed.payload.durationSeconds,
  });

  /**
   * The archive runs *beside* the model call, not after it, and both are awaited.
   *
   * Beside, because the two are independent and a write is not worth adding to the
   * latency of a request that is already spending seconds on inference. Awaited,
   * because this runs in a Lambda-backed SSR host: work still in flight when the
   * response is written can be cut off with it, and an archive that loses a race
   * against its own reply is not an archive.
   *
   * Nothing here can make the request fail. The evidence is kept even when the
   * model refuses — a collector whose submission came back `ai_at_capacity` has a
   * photograph that is already stored, and the operator can retry the analysis
   * against bytes that exist rather than asking the lane to submit again.
   */
  const [analysed, archived] = await Promise.allSettled([
    analyse,
    archiveAndRecord(archiveRequests(parsed.payload), {
      uploaderCognitoSub: access.user.sub,
    }),
  ]);

  const kept = archived.status === "fulfilled" ? archived.value : null;

  if (analysed.status === "rejected") {
    if (kept && kept.storage.objects.length > 0) {
      console.error(
        `[s3] kept ${kept.storage.objects.length} object(s) for a request the analysis failed`,
      );
    }
    // The evidence and its row are already written, and the model's refusal is what the
    // operator needs to see; recorded by whom is in the table either way.
    return aiErrorResponse(analysed.reason);
  }

  const analysis = analysed.value.analysis;
  const storage = kept?.storage ?? null;
  const records = kept?.records ?? null;
  const warnings = [...analysed.value.warnings];
  for (const warning of [storage ? archiveWarning(storage) : null, records ? recordWarning(records) : null]) {
    if (warning) warnings.push(warning);
  }

  /**
   * The submission row, written last because it is the only step that needs both halves
   * of the request at once: the objects the archive stored, and the identity the price
   * carries.
   *
   * Which is also why a request whose analysis failed gets none — `intakes.code` *is*
   * that identity, so there would be nothing to record and nothing an operator could
   * look it up by. The bytes and their `media_assets` rows stay either way. Awaited
   * before the response, like the archive, because this host can cut off work still in
   * flight when the reply is written.
   */
  const submission =
    records && analysis
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

  return jsonResponse({ ...analysed.value, warnings, storage, records, submission });
}
