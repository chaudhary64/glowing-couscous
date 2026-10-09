import {
  ITEM_CLASSES,
  RATE_BASIS,
  RATE_VALID_UNTIL,
  eprCreditFor,
  eprNoteId,
  handlingFeeFor,
  isHazardous,
  itemMass,
  material,
  priceMaterials,
  stableSerial,
  type ItemClassCode,
} from "@/lib/data/rate-card";
import { formatMass } from "@/lib/format";
import { getAiProvider, type AiMediaPart } from "@/lib/ai/gemini";
import { parseIntakeProposal, parseItemProposal } from "@/lib/ai/parse";
import {
  INTAKE_SYSTEM_INSTRUCTION,
  ITEM_SYSTEM_INSTRUCTION,
  itemPrompt,
  itemResponseSchema,
} from "@/lib/ai/prompt";
import type {
  AiAnalysis,
  AiIntakeResult,
  AiSource,
  ProposalIntake,
  ProposalItem,
} from "@/lib/ai/proposal";
import type {
  GatekeeperVerdict,
  MaterialLine,
  ResolvedItemSummary,
  Valuation,
  VoiceNote,
} from "@/lib/types";

/**
 * From a photograph to a priced, gated item — on the server, in one place.
 *
 * The order is the argument: the model proposes, the parser validates against the
 * closed vocabulary, and only then does the rate card put rupees on it. Nothing
 * the model says is trusted further than its material ids and mass estimates, and
 * even those are clamped before they reach an arithmetic path.
 */

/** The model answered, but not with something this application can price. */
export class AiProposalInvalidError extends Error {
  constructor(readonly issues: string[]) {
    super(`Model reply failed validation: ${issues.join("; ")}`);
    this.name = "AiProposalInvalidError";
  }
}

export interface AnalyseItemInput {
  media?: AiMediaPart[];
  note?: string;
  declaredMassGrams?: number;
}

export interface AnalyseIntakeInput {
  media?: AiMediaPart[];
  note?: string;
  /** Recording length in seconds, measured on the device that recorded it. */
  durationSeconds?: number;
}

const STATE_CODE = "MH";

/** "09 Oct 2026, 14:26 IST" — the shape every fixture timestamp already uses. */
export function istStamp(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")} IST`;
}

function hasImage(media: AiMediaPart[]): boolean {
  return media.some((part) => part.mimeType.startsWith("image/"));
}

function hasAudio(media: AiMediaPart[]): boolean {
  return media.some((part) => part.mimeType.startsWith("audio/"));
}

function describeInputs(media: AiMediaPart[], note?: string): string[] {
  const inputs: string[] = [];
  if (hasImage(media)) inputs.push("photo");
  if (hasAudio(media)) inputs.push("voice");
  if (note?.trim()) inputs.push("text");
  return inputs.length > 0 ? inputs : ["text"];
}

/**
 * The catalogue sample this class most resembles. Used to show the operator what
 * a comparable item assayed at, never to price the live item.
 */
function referenceFixtureId(code: ItemClassCode): string | null {
  const map: Partial<Record<ItemClassCode, string>> = {
    board_it: "ECO-2026-0431",
    battery_li: "ECO-2026-0432",
    display_crt: "ECO-2026-0433",
    component_psu: "ECO-2026-0434",
    handset: "ECO-2026-0435",
    not_ewaste: "ECO-2026-0436",
  };
  return map[code] ?? null;
}

/**
 * Price and gate a validated proposal. Pure: same proposal in, same numbers out.
 *
 * The EPR credit follows the fixture's own story rather than a formula invented
 * here. A verified or held item mints a note for its class; a rejected item earns
 * nothing — except the one case that must be shown, a working device held under
 * R-03, whose credit is displayed and explicitly withheld, because "this could
 * have been ₹310 and it is not" is the point of the reuse rule.
 */
