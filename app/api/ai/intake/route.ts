import { analyseIntake } from "@/lib/ai/analyse";
import { aiErrorResponse, authorize, jsonResponse, readPayload } from "@/lib/ai/http";

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

  try {
    const result = await analyseIntake({
      media: [parsed.payload.photo, parsed.payload.audio].filter(
        (part): part is NonNullable<typeof part> => part !== undefined,
      ),
      note: parsed.payload.note,
      durationSeconds: parsed.payload.durationSeconds,
    });
    return jsonResponse(result);
  } catch (error) {
    return aiErrorResponse(error);
  }
}
