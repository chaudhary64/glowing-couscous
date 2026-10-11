/**
 * The model provider seam — Microsoft Foundry.
 *
 * One narrow interface, one implementation. The rest of the app never imports this
 * file's transport details — it asks for a provider and gets whatever the
 * `AZURE_OPENAI_*` environment justifies. The prompts, the schemas and the pricing
 * are provider-agnostic; only `generate` knows which vendor is answering.
 *
 * The call goes to Foundry's OpenAI-compatible route
 * (`<endpoint>/openai/v1/chat/completions`), so the request is a chat completion:
 * a system message carrying the instructions and the reply schema, and a user
 * message carrying the photograph and the Hindi voice note in one pass. The key is
 * read from the environment at call time and never logged, echoed into a response,
 * or written into a fixture.
 *
 * Two things forced a decision worth stating here:
 *
 * 1. **Audio is WAV or MP3, nothing else.** Foundry's `input_audio` accepts only those
 *    two formats, while a browser records WebM. The capture screen therefore
 *    re-encodes every clip to 16 kHz mono WAV before it is sent, so a recorded Hindi
 *    note and an attached MP3 both arrive in a shape the model accepts.
 * 2. **There is no schema-enforcing mode for the audio deployment.** The reply shape
 *    is carried into the system message as JSON Schema and the answer is parsed
 *    against the closed vocabulary on the way out — which is where the trust was
 *    always placed: the model proposes, the server validates, the rate card prices.
 */

export interface AiMediaPart {
  mimeType: string;
  dataBase64: string;
}

export interface AiCallArgs {
  systemInstruction: string;
  prompt: string;
  media: AiMediaPart[];
  /** JSON Schema for the reply. Carried into the prompt, then parsed, not trusted. */
  schema: Record<string, unknown>;
  temperature?: number;
}

export interface AiCallResult {
  text: string;
  /** Deployment that actually answered, recorded on every screen that shows AI work. */
  model: string;
  latencyMs: number;
  /** Set when a substitute deployment answered. Foundry is configured without one. */
  fallbackFrom?: string;
}

export interface AiProvider {
  readonly id: "foundry";
  readonly model: string;
  generate(args: AiCallArgs): Promise<AiCallResult>;
}

/** No endpoint or key configured. The screens fall back to the fixed sample data. */
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

/**
 * The deployment name, not the underlying model id.
 *
 * Foundry addresses a model by the name *you gave the deployment*, so this is what
 * the provisioning script creates and what `AZURE_OPENAI_DEPLOYMENT` names. The
 * default is the audio-capable `gpt-audio` deployment, because one multimodal call is
 * what reads the photograph and the Hindi voice note together.
 *
 * The audio family is the reason the Region matters: `gpt-audio` is offered in
 * `eastus2` and `swedencentral`, not in every Region, and `scripts/foundry-setup.sh`
 * targets those.
 */
export const DEFAULT_FOUNDRY_DEPLOYMENT = "gpt-audio";

/**
 * The whole budget for one request.
 *
 * This is a ceiling imposed from outside rather than a preference. Amplify Hosting
 * cuts a server-rendered request off at around thirty seconds and answers a bare 504
 * with no body at all. A per-attempt 60 s timeout let this code wait patiently while
 * the platform killed the connection, and the operator was shown a status code
 * instead of the sentence that explains it.
 */
const TOTAL_BUDGET_MS = 26_000;

/** Never hand an attempt less than this: it would be aborted before it could answer. */
const MIN_ATTEMPT_MS = 4_000;

const MAX_MEDIA_BYTES = 8 * 1024 * 1024;

/**
 * Output budget. A reasoning-style model spends thinking tokens out of this same
 * allowance, so a cap that looks generous for a small JSON object can truncate it
 * mid-array and hand the parser a broken document.
 */
const MAX_TEXT_TOKENS = 8192;

/** The only audio containers Foundry's chat completion accepts for `input_audio`. */
const AUDIO_FORMATS: Record<string, "wav" | "mp3"> = {
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
};

function aiEndpoint(): string {
  return (process.env.AZURE_OPENAI_ENDPOINT?.trim() ?? "").replace(/\/+$/, "");
}

export function aiConfigured(): boolean {
  return Boolean(process.env.AZURE_OPENAI_API_KEY?.trim() && aiEndpoint());
}

export function aiModel(): string {
  return process.env.AZURE_OPENAI_DEPLOYMENT?.trim() || DEFAULT_FOUNDRY_DEPLOYMENT;
}

/**
 * The chat-completions URL for whatever shape of endpoint the environment holds.
 *
 * `AZURE_OPENAI_ENDPOINT` is usually the resource endpoint
 * (`https://<name>.openai.azure.com`), but it may already carry the OpenAI v1 path;
 * both are accepted rather than making the operator edit the value to match a guess.
 * The v1 route takes the deployment in the body's `model` field and needs no
 * `api-version`, which is why it is used instead of the older deployment-scoped URL.
 */
function chatCompletionsUrl(endpoint: string): string {
  if (/\/chat\/completions$/.test(endpoint)) return endpoint;
  if (/\/openai\/v1$/.test(endpoint)) return `${endpoint}/chat/completions`;
  if (/\/openai$/.test(endpoint)) return `${endpoint}/v1/chat/completions`;
  return `${endpoint}/openai/v1/chat/completions`;
}

/** The reply contract, appended to the system message in the one dialect Azure reads. */
function withSchema(systemInstruction: string, schema: Record<string, unknown>): string {
  return `${systemInstruction}\n\nReply with a single JSON object matching this JSON Schema exactly. No prose, no markdown, no code fence — the JSON object and nothing else:\n${JSON.stringify(schema)}`;
}

