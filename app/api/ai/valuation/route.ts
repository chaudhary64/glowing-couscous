import { analyseItem } from "@/lib/ai/analyse";
import { aiErrorResponse, authorize, jsonResponse, readPayload } from "@/lib/ai/http";

/**
 * POST /api/ai/valuation — identify, assay, price, gate. One submission in, one
 * priced item out.
 *
 * Everything with a rupee sign on it is computed after the model has finished, from
 * the rate card, on this side of the wire. See `lib/ai/analyse.ts` for why.
 */

// No segment config: a POST-only handler is dynamic by definition, and this build's
// `cacheComponents` rejects both `dynamic` and `runtime` exports in route files.

export async function POST(request: Request) {
  // Guarded as the screen is guarded: this is the `/valuation` capability, and a
  // session alone is not authority to run it.
  const denied = await authorize(request, "/valuation");
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
    return jsonResponse(analysis);
  } catch (error) {
    return aiErrorResponse(error);
  }
}
