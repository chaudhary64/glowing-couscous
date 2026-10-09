import {
  RATE_CARD,
  isItemClassCode,
  isMaterialId,
  itemClassCodes,
  materialIds,
  type ItemClassCode,
  type MaterialId,
} from "@/lib/data/rate-card";
import {
  REJECT_RULE_CODES,
  type ProposalGatekeeper,
  type ProposalIntake,
  type ProposalItem,
  type ProposalTranscript,
  type ProposedMaterial,
} from "@/lib/ai/proposal";
import type { ExtractedField, InputMode, ItemCondition, Verdict } from "@/lib/types";

/**
 * Everything the model says passes through here before it can reach a screen.
 *
 * The policy is deliberate and worth stating once: anything with a rupee sign on
 * it is computed downstream, so the parser only has to protect two things — the
 * closed vocabulary (a material id or class code that does not exist is never
 * guessed at, because a guess would invent a rate) and the numbers (masses are
 * bounds-checked and clamped, and a bad mass is dropped rather than defaulted).
 * A field the model gets wrong is dropped with a warning the operator can read.
 */

export type ParseResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; errors: string[] };

/** 200 kg. Above this it is not a doorstep pickup, it is a lorry. */
const MAX_MASS_GRAMS = 200_000;
const MAX_UNITS = 500;
const MAX_MATERIAL_LINES = 24;
const MAX_FIELDS = 8;
const MAX_SIGNALS = 8;
const MAX_HAZARDS = 8;

const CONDITIONS: ItemCondition[] = ["working", "dead", "damaged"];
const VERDICTS: Verdict[] = ["verified", "rejected", "review"];
const MODES: InputMode[] = ["photo", "voice"];

/**
 * Aliases the model reaches for even when told not to. This is a translation
 * table, not a guess: every target is a real card entry, so an alias can never
 * introduce a rate that is not already published.
 */
const MATERIAL_ALIASES: Record<string, MaterialId> = (() => {
  const map: Record<string, MaterialId> = {};
  for (const id of materialIds) {
    map[id.toLowerCase()] = id;
  }
  const put = (alias: string, id: MaterialId) => {
    if (!(alias in map)) map[alias] = id;
  };
  for (const id of materialIds) {
    const line = RATE_CARD[id];
    // Skip the symbol for `steel`: "Fe" means light iron on a rate card, and
    // letting casing stock claim it would quietly pay the wrong rate.
    if (line.symbol !== "—" && id !== "steel") put(line.symbol.toLowerCase(), id);
    put(line.name.toLowerCase(), id);
  }
  put("iron", "fe");
  put("scrap iron", "fe");
  put("steel", "steel");
  put("aluminum", "al");
  put("aluminium", "al");
  put("copper wire", "cu");
  put("cu wire", "cu");
  put("battery", "cell");
  put("lithium ion", "li");
  put("li-ion", "li");
  put("circuit board", "resin");
  put("pcb", "resin");
  put("solder", "pb");
  put("glass", "glass");
  put("plastic", "plastic");
  put("plastics", "plastic");
  return map;
})();

export function resolveMaterialId(value: unknown): MaterialId | null {
  if (isMaterialId(value)) return value;
  if (typeof value !== "string") return null;
  return MATERIAL_ALIASES[value.trim().toLowerCase()] ?? null;
}

/* --------------------------------------------------------------- primitives */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function ratio(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  return Math.min(1, Math.max(0, parsed));
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => text(entry))
    .filter((entry) => entry.length > 0)
    .slice(0, max);
}

/** Pull the first JSON object out of a reply that may be fenced or prefixed. */
export function extractJsonObject(
  reply: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const cleaned = reply
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return { ok: false, error: "no JSON object in the model reply" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch (error) {
    return { ok: false, error: `unparseable JSON: ${(error as Error).message}` };
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: "model reply was not a JSON object" };
  }
  return { ok: true, value: parsed };
}

/* ------------------------------------------------------------------- parts */

