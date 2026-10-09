import type {
  ExtractedField,
  GatekeeperVerdict,
  ItemCondition,
  MaterialLine,
  ResolvedItemSummary,
  Valuation,
  VoiceNote,
} from "@/lib/types";
import type { ItemClassCode, MaterialId } from "@/lib/data/rate-card";

/**
 * The contract between the model and the money.
 *
 * Read the split carefully, because it is the whole design: the model is allowed
 * to name a material (from a closed list) and estimate its mass in grams. It is
 * not allowed to emit a rupee figure, a rate, a handling fee or a credit. Those
 * come out of `lib/data/rate-card.ts` on the server, after the model's answer has
 * been parsed and validated. A language model that can type a price is a
 * liability, not a feature — and on this product every price is a payout.
 */

/** What the model may say about one material fraction. No prices, by construction. */
export interface ProposedMaterial {
  id: MaterialId;
  /** Item-specific description, e.g. "Copper windings". */
  name: string;
  /** Estimated mass of this fraction across the whole submission. */
  massGrams: number;
}

export interface ProposalGatekeeper {
  verdict: GatekeeperVerdict["verdict"];
  confidence: number;
  matchedClass: string;
  reason: string;
  /** Reject rule that fired, or "none". Closed list, see REJECT_RULE_CODES. */
  ruleCode: string;
  signals: { label: string; value: string }[];
}

/** Raw, unvalidated shape of the identification call. */
export interface ProposalItem {
  itemClass: ItemClassCode;
  itemLabel: string;
  brand: string;
  condition: ItemCondition;
  unitCount: number;
  stateCode: string;
  hazards: string[];
  materials: ProposedMaterial[];
  gatekeeper: ProposalGatekeeper;
  notes: string;
}

/**
 * A Hindi voice note, as the intake screen reads it. The template on screen is
 * the fixture's: verbatim Devanagari, then the English a supervisor can check.
 */
export interface ProposalTranscript {
  language: string;
  text: string;
  translation: string;
  words: number;
}

/**
 * Intake is the same identification pass, plus what the collector actually said.
 * One call, not two: the collector is standing in a lane holding a phone, and the
 * value has to come back in the same breath as "here's what I heard".
 */
export interface ProposalIntake extends ProposalItem {
  fields: ExtractedField[];
  transcript: ProposalTranscript | null;
}

/** Which model actually answered, so the screen can say so instead of implying. */
export interface AiSource {
  provider: "gemini";
  model: string;
  /** Seconds of server work for the whole request, model plus pricing. */
  latencyMs: number;
  calledAt: string;
  /** What was sent: "photo", "voice", "text". */
  inputs: string[];
}

/**
 * A submission the model has described and the rate card has priced. This is
 * what the screens render, and it is deliberately the same shape the fixtures
 * use (`materials` + `valuation` + `gatekeeper`), so no screen needs to know
 * whether the item was faked or photographed.
 */
export interface AiAnalysis {
  id: string;
  identified: {
    itemClass: ItemClassCode;
    className: string;
    cpcb: string;
    itemLabel: string;
    brand: string;
    condition: ItemCondition;
    unitCount: number;
    stateCode: string;
    hazards: string[];
    massGrams: number;
    hazardous: boolean;
  };
  materials: MaterialLine[];
  valuation: Valuation;
  gatekeeper: GatekeeperVerdict;
  /** Compact form for headers and lists, same summary the fixture path builds. */
  summary: ResolvedItemSummary;
  /** The catalogue entry this most resembles, when one matches. */
  matchedFixtureId: string | null;
  source: AiSource;
  /** Anything a reviewer should know: clamped fields, missing inputs, guesses. */
  warnings: string[];
}

export interface AiIntakeResult {
  fields: ExtractedField[];
  voiceNote: VoiceNote | null;
  analysis: AiAnalysis | null;
  source: AiSource;
  warnings: string[];
}

/** Reject rules as they exist in the gatekeeper fixture and the model prompt. */
export const REJECT_RULE_CODES = ["none", "R-01", "R-02", "R-03", "R-04"] as const;

export const PROPOSAL_WARNINGS = {
  noMedia: "No photo or voice note was attached, so this is a text-only reading.",
  massClamped: "One or more mass estimates were outside a plausible range and were clamped.",
  partialMaterials: "Some material fractions returned no mass and were dropped.",
} as const;
