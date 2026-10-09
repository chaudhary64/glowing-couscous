/**
 * The model provider seam.
 *
 * One narrow interface, one implementation. The rest of the app never imports
 * this file's transport details — it asks for a provider and gets whatever
 * `GEMINI_API_KEY` justifies. That is also why the Bedrock swap is a one-file
 * change: the prompts, the schemas and the pricing are provider-agnostic, and
 * only `generate` knows which vendor is answering.
 *
 * The key is read from the environment at call time and never logged, echoed into
 * a response, or written into a fixture.
 */

export interface AiMediaPart {
  mimeType: string;
  dataBase64: string;
}

export interface AiCallArgs {
  systemInstruction: string;
  prompt: string;
  media: AiMediaPart[];
  /** Gemini `responseSchema`. Shapes the reply so it can be parsed, not trusted. */
  schema: Record<string, unknown>;
  temperature?: number;
}

export interface AiCallResult {
  text: string;
  /** Model id that actually answered, recorded on every screen that shows AI work. */
  model: string;
  latencyMs: number;
  /** Set when the configured model was at capacity and this one answered instead. */
  fallbackFrom?: string;
}

export interface AiProvider {
  readonly id: "gemini";
  readonly model: string;
  generate(args: AiCallArgs): Promise<AiCallResult>;
}

/** No key configured. The screens fall back to the fixed sample data. */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

/** The provider was reached but refused, timed out, or answered unusably. */
export class AiCallError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AiCallError";
  }
}

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
export const DEFAULT_FALLBACK_MODEL = "gemini-2.5-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 60_000;
const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

/**
 * Output budget, and the number that mattered most in practice.
 *
 * A reasoning model spends thinking tokens out of this same allowance — measured
 * runs on this prompt spent 1,700 to 3,300 on thinking alone — so a cap that looks
 * generous for a small JSON object truncates it mid-array and hands the parser a
 * broken document. 8192 leaves room for the thought plus the answer; the truncation
 * check below is what makes a future overflow say so instead of looking like bad JSON.
 */
const MAX_TEXT_TOKENS = 8192;

export function aiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export function aiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

export function aiFallbackModel(): string {
  const configured = process.env.GEMINI_FALLBACK_MODEL?.trim();
  if (configured === "off" || configured === "none") return "";
  return configured || DEFAULT_FALLBACK_MODEL;
}

/** Capacity, not correctness: the model is busy or rate-limited, so retrying may work. */
function isCapacityFailure(error: unknown): boolean {
  if (!(error instanceof AiCallError)) return false;
  if (error.status === 429 || error.status === 503) return true;
  return /high demand|overloaded|unavailable|try again later|resource.?exhausted/i.test(
    error.message,
  );
}

function buildParts(args: AiCallArgs, maxBytes = MAX_MEDIA_BYTES): Record<string, unknown>[] {
  const parts: Record<string, unknown>[] = args.media
    .filter((part) => part.dataBase64.length > 0)
    .map((part) => {
      const bytes = Math.floor((part.dataBase64.length * 3) / 4);
      if (bytes > maxBytes) {
        throw new AiCallError(
          `Attached ${part.mimeType} is ${Math.round(bytes / 1024 / 1024)} MB, over the ${maxBytes / 1024 / 1024} MB limit.`,
          413,
        );
      }
      return { inline_data: { mime_type: part.mimeType, data: part.dataBase64 } };
    });
  // Media first, instructions last: the model reads the object, then the ask.
  parts.push({ text: args.prompt });
  return parts;
}

async function invoke(
  model: string,
  key: string,
  args: AiCallArgs,
  parts: Record<string, unknown>[],
): Promise<AiCallResult> {
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: args.systemInstruction }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: args.temperature ?? 0.2,
          responseMimeType: "application/json",
          responseSchema: args.schema,
          maxOutputTokens: MAX_TEXT_TOKENS,
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const reason =
      (error as Error).name === "TimeoutError" ? "timed out" : "could not be reached";
    throw new AiCallError(`Gemini ${reason} after ${Date.now() - started} ms.`);
  }

  const body = await response.text();

  if (!response.ok) {
    // Surface the provider's own words: a disabled key, an overloaded model and an
    // unknown model id all fail here, and the difference matters to whoever debugs it.
    const snippet = body.slice(0, 400).replace(/\s+/g, " ");
    const hint =
      response.status === 401 || response.status === 403
        ? " Check GEMINI_API_KEY."
        : response.status === 404
          ? ` Check GEMINI_MODEL — "${model}" may not be available to this key.`
          : "";
    throw new AiCallError(
      `Gemini responded ${response.status}.${hint} ${snippet}`,
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new AiCallError("Gemini returned a body that was not JSON.");
  }

  const parsed = payload as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };
  const candidate = parsed.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((part) => part.text ?? "")
    .join("")
    .trim();

  // A truncated reply is syntactically broken JSON, which is a misleading thing to
  // report: the fault is the budget, not the model's obedience.
  if (candidate?.finishReason === "MAX_TOKENS") {
    throw new AiCallError(
      `Gemini hit the ${MAX_TEXT_TOKENS}-token output limit before finishing, so the answer was incomplete and nothing could be priced.`,
      502,
    );
  }

  if (!text) {
    const blocked = parsed.promptFeedback?.blockReason;
    const finished = candidate?.finishReason;
    throw new AiCallError(
      blocked
        ? `Gemini blocked the request (${blocked}).`
        : `Gemini returned no text${finished ? ` (finishReason ${finished})` : ""}.`,
    );
  }

  return { text, model, latencyMs: Date.now() - started };
}

export function getAiProvider(): AiProvider {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new AiUnavailableError(
      "GEMINI_API_KEY is not set, so live analysis is off. The screens show the sample data instead.",
    );
  }

  const model = aiModel();
  const fallback = aiFallbackModel();

  return {
    id: "gemini",
    model,
    async generate(args: AiCallArgs): Promise<AiCallResult> {
      const parts = buildParts(args);
      try {
        return await invoke(model, key, args, parts);
      } catch (error) {
        // An overloaded model is a capacity problem, not a wrong answer, so one
        // documented substitute is allowed — but it is never silent: the caller gets
        // `fallbackFrom` and puts it on screen next to the model that answered.
        if (!fallback || fallback === model || !isCapacityFailure(error)) throw error;
        try {
          const result = await invoke(fallback, key, args, parts);
          return { ...result, fallbackFrom: model };
        } catch (retryError) {
          // Both are busy. Say so, and name both, because "503" alone reads like a
          // configuration fault and sends the reader to the wrong place.
          const first = error instanceof Error ? error.message : String(error);
          const second = retryError instanceof Error ? retryError.message : String(retryError);
          throw new AiCallError(
            `Both ${model} and the substitute ${fallback} were unavailable. Primary: ${first.slice(0, 180)} Substitute: ${second.slice(0, 180)}`,
            503,
          );
        }
      }
    },
  };
}