export function priceProposal(
  proposal: ProposalItem | ProposalIntake,
  source: AiSource,
  warnings: string[],
): AiAnalysis {
  const code = proposal.itemClass;
  const entry = ITEM_CLASSES[code];

  const lines: MaterialLine[] = proposal.materials.map((line) =>
    material(line.id, line.name, line.massGrams),
  );
  const massGrams = itemMass(lines);
  const hazardous = isHazardous(lines);
  const { ruleCode } = proposal.gatekeeper;

  /**
   * A verified outcome requires visual evidence, and this is enforced here rather
   * than asked for in the prompt.
   *
   * Measured behaviour, not a hypothetical: two seconds of digital silence sent to
   * the intake route came back with a confident Devanagari transcript about a
   * damaged keyboard and a `verified` verdict. A model will describe what it was
   * asked to describe, so the rule that a spoken claim cannot on its own mint a
   * credit lives in the policy layer, where a hallucination cannot argue with it.
   * Hold for a human instead; the collector is not refused, just not paid blind.
   */
  let verdict = proposal.gatekeeper.verdict;
  const policyWarnings: string[] = [];
  if (verdict === "verified" && !source.inputs.includes("photo")) {
    verdict = "review";
    policyWarnings.push(
      "Held for review: a verified outcome needs a photograph. A spoken or typed description alone cannot earn an automatic credit.",
    );
  }

  const serialSeed = [
    proposal.itemLabel,
    proposal.brand,
    massGrams,
    proposal.unitCount,
  ].join("|");

  const scheduleCredit = eprCreditFor(code, true) * proposal.unitCount;
  let eprCreditInr: number;
  let eprCreditNote: string;
  if (verdict !== "rejected") {
    eprCreditInr = scheduleCredit;
    eprCreditNote = eprNoteId(code, proposal.stateCode || STATE_CODE, serialSeed);
  } else if (ruleCode === "R-03") {
    eprCreditInr = scheduleCredit;
    eprCreditNote = "withheld — no material credit";
  } else {
    eprCreditInr = 0;
    eprCreditNote = "not issued — item rejected";
  }

  const valuation: Valuation = priceMaterials(lines, {
    // A handling fee pays for moving material. With no fractions declared there is
    // nothing to move, and charging for it would show a collector a negative net.
    handlingFee: lines.length === 0 ? 0 : handlingFeeFor(code),
    eprCreditInr,
    eprCreditNote,
    rateBasis: RATE_BASIS,
    validUntil: RATE_VALID_UNTIL,
  });

  const signals =
    proposal.gatekeeper.signals.length > 0
      ? proposal.gatekeeper.signals
      : [
          { label: "Matched class", value: entry.cpcb },
          { label: "Mass estimate", value: formatMass(massGrams) },
          {
            label: "Evidence",
            value: source.inputs.includes("photo")
              ? "Photo analysis"
              : "Collector description only",
          },
        ];

  const gatekeeper: GatekeeperVerdict = {
    verdict,
    confidence: proposal.gatekeeper.confidence,
    modelVersion: source.model,
    checkedAt: source.calledAt,
    // Carried separately from the model id: the rule is a policy decision, not a
    // model fact, and the screen labels it as such.
    ruleCode: ruleCode === "none" ? undefined : ruleCode,
    matchedClass: proposal.gatekeeper.matchedClass || entry.cpcb,
    reason: proposal.gatekeeper.reason || proposal.notes,
    signals,
  };

  const id = `LIVE-2026-${stableSerial(serialSeed)}`;
  const summary: ResolvedItemSummary = {
    id,
    label: proposal.itemLabel,
    category: entry.label,
    brand: proposal.brand,
    condition: proposal.condition,
    massGrams,
    netToCollector: valuation.netToCollector,
    creditNote: valuation.eprCreditNote,
    verdict,
  };

  const raised = [...warnings, ...policyWarnings];
  if (lines.length === 0) {
    raised.push(
      "No material fractions were declared, so there is nothing to pay for on this submission.",
    );
  }
  if (!source.inputs.includes("photo")) {
    raised.push(
      "No photograph was attached, so the identification rests on the collector's words.",
    );
  }
  if (verdict === "review") {
    raised.push(
      "Held for a human decision before a van is dispatched, so nobody is promised a price yet.",
    );
  }
  if (proposal.unitCount > 1) {
    raised.push(
      `Priced for ${proposal.unitCount} units; the credit is a per-unit schedule multiplied by count.`,
    );
  }

  return {
    id,
    identified: {
      itemClass: code,
      className: entry.label,
      cpcb: entry.cpcb,
      itemLabel: proposal.itemLabel,
      brand: proposal.brand,
      condition: proposal.condition,
      unitCount: proposal.unitCount,
      stateCode: proposal.stateCode || STATE_CODE,
      hazards: proposal.hazards,
      massGrams,
      hazardous,
    },
    materials: lines,
    valuation,
    gatekeeper,
    summary,
    matchedFixtureId: referenceFixtureId(code),
    source,
    warnings: raised,
  };
}