function parseMaterials(
  raw: unknown,
  warnings: string[],
): { ok: true; value: ProposedMaterial[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(raw)) {
    return { ok: false, errors: ["materials: missing"] };
  }

  // An empty array is a legitimate answer for exactly one case — an item that is not
  // e-waste has no fractions to price — so it is not rejected here. Whether it is
  // allowed is decided against the verdict in `parseItemProposal`, where the
  // difference between "nothing to weigh" and "nothing worth crediting" is visible.

  const merged = new Map<MaterialId, ProposedMaterial>();
  const unknown: string[] = [];

  for (const entry of raw.slice(0, MAX_MATERIAL_LINES)) {
    if (!isRecord(entry)) continue;
    const id = resolveMaterialId(entry.id);
    if (!id) {
      unknown.push(text(entry.id, "unnamed"));
      continue;
    }
    const mass =
      typeof entry.massGrams === "number"
        ? entry.massGrams
        : Number(text(entry.massGrams));
    if (!Number.isFinite(mass) || mass <= 0) {
      // A zero mass is the model saying "none present", which is a fine thing to
      // say; it just does not earn a line on the assay.
      continue;
    }
    let grams = mass;
    if (grams > MAX_MASS_GRAMS) {
      grams = MAX_MASS_GRAMS;
      warnings.push(`"${id}" mass was above ${MAX_MASS_GRAMS} g and was clamped.`);
    }
    const name = text(entry.name, RATE_CARD[id].name).slice(0, 60) || RATE_CARD[id].name;
    const existing = merged.get(id);
    if (existing) {
      // The same fraction listed twice is one fraction. Summing is the only
      // reading that does not lose mass the model meant to report.
      existing.massGrams = Number((existing.massGrams + grams).toFixed(2));
    } else {
      merged.set(id, { id, name, massGrams: Number(grams.toFixed(2)) });
    }
  }

  if (unknown.length > 0) {
    warnings.push(
      `Dropped material ids outside the rate card: ${unknown.slice(0, 6).join(", ")}.`,
    );
  }
  return { ok: true, value: [...merged.values()] };
}

function parseGatekeeper(
  raw: unknown,
  warnings: string[],
): { ok: true; value: ProposalGatekeeper } | { ok: false; errors: string[] } {
  if (!isRecord(raw)) {
    return { ok: false, errors: ["gatekeeper: missing"] };
  }

  const verdict = text(raw.verdict).toLowerCase() as Verdict;
  if (!VERDICTS.includes(verdict)) {
    return {
      ok: false,
      errors: [`gatekeeper.verdict: expected verified/rejected/review, got "${text(raw.verdict)}"`],
    };
  }

  const confidence = ratio(raw.confidence);
  if (confidence === null) {
    // Defaulting a confidence would put an invented percentage next to a
    // payout decision, so this is a hard failure instead.
    return { ok: false, errors: ["gatekeeper.confidence: missing or not a number"] };
  }

  const ruleCode = text(raw.ruleCode, "none");
  const resolvedRule = (REJECT_RULE_CODES as readonly string[]).includes(ruleCode)
    ? ruleCode
    : "none";
  if (resolvedRule !== ruleCode) {
    warnings.push(`Unknown reject rule "${ruleCode}" reported as none.`);
  }

  const signals = Array.isArray(raw.signals)
    ? raw.signals
        .filter(isRecord)
        .map((signal) => ({
          label: text(signal.label).slice(0, 40),
          value: text(signal.value).slice(0, 80),
        }))
        .filter((signal) => signal.label.length > 0 && signal.value.length > 0)
        .slice(0, MAX_SIGNALS)
    : [];

  return {
    ok: true,
    value: {
      verdict,
      confidence,
      matchedClass: text(raw.matchedClass, "Unclassified").slice(0, 80),
      reason: text(raw.reason).slice(0, 600),
      ruleCode: resolvedRule,
      signals,
    },
  };
}

function parseTranscript(raw: unknown): ProposalTranscript | null {
  if (!isRecord(raw)) return null;
  const spoken = text(raw.text);
  if (spoken.length === 0) return null;
  return {
    language: text(raw.language, "Hindi (hi-IN)"),
    text: spoken,
    translation: text(raw.translation),
    words: integer(raw.words, spoken.split(/\s+/).length, 0, 5000),
  };
}

