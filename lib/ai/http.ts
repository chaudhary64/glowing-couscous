import { NextResponse } from "next/server";

import { AiCallError, AiUnavailableError, type AiMediaPart } from "@/lib/ai/foundry";
import { AiProposalInvalidError } from "@/lib/ai/analyse";
import { isSameOriginRequest } from "@/lib/auth/form";
import { getCurrentUser } from "@/lib/auth/dal";
import { canOpen, roleLabel } from "@/lib/auth/roles";
import type { AuthUser } from "@/lib/auth/token";

/**
 * Plumbing shared by the three AI routes.
 *
 * These endpoints spend money on every call, so they are treated as mutations even
 * though they only read an image: they require a session, they require a role that
 * opens the screen the endpoint belongs to, they require a same-origin POST, and they
 * never cache. A missing key is a 503 with a code the screen can act on, because "live
 * analysis is off" is a different message from "the model was asked and failed", and
 * the operator deserves the right one.
 */

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
/**
 * audio is transcribed by Azure Speech, whose short-audio endpoint reads 16 kHz mono
 * PCM WAV and nothing else. The capture screen re-encodes whatever the browser recorded
 * (WebM) or the collector attached into exactly that shape before the request leaves,
 * so this is a real constraint on the wire rather than a narrowing that would silently
 * drop a usable clip.
 */
const AUDIO_TYPES = ["audio/wav", "audio/x-wav", "audio/wave"];

/**
 * Base64 characters, not binary bytes: 4 MB of base64 is about 3 MB of a file.
 *
 * Each attachment is bounded on its own, and each one fits on its own. The pair is
 * bounded separately by `MAX_TOTAL_CHARS` below, because the limit that actually
 * bites is not this file's.
 */
const MAX_IMAGE_CHARS = 4_000_000;
const MAX_AUDIO_CHARS = 4_000_000;

/**
 * Both attachments together, in base64 characters.
 *
 * Amplify Hosting serves this app through Lambda, which refuses a synchronous
 * request body above 6 MiB before the handler is ever entered. Measured against the
 * live deployment: 6,000,000 bytes reached the app and came back 401, while
 * 6,291,456 bytes came back 413 straight from the platform, with no JSON body for
 * the screen to read. Base64 costs four characters per three bytes, so 5.5 M
 * characters is about 4.1 MB of real file and leaves roughly half a megabyte of
 * headroom under that ceiling.
 *
 * Without this check a photo and a voice note that each passed their own limit would
 * together produce a failure this code never sees, reported to the operator as an
 * unexplained HTTP status.
 */
const MAX_TOTAL_CHARS = 5_500_000;

const MAX_NOTE_CHARS = 1_200;

export interface AiRequestPayload {
  photo?: AiMediaPart;
  audio?: AiMediaPart;
  note?: string;
  declaredMassGrams?: number;
  durationSeconds?: number;
}

export function jsonResponse(value: unknown, status = 200): NextResponse {
  return NextResponse.json(value, {
    status,
    headers: {
      // Personalized, spend-per-call, and useless to any other user.
      "cache-control": "private, no-store",
    },
  });
}

function failure(code: string, message: string, status: number, extra?: Record<string, unknown>) {
  return jsonResponse({ error: code, message, ...extra }, status);
}

/**
 * Who may call an endpoint, in the order that costs least to check.
 *
 * The request must be same-origin, it must carry a session, and the session's role
 * must open `pathname` under the same access matrix the screens use.
 *
 * The role check is not decoration. `proxy.ts` excludes `/api` from its matcher, so
 * the matrix would otherwise stop at the pages: an account holding no Cognito group
 * at all — which every screen in the product turns away, and which `/no-access`
 * describes as opening nothing — could still ask the model to work. Every one of
 * these calls spends money.
 */
/** The session, or the refusal to answer. See `authorizeUser`. */
export type Access =
  | { ok: true; user: AuthUser }
  | { ok: false; denied: NextResponse };

/**
 * How a refusal describes the action, in the three places a sentence needs it.
 *
 * Three fields rather than one so that all three sentences stay grammatical: "Sign in
 * to run a live analysis", "it cannot run an analysis", and "Running an analysis is
 * limited to officer or above". A single phrase cannot be dropped into all three.
 */
export interface AccessAction {
  /** Opens the rank refusal: "Running an analysis is limited to officer or above". */
  subject: string;
  /** Follows "Sign in to". */
  signIn: string;
  /** Follows "it cannot". */
  refuse: string;
}

/** The wording the three AI routes have always used, so their messages do not drift. */
const AN_ANALYSIS: AccessAction = {
  subject: "Running an analysis",
  signIn: "run a live analysis",
  refuse: "run an analysis",
};

/**
 * The session and the authority to act, or the response that explains why not.
 *
 * Returns the verified user rather than a boolean because the callers need more than
 * permission: `/api/ai/*` signs the submission into `media_assets` with the uploader's
 * Cognito subject, and reading it back a second time to find who was asking would mean
 * verifying the same token twice. `authorize` used to return a bare `NextResponse |
 * null`, which threw that identity away.
 */
export async function authorizeUser(
  request: Request,
  pathname: string,
  action: AccessAction = AN_ANALYSIS,
): Promise<Access> {
  if (!isSameOriginRequest(request)) {
    return {
      ok: false,
      denied: failure("cross_origin", "This endpoint only accepts same-origin requests.", 403),
    };
  }
  const user = await getCurrentUser();
  if (!user) {
    return { ok: false, denied: failure("unauthorized", `Sign in to ${action.signIn}.`, 401) };
  }
  const verdict = canOpen(pathname, user.role);
  if (!verdict.ok) {
    return {
      ok: false,
      denied: failure(
        "forbidden",
        verdict.reason === "no-role"
          ? `This account has no role yet, so it cannot ${action.refuse}. An owner or admin grants one in the Cognito console.`
          : `${action.subject} is limited to ${verdict.guard.requirement}; this account is ${roleLabel(user.role)}.`,
        403,
      ),
    };
  }
  return { ok: true, user };
}

