import { NextResponse } from "next/server";

import { AiCallError, AiUnavailableError, type AiMediaPart } from "@/lib/ai/gemini";
import { AiProposalInvalidError } from "@/lib/ai/analyse";
import { isSameOriginPost } from "@/lib/auth/form";
import { getCurrentUser } from "@/lib/auth/dal";

/**
 * Plumbing shared by the three AI routes.
 *
 * These endpoints spend money on every call, so they are treated as mutations even
 * though they only read an image: they require a session, they require a same-origin
 * POST, and they never cache. A missing key is a 503 with a code the screen can act
 * on, because "live analysis is off" is a different message from "the model was
 * asked and failed", and the operator deserves the right one.
 */

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const AUDIO_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/aac",
  "audio/flac",
];

/** Base64 characters, not binary bytes: 4 MB of base64 is about 3 MB of photo. */
const MAX_IMAGE_CHARS = 4_000_000;
const MAX_AUDIO_CHARS = 8_000_000;

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

/** A session is required: these calls cost money and belong to a signed-in operator. */
export async function authorize(request: Request): Promise<NextResponse | null> {
  if (!isSameOriginPost(request)) {
    return failure("cross_origin", "This endpoint only accepts same-origin requests.", 403);
  }
  const user = await getCurrentUser();
  if (!user) {
    return failure("unauthorized", "Sign in to run a live analysis.", 401);
  }
  return null;
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
    return failure("ai_call_failed", error.message, error.status && error.status >= 500 ? 502 : error.status ?? 502);
  }
  console.error("[ai] unexpected failure", error);
  return failure("ai_failed", "The analysis failed before it produced an answer.", 500);
}