/**
 * The user turn: media first, then the ask, so the model reads the object and then
 * answers the question about it. Every attachment is bounded on its own before it
 * becomes a data URL, and audio that Foundry cannot read is refused here rather than
 * sent to fail with a provider error the operator cannot act on.
 */
function buildContent(args: AiCallArgs, maxBytes = MAX_MEDIA_BYTES): Record<string, unknown>[] {
  const content: Record<string, unknown>[] = [];
  for (const part of args.media) {
    if (part.dataBase64.length === 0) continue;
    const bytes = Math.floor((part.dataBase64.length * 3) / 4);
    if (bytes > maxBytes) {
      throw new AiCallError(
        `Attached ${part.mimeType} is ${Math.round(bytes / 1024 / 1024)} MB, over the ${maxBytes / 1024 / 1024} MB limit.`,
        413,
      );
    }
    const mime = part.mimeType.toLowerCase().split(";")[0].trim();
    if (mime.startsWith("image/")) {
      content.push({
        type: "image_url",
        image_url: { url: `data:${mime};base64,${part.dataBase64}` },
      });
    } else if (mime.startsWith("audio/")) {
      const format = AUDIO_FORMATS[mime];
      if (!format) {
        throw new AiCallError(
          `Live analysis reads WAV or MP3 audio, and this clip is ${mime}. The browser re-encodes a recording to WAV before it is sent.`,
          415,
        );
      }
      content.push({ type: "input_audio", input_audio: { data: part.dataBase64, format } });
    }
  }
  content.push({ type: "text", text: args.prompt });
  return content;
}

async function invoke(
  deployment: string,
  key: string,
  args: AiCallArgs,
  content: Record<string, unknown>[],
  deadline: number,
): Promise<AiCallResult> {
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(chatCompletionsUrl(aiEndpoint()), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": key,
      },
      body: JSON.stringify({
        model: deployment,
        messages: [
          { role: "system", content: withSchema(args.systemInstruction, args.schema) },
          { role: "user", content },
        ],
        temperature: args.temperature ?? 0.2,
        max_tokens: MAX_TEXT_TOKENS,
        response_format: { type: "json_object" },
      }),
      // Measured against the shared deadline, not a fresh per-attempt clock.
      signal: AbortSignal.timeout(Math.max(MIN_ATTEMPT_MS, deadline - Date.now())),
    });
  } catch (error) {
    const elapsed = Date.now() - started;
    const reason =
      (error as Error).name === "TimeoutError" ? "ran out of time" : "could not be reached";
    throw new AiCallError(
      `The AI service ${reason} (${elapsed} ms elapsed, in a ${TOTAL_BUDGET_MS} ms request budget).`,
    );
  }

  const body = await response.text();

  if (!response.ok) {
    // Surface the provider's own words: a bad key, a missing deployment and a
    // content-filter refusal all fail here, and the difference matters to whoever
    // debugs it.
    const snippet = body.slice(0, 400).replace(/\s+/g, " ");

    // A non-audio deployment answers 400 with "content blocks are expected to be text
    // or image_url", which reads like a malformed request rather than the configuration
    // fact it is. Say the configuration fact, because that is the sentence the operator
    // can act on: this deployment cannot read the voice note, whatever it does with the
    // photograph.
    const sentAudio = content.some((part) => part.type === "input_audio");
    if (response.status === 400 && sentAudio && /text or image_url|audio/i.test(body)) {
      throw new AiCallError(
        `The configured AI deployment does not accept audio input, so the voice note could not be read. An audio-capable model has to be deployed and named by AZURE_OPENAI_DEPLOYMENT. ${snippet}`,
        400,
      );
    }

    const hint =
      response.status === 401 || response.status === 403
        ? " Check AZURE_OPENAI_API_KEY."
        : response.status === 404
          ? ` Check AZURE_OPENAI_DEPLOYMENT — the named deployment may not exist on this resource.`
          : response.status === 400 && /content_filter|content management policy/i.test(body)
            ? " The content filter refused the input."
            : "";
    throw new AiCallError(
      `The AI service responded ${response.status}.${hint} ${snippet}`,
      response.status,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new AiCallError("The AI service returned a body that was not JSON.");
  }

  const parsed = payload as {
    choices?: {
      message?: { content?: string | null; refusal?: string | null };
      finish_reason?: string;
    }[];
  };
  const choice = parsed.choices?.[0];
  const text = (choice?.message?.content ?? "").trim();

  // A truncated reply is syntactically broken JSON, which is a misleading thing to
  // report: the fault is the budget, not the model's obedience.
  if (choice?.finish_reason === "length") {
    throw new AiCallError(
      `The AI service hit the ${MAX_TEXT_TOKENS}-token output limit before finishing, so the answer was incomplete and nothing could be priced.`,
      502,
    );
  }

  if (choice?.message?.refusal) {
    throw new AiCallError(
      `The AI service refused the request (${choice.message.refusal.slice(0, 200)}).`,
    );
  }

  if (!text) {
    throw new AiCallError(
      `The AI service returned no text${choice?.finish_reason ? ` (finish_reason ${choice.finish_reason})` : ""}.`,
    );
  }

  return { text, model: deployment, latencyMs: Date.now() - started };
}

export function getAiProvider(): AiProvider {
  const key = process.env.AZURE_OPENAI_API_KEY?.trim();
  const endpoint = aiEndpoint();
  if (!key || !endpoint) {
    throw new AiUnavailableError(
      "AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY are not set, so live analysis is off. The screens show the sample data instead.",
    );
  }

  const model = aiModel();

  return {
    id: "foundry",
    model,
    async generate(args: AiCallArgs): Promise<AiCallResult> {
      const content = buildContent(args);
      const deadline = Date.now() + TOTAL_BUDGET_MS;
      return invoke(model, key, args, content, deadline);
    },
  };
}