/* --------------------------------------------------------------- proposals */

export function parseItemProposal(reply: string): ParseResult<ProposalItem> {
  const warnings: string[] = [];
  const extracted = extractJsonObject(reply);
  if (!extracted.ok) return { ok: false, errors: [extracted.error] };
  const raw = extracted.value;

  const itemClass = raw.itemClass;
  if (!isItemClassCode(itemClass)) {
    return {
      ok: false,
      errors: [
        `itemClass: "${text(itemClass)}" is not a known class code (${itemClassCodes.join(", ")})`,
      ],
    };
  }

  const materials = parseMaterials(raw.materials, warnings);
  if (!materials.ok) return { ok: false, errors: materials.errors };

  const gatekeeper = parseGatekeeper(raw.gatekeeper, warnings);
  if (!gatekeeper.ok) return { ok: false, errors: gatekeeper.errors };

  if (materials.value.length === 0 && gatekeeper.value.verdict !== "rejected") {
    return {
      ok: false,
      errors: [
        "materials: an empty assay cannot be verified or held — only a rejection may carry no fractions",
      ],
    };
  }

  let condition = text(raw.condition).toLowerCase() as ItemCondition;
  if (!CONDITIONS.includes(condition)) {
    warnings.push(`Condition "${text(raw.condition)}" was not in range; recorded as dead.`);
    condition = "dead";
  }

  const unitCount = integer(raw.unitCount, 1, 1, MAX_UNITS);
  if (unitCount !== Number(raw.unitCount)) {
    warnings.push(`Unit count clamped to ${unitCount}.`);
  }

  const declaredState = text(raw.stateCode).toUpperCase();
  const stateCode = /^[A-Z]{2,3}$/.test(declaredState) ? declaredState : "MH";
  if (stateCode !== declaredState) {
    warnings.push("State code missing or malformed; defaulted to MH.");
  }

  return {
    ok: true,
    warnings,
    value: {
      itemClass: itemClass as ItemClassCode,
      itemLabel: text(raw.itemLabel, "Unidentified item").slice(0, 80),
      brand: text(raw.brand, "Unread").slice(0, 40),
      condition,
      unitCount,
      stateCode,
      hazards: stringList(raw.hazards, MAX_HAZARDS),
      materials: materials.value,
      gatekeeper: gatekeeper.value,
      notes: text(raw.notes).slice(0, 600),
    },
  };
}

/**
 * Intake adds the collector's words to the identification pass. `defaultMode` is
 * what was actually sent, so a field the model mislabels cannot claim a photo saw
 * something only the voice note said.
 */
export function parseIntakeProposal(
  reply: string,
  defaultMode: InputMode = "photo",
): ParseResult<ProposalIntake> {
  const base = parseItemProposal(reply);
  if (!base.ok) return base;

  const warnings = [...base.warnings];
  const extracted = extractJsonObject(reply);
  const raw = extracted.ok ? extracted.value : {};

  const rawFields = Array.isArray(raw.fields) ? raw.fields.slice(0, MAX_FIELDS) : [];
  const fields: ExtractedField[] = [];
  for (const entry of rawFields) {
    if (!isRecord(entry)) continue;
    const label = text(entry.label).slice(0, 40);
    const value = text(entry.value).slice(0, 80);
    if (!label || !value) continue;
    const source = text(entry.source).toLowerCase() as InputMode;
    if (!MODES.includes(source)) {
      warnings.push(`Field "${label}" had no usable source; attributed to ${defaultMode}.`);
    }
    fields.push({
      label,
      value,
      confidence: ratio(entry.confidence) ?? 0,
      source: MODES.includes(source) ? source : defaultMode,
    });
  }

  if (fields.length === 0) {
    return { ok: false, errors: ["fields: the model returned nothing extractable"] };
  }

  return {
    ok: true,
    warnings,
    value: { ...base.value, fields, transcript: parseTranscript(raw.transcript) },
  };
}
