/**
 * The speech-to-text seam — Azure Speech, in the same account the model runs in.
 *
 * This exists because Microsoft Foundry's vision deployment cannot read audio, and the
 * subscription this app runs on cannot host an audio-capable model. So the Hindi voice
 * note is transcribed by the speech recogniser first and the transcript is handed to the
 * model as the collector's own words: two calls, one answer.
 *
 * It is deliberately a separate module with no shared state with `lib/ai/foundry.ts`:
 * the recogniser and the model are different services with different endpoints, budgets
 * and failure modes, and keeping them apart is what let the app keep working the day the
 * model could no longer read a voice note.
 *
 * The short-audio REST endpoint takes 16 kHz mono PCM WAV — which the capture screen
 * already produces — so the bytes arrive in the one shape it accepts.
 */

import { AiCallError, type AiMediaPart } from "@/lib/ai/foundry";

export interface SpeechTranscript {
  /** Verbatim Devanagari, exactly as the recogniser returned it. */
  text: string;
  /** BCP-47 tag and label, matching what the voice-note card shows. */
  language: string;
}

/**
 * The speech region tracks the AI Services account's region, because a Speech endpoint
 * is regional (`<region>.stt.speech.microsoft.com`) even when the key is not. It is
 * spelled as its own variable rather than parsed out of the model endpoint, which does
 * not carry the region.
 */
const DEFAULT_SPEECH_REGION = "koreacentral";

const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

/** Well short of the host's ~30 s request ceiling, and independent of the model budget. */
const BUDGET_MS = 15_000;

const LANGUAGE = "hi-IN";

/** The only content type the short-audio endpoint reads, and the only one the app sends. */
const AUDIO_CONTENT_TYPES: Record<string, string> = {
  "audio/wav": "audio/wav; codecs=audio/pcm; samplerate=16000",
  "audio/x-wav": "audio/wav; codecs=audio/pcm; samplerate=16000",
  "audio/wave": "audio/wav; codecs=audio/pcm; samplerate=16000",
};

function speechRegion(): string {
  return process.env.AZURE_SPEECH_REGION?.trim() || DEFAULT_SPEECH_REGION;
}

/**
 * The fallback to `AZURE_OPENAI_API_KEY` is not a shortcut: the Speech key of an AI
 * Services account *is* the account key, so on this deployment they are the same value.
 * The separate name exists for the case where a dedicated Speech resource is used.
 */
function speechKey(): string {
  return process.env.AZURE_SPEECH_KEY?.trim() || process.env.AZURE_OPENAI_API_KEY?.trim() || "";
}

export function speechConfigured(): boolean {
  return Boolean(speechKey());
}

/**
 * Transcribe one Hindi clip.
 *
 * Returns `null` for a clip that contains no speech — a recogniser answers `NoMatch` or
 * `InitialSilenceTimeout` for silence, and that is a correct result, not a failure. It is
 * the difference the intake pipeline depends on: a two-second silent recording must not
 * become a confident transcript of an item nobody mentioned.
 */
export async function transcribeHindi(media: AiMediaPart): Promise<SpeechTranscript | null> {
  const key = speechKey();
  if (!key) {
    throw new AiCallError(
      "Speech to text is not configured: set AZURE_SPEECH_REGION and AZURE_SPEECH_KEY (or AZURE_OPENAI_API_KEY).",
      503,
    );
  }

  const mime = media.mimeType.toLowerCase().split(";")[0].trim();
  const contentType = AUDIO_CONTENT_TYPES[mime];
  if (!contentType) {
    throw new AiCallError(
      `Speech to text reads 16 kHz WAV audio, and this clip is ${mime}. The browser re-encodes a recording to WAV before it is sent.`,
      415,
    );
  }

  const bytes = Buffer.from(media.dataBase64, "base64");
  if (bytes.length === 0) return null;
  if (bytes.length > MAX_AUDIO_BYTES) {
    throw new AiCallError(
      `The voice note is ${Math.round(bytes.length / 1024 / 1024)} MB, over the ${MAX_AUDIO_BYTES / 1024 / 1024} MB limit.`,
      413,
    );
  }

  let response: Response;
  try {
    response = await fetch(
      `https://${speechRegion()}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${LANGUAGE}`,
      {
        method: "POST",
        headers: {
          "content-type": contentType,
          "Ocp-Apim-Subscription-Key": key,
          accept: "application/json",
        },
        body: bytes,
        signal: AbortSignal.timeout(BUDGET_MS),
      },
    );
  } catch (error) {
    const reason =
      (error as Error).name === "TimeoutError" ? "ran out of time" : "could not be reached";
    throw new AiCallError(`Speech to text ${reason} (in a ${BUDGET_MS} ms budget).`);
  }

  const body = await response.text();

  if (!response.ok) {
    const snippet = body.slice(0, 300).replace(/\s+/g, " ");
    const hint =
      response.status === 401 || response.status === 403
        ? " Check AZURE_SPEECH_KEY / AZURE_OPENAI_API_KEY."
        : "";
    throw new AiCallError(
      `Speech to text responded ${response.status}.${hint} ${snippet}`,
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new AiCallError("Speech to text returned a body that was not JSON.");
  }

  const parsed = payload as { RecognitionStatus?: string; DisplayText?: string };
  if (parsed.RecognitionStatus !== "Success") return null;
  const text = (parsed.DisplayText ?? "").trim();
  if (!text) return null;
  return { text, language: "Hindi (hi-IN)" };
}