export function readPayload(body: unknown): { ok: true; payload: AiRequestPayload } | { ok: false; response: NextResponse } {
  if (typeof body !== "object" || body === null) {
    return { ok: false, response: failure("bad_request", "Body must be a JSON object.", 400) };
  }
  const raw = body as Record<string, unknown>;

  const photo = readMediaPart(raw.photo, IMAGE_TYPES, MAX_IMAGE_CHARS, "photo");
  if (!photo.ok) return { ok: false, response: photo.response };
  const audio = readMediaPart(raw.audio, AUDIO_TYPES, MAX_AUDIO_CHARS, "audio");
  if (!audio.ok) return { ok: false, response: audio.response };

  const totalChars =
    (photo.value?.dataBase64.length ?? 0) + (audio.value?.dataBase64.length ?? 0);
  if (totalChars > MAX_TOTAL_CHARS) {
    return {
      ok: false,
      response: failure(
        "payload_too_large",
        `The photo and the voice note together are ${Math.round(totalChars / 1024 / 1024)} MB encoded, and one request can carry about 5.5 MB. Send one of them, or attach a smaller clip.`,
        413,
      ),
    };
  }

  if (!photo.value && !audio.value && !String(raw.note ?? "").trim()) {
    return {
      ok: false,
      response: failure(
        "empty_request",
        "Attach a photo, a voice note, or describe the item in words.",
        400,
      ),
    };
  }

  const declaredMass =
    typeof raw.declaredMassGrams === "number" && raw.declaredMassGrams > 0
      ? Math.round(raw.declaredMassGrams)
      : undefined;
  if (declaredMass !== undefined && declaredMass > 200_000) {
    return { ok: false, response: failure("bad_request", "Declared mass is above 200 kg.", 400) };
  }

  const duration =
    typeof raw.durationSeconds === "number" && raw.durationSeconds > 0
      ? Math.min(600, Math.round(raw.durationSeconds))
      : undefined;

  return {
    ok: true,
    payload: {
      photo: photo.value,
      audio: audio.value,
      note: String(raw.note ?? "").trim().slice(0, MAX_NOTE_CHARS) || undefined,
      declaredMassGrams: declaredMass,
      durationSeconds: duration,
    },
  };
}

function readMediaPart(
  value: unknown,
  allowed: string[],
  maxChars: number,
  label: string,
): { ok: true; value?: AiMediaPart } | { ok: false; response: NextResponse } {
  if (value === undefined || value === null) return { ok: true };
  if (typeof value !== "object") {
    return { ok: false, response: failure("bad_request", `${label} must be an object.`, 400) };
  }
  const part = value as Record<string, unknown>;
  const mimeType = String(part.mimeType ?? "").toLowerCase().split(";")[0].trim();
  if (!allowed.includes(mimeType)) {
    return {
      ok: false,
      response: failure(
        "unsupported_media",
        `${label} must be one of ${allowed.join(", ")} (received "${mimeType}").`,
        415,
      ),
    };
  }

  // Accept a data URL and keep only the payload: browsers produce them when a file
  // is read with FileReader, and doubling the prefix would break the byte count.
  const rawData = String(part.dataBase64 ?? "").replace(/^data:[^,]*,/, "");
  const data = rawData.replace(/\s+/g, "");
  if (data.length === 0) {
    return { ok: false, response: failure("bad_request", `${label} carried no data.`, 400) };
  }
  if (data.length > maxChars) {
    return {
      ok: false,
      response: failure(
        "payload_too_large",
        `${label} is ${Math.round(data.length / 1024 / 1024)} MB decoded, over the ${Math.round(maxChars / 1024 / 1024)} MB limit.`,
        413,
      ),
    };
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    return { ok: false, response: failure("bad_request", `${label} is not valid base64.`, 400) };
  }

  return { ok: true, value: { mimeType, dataBase64: data } };
}

/**
 * The code the screen turns into words, decided by the status the provider sent.
 *
 * One generic `ai_call_failed` hid the difference between four problems that need
 * four different actions, so each gets its own code: a key with no credits (402), a
 * key that is not accepted (401/403), a model id that has been retired (404), and a
 * model that is merely busy (429/503).
 *
 * The status decides, never the message, because the same status word can mean
 * different things across providers and the message is prose the operator cannot act
 * on.
 */
export function aiCallFailureCode(status: number | undefined): string {
  switch (status) {
    case 402:
      return "ai_credits";
    case 401:
    case 403:
      return "ai_key_rejected";
    case 404:
      return "ai_model_missing";
    case 429:
    case 503:
      return "ai_at_capacity";
    default:
      return "ai_call_failed";
  }
}

/** One place that turns a thrown AI error into the status the screen should show. */
export function aiErrorResponse(error: unknown): NextResponse {
  if (error instanceof AiUnavailableError) {
    return failure("ai_unavailable", error.message, 503);
  }
  if (error instanceof AiProposalInvalidError) {
    return failure(
      "ai_reply_invalid",
      "The model answered, but not in a shape this system will price. Nothing was credited.",
      422,
      { issues: error.issues },
    );
  }
  if (error instanceof AiCallError) {
    return failure(
      aiCallFailureCode(error.status),
      error.message,
      error.status && error.status >= 500 ? 502 : error.status ?? 502,
    );
  }
  console.error("[ai] unexpected failure", error);
  return failure("ai_failed", "The analysis failed before it produced an answer.", 500);
}
