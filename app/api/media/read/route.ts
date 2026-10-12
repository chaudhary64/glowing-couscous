import { authorizeUser, jsonResponse } from "@/lib/ai/http";
import { scopeForUser } from "@/lib/records/scope";
import { presignRead } from "@/lib/s3/archive";
import { mayReadMediaKey } from "@/lib/s3/media-assets";

/**
 * GET /api/media/read?key=media/<two hex>/<sha256>.<ext>
 *
 * Hands back a short-lived URL for the evidence behind a submission. The bucket stays
 * private; this is the only way the product ever reads those bytes, and it reads them
 * as the app's own `media/*`-scoped key rather than as anything broader.
 *
 * Four decisions worth stating, because each one is a choice between two reasonable
 * designs:
 *
 * 1. **Guarded as the archive screen is, then cut by scope.** The authority is
 *    `/evidence` — Operator, Viewer or Admin — the same seats that render a Read button,
 *    so the button and the API cannot disagree. Operator and Admin read the whole
 *    archive; a Viewer reads only the evidence behind credits their brand claimed
 *    (`mayReadMediaKey`), and anything else is a refusal, not a URL. The session is
 *    required and the request must be same-origin: a cross-site `<img>` can spend a
 *    signed read exactly as easily as a script can spend a model call.
 *
 * 2. **The key is validated by shape, not looked up in the database.** Only
 *    `media/<2 hex>/<sha256>.<ext>` can be signed, so this cannot be used to walk the
 *    bucket or to probe for guessable names. It is deliberately *not* a `media_assets`
 *    lookup: if a row write failed while the object was written, requiring the row would
 *    make a perfectly good object unreadable — the database would become a gate on
 *    evidence that exists, which is the opposite of what it is for. That holds for the
 *    unscoped seats; for a Viewer the row is the permission, so their read is looked up.
 *
 * 3. **A signature is not an existence check.** Signing happens locally, so a key whose
 *    object was never written still produces a URL, and its `GET` answers 403/404 from
 *    S3. Claiming otherwise here would mean a round trip per read just to produce a
 *    nicer error for a hand-typed digest.
 *
 * 4. **JSON, not a `302`.** A redirect would put a signed URL in the browser's history
 *    and in any server log that records `Location`. The caller decides where the URL
 *    goes, and the response is `private, no-store` like every other personalised one.
 */

/** What a refusal calls the action, in the three sentences `authorizeUser` builds. */
const READING_EVIDENCE = {
  subject: "Reading archived evidence",
  signIn: "read archived evidence",
  refuse: "read archived evidence",
};

/** Long enough to recognise a truncated key in an error, short enough not to echo a body. */
const KEY_ECHO_LIMIT = 120;

export async function GET(request: Request) {
  const access = await authorizeUser(request, "/evidence", READING_EVIDENCE);
  if (!access.ok) return access.denied;

  const key = (new URL(request.url).searchParams.get("key") ?? "").trim();
  const allowed = await mayReadMediaKey(await scopeForUser(access.user), key);
  if (!allowed.ok) return jsonResponse({ error: "forbidden", message: allowed.message }, 403);
  const signed = await presignRead(key);

  if (!signed.ok) {
    if (signed.reason === "unconfigured") {
      return jsonResponse(
        {
          error: "archive_unconfigured",
          message:
            "The media archive is not configured on this deployment, so there is nothing to read back. S3_BUCKET and S3_REGION switch it on.",
        },
        503,
      );
    }
    return jsonResponse(
      {
        error: "bad_key",
        message: `"${key.slice(0, KEY_ECHO_LIMIT)}" is not a key this archive writes. Expected media/<two hex>/<64 hex>.<ext>.`,
      },
      400,
    );
  }

  return jsonResponse({
    key,
    url: signed.url,
    expiresInSeconds: signed.expiresInSeconds,
    expiresAt: signed.expiresAt,
  });
}
