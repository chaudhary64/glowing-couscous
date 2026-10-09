import { analyseItem } from "@/lib/ai/analyse";
import { aiErrorResponse, authorizeUser, jsonResponse, readPayload } from "@/lib/ai/http";
import { archiveRequests, archiveWarning } from "@/lib/s3/archive";
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

  const storage = kept?.storage ?? null;
  const records = kept?.records ?? null;
  const warnings = [...analysed.value.warnings];
  for (const warning of [storage ? archiveWarning(storage) : null, records ? recordWarning(records) : null]) {
    if (warning) warnings.push(warning);
  }

  return jsonResponse({ ...analysed.value, warnings, storage, records });
}