/** Identify, assay and gate one submission. Throws on unpriceable output. */
export async function analyseItem(input: AnalyseItemInput): Promise<AiAnalysis> {
  const started = Date.now();
  const provider = getAiProvider();
  const media = input.media ?? [];

  const call = await provider.generate({
    systemInstruction: ITEM_SYSTEM_INSTRUCTION,
    prompt: itemPrompt({
      note: input.note,
      declaredMassGrams: input.declaredMassGrams,
      hasPhoto: hasImage(media),
    }),
    media,
    schema: itemResponseSchema(),
  });

  const parsed = parseItemProposal(call.text);
  if (!parsed.ok) throw new AiProposalInvalidError(parsed.errors);

  const warnings = [...parsed.warnings];
  if (call.fallbackFrom) {
    warnings.push(
      `${call.fallbackFrom} was at capacity, so ${call.model} answered instead.`,
    );
  }

  return priceProposal(
    parsed.value,
    {
      provider: "gemini",
      model: call.model,
      latencyMs: Date.now() - started,
      calledAt: istStamp(),
      inputs: describeInputs(media, input.note),
    },
    warnings,
  );
}

/**
 * The intake pass: the same identification, plus what the collector said. One
 * round trip, because this runs while somebody is standing in a lane.
 */
export async function analyseIntake(
  input: AnalyseIntakeInput,
): Promise<AiIntakeResult> {
  const started = Date.now();
  const provider = getAiProvider();
  const media = input.media ?? [];

  const call = await provider.generate({
    systemInstruction: INTAKE_SYSTEM_INSTRUCTION,
    prompt: itemPrompt({
      note: input.note,
      hasPhoto: hasImage(media),
      intake: true,
    }),
    media,
    schema: itemResponseSchema({ intake: true }),
    temperature: 0.3,
  });

  const defaultMode = hasImage(media) ? "photo" : "voice";
  const parsed = parseIntakeProposal(call.text, defaultMode);
  if (!parsed.ok) throw new AiProposalInvalidError(parsed.errors);

  const warnings = [...parsed.warnings];
  if (call.fallbackFrom) {
    warnings.push(
      `${call.fallbackFrom} was at capacity, so ${call.model} answered instead.`,
    );
  }
  let voiceNote: VoiceNote | null = null;
  if (parsed.value.transcript) {
    const transcript = parsed.value.transcript;
    const words = transcript.words || transcript.text.split(/\s+/).length;
    let durationSeconds = input.durationSeconds ?? 0;
    if (durationSeconds <= 0) {
      // Hindi speech runs near 2.5 words a second. When the browser could not tell
      // us how long the recording was, say that the length is inferred rather than
      // presenting a guess as a measurement.
      durationSeconds = Math.max(1, Math.round(words / 2.5));
      warnings.push(
        "Recording length was inferred from the transcript, not measured from the audio.",
      );
    }
    voiceNote = {
      language: transcript.language,
      durationSeconds,
      transcript: transcript.text,
      translation: transcript.translation,
      words,
    };
  } else if (hasAudio(media)) {
    warnings.push("Audio was attached but no transcript came back; nothing was transcribed.");
  }

  const source: AiSource = {
    provider: "gemini",
    model: call.model,
    latencyMs: Date.now() - started,
    calledAt: istStamp(),
    inputs: describeInputs(media, input.note),
  };

  const analysis = priceProposal(parsed.value, source, warnings);

  return {
    fields: parsed.value.fields,
    voiceNote,
    analysis,
    source,
    // The priced result carries the policy holds, so the intake result reports them
    // too rather than showing a shorter list than the valuation it came from.
    warnings: analysis.warnings,
  };
}
