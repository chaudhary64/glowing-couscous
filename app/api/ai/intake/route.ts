import { analyseIntake } from "@/lib/ai/analyse";
import { aiErrorResponse, authorize, jsonResponse, readPayload } from "@/lib/ai/http";
import {
  archiveMediaParts,
  archiveRequests,
  archiveWarning,
} from "@/lib/s3/archive";

/**
 * POST /api/ai/intake — a photo, a Hindi voice note, or both, in one round trip.
 *
 * This is the multi-modal path: the audio is understood directly by the model
 * rather than being sent to a separate speech-to-text service first, so the
 * transcript and the item it describes come back together. The response carries the
 * extracted fields the collector can correct, the transcript in Devanagari with its
 * translation, and the priced item the same submission resolves to — because the
 * person standing in the lane should not have to upload twice to learn what they
 * will be paid.
 *
 * The photo and the voice note are also archived in S3 on the way through, so the
 * evidence a price was based on outlives the request that produced it. See
 * `lib/s3/archive.ts` for why the keys are content-addressed and why a storage
 * fault is reported rather than thrown.
 */

export async function POST(request: Request) {
  // Guarded as the screen is guarded: this is the `/intake` capability.
  const denied = await authorize(request, "/intake");
  if (denied) return denied;

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
    archiveMediaParts(archiveRequests(parsed.payload)),
  ]);

  if (analysed.status === "rejected") {
    if (archived.status === "fulfilled" && archived.value.objects.length > 0) {
      console.error(
        `[s3] kept ${archived.value.objects.length} object(s) for a request the analysis failed`,
      );
    }
    return aiErrorResponse(analysed.reason);
  }

  const storage = archived.status === "fulfilled" ? archived.value : null;
  const warning = storage ? archiveWarning(storage) : null;

  return jsonResponse({
    ...analysed.value,
    warnings: warning ? [...analysed.value.warnings, warning] : analysed.value.warnings,
    storage,
  });
}
