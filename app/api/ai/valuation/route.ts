import { analyseItem } from "@/lib/ai/analyse";
import { aiErrorResponse, authorize, jsonResponse, readPayload } from "@/lib/ai/http";
import {
  archiveMediaParts,
  archiveRequests,
  archiveWarning,
} from "@/lib/s3/archive";

/**
 * POST /api/ai/valuation — identify, assay, price, gate. One submission in, one
 * priced item out.
 *
 * Everything with a rupee sign on it is computed after the model has finished, from
 * the rate card, on this side of the wire. See `lib/ai/analyse.ts` for why.
 *
 * The submitted media is archived in S3 beside the model call, so the photograph a
 * price came from is still there after the request that priced it. A storage fault
 * is reported in `storage.error` and in the warnings; it never becomes the reason a
 * paid-for analysis is thrown away.
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
    archiveMediaParts(archiveRequests(parsed.payload)),
  ]);

  if (analysed.status === "rejected") return aiErrorResponse(analysed.reason);

  const storage = archived.status === "fulfilled" ? archived.value : null;
  const warning = storage ? archiveWarning(storage) : null;

  return jsonResponse({
    ...analysed.value,
    warnings: warning ? [...analysed.value.warnings, warning] : analysed.value.warnings,
    storage,
  });
}
