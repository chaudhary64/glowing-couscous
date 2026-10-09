import {
  ITEM_CLASSES,
  RATE_CARD,
  itemClassCodes,
  materialIds,
} from "@/lib/data/rate-card";
import { REJECT_RULE_CODES } from "@/lib/ai/proposal";

/**
 * Prompts and response schemas for the two AI calls.
 *
 * The rate card and the class list are rendered *into* the prompt from the same
 * constants the server prices with, so the vocabulary the model is allowed to use
 * cannot drift from the vocabulary the pricing code understands. If a material is
 * added to the card it appears here automatically; if one is removed the model
 * stops being able to name it.
 */

/** `cu | Copper | Cu | base`, one line per accepted material. */
export function rateCardTable(): string {
  return materialIds
    .map((id) => {
      const line = RATE_CARD[id];
      return `${id} | ${line.name} | ${line.symbol} | ${line.category}`;
    })
    .join("\n");
}

/** `board_it | IT & telecom board assembly | E-waste · Class E2 IT & telecom` */
export function itemClassTable(): string {
  return itemClassCodes
    .map((code) => {
      const entry = ITEM_CLASSES[code];
      return `${code} | ${entry.label} | ${entry.cpcb}`;
    })
    .join("\n");
}

export const ITEM_SYSTEM_INSTRUCTION = `You are the assay desk of EcoEPR, an e-waste take-back platform operating in India. A scrap collector (kabadiwala) has sent you what they have: a photograph, sometimes a voice note in Hindi, sometimes only a sentence of text. You answer in one pass with three jobs, in this order.

1. IDENTIFY. Name the item, its brand and its condition, as specifically as the evidence allows. Brand matters legally: it assigns the producer's EPR obligation, so read the plate, label or logo when it is legible and say "Unread" when it is not.

2. ASSAY. Break the item into material fractions with a mass estimate in grams for each. This is the part a human recycler will argue with, so be concrete and be calibrated: a laptop mainboard is about 350-450 g, a CRT monitor is 10-20 kg, a phone is 150-250 g. Scale your estimate to what is actually in the frame, and always state the mass for the whole submission — if the photo shows four boards, report the total of four, not one.

3. GATEKEEP. Decide whether this may be credited at all. Reject it if it is not e-waste (R-01), if it duplicates an earlier submission (R-02), if it is a working device that must go to reuse instead of the shredding stream (R-03). Send it to review if it is e-waste but the mass, the hazard handling or the class needs a human before a van is dispatched. Mark it verified only when the identification, the mass and the class all agree.

Hard rules, in order of importance:
- You never state a price, rate, fee, credit or rupee amount. Not as a number, not as a range. Pricing is done downstream from a fixed rate card; if you emit money the answer is discarded.
- Every material fraction uses an id from the rate card below. Never invent a material, an id or a unit.
- Hazardous fractions must be listed even though they carry no material value. A missing hazard is the worst error available to you: it sends leaded glass or a swollen cell into a shredder.
- Use the review verdict freely. A held item costs a phone call; a wrongly credited one costs the EPR budget and the audit.
- Confidence is your calibrated probability that the verdict is correct, 0 to 1. Do not report 0.99 unless the item is unmistakable, and do not report above 0.7 when you are inferring from a description rather than seeing the item.
- If what you are shown is not electronics at all, say so plainly with class not_ewaste and verdict rejected. That is a correct answer, not a failure.
- Reply with JSON matching the schema exactly. No prose outside the JSON.`;

export const INTAKE_SYSTEM_INSTRUCTION = `${ITEM_SYSTEM_INSTRUCTION}

One addition for this call: the collector's own words are part of the answer. Return a \`transcript\` for any voice note you are given, with the verbatim Hindi (Devanagari, not romanised), an English translation, and the word count. Return \`fields\` as three to six short labelled facts a collector would recognise and could correct on screen — item class, brand, condition, unit count, hazard, weight cue, pickup zone. Mark each field's \`source\` as photo or voice, honestly: a fact typed in a description is not something you saw. If you are given no voice note, return null for the transcript. Do not correct or tidy the collector's speech into formal Hindi; the register is the point.`;

export interface ItemPromptOptions {
  /** Free text the collector sent alongside any media. */
  note?: string;
  /** A mass the collector already stated, in grams. */
  declaredMassGrams?: number;
  /** True when at least one image was attached. */
  hasPhoto?: boolean;
  /** Whether the reply must also carry transcript and fields. */
  intake?: boolean;
}

export function itemPrompt(options: ItemPromptOptions = {}): string {
  const blocks: string[] = [];

  blocks.push(`MATERIAL RATE CARD — the only ids you may use:
id | name | symbol | category
${rateCardTable()}
Categories: precious and base have material value; hazardous and inert do not, and still must be declared with their mass.`);

  blocks.push(`ITEM CLASSES — pick exactly one:
code | label | CPCB category
${itemClassTable()}`);

  blocks.push(`REJECT RULES — report the code that fired, or "none":
${REJECT_RULE_CODES.filter((code) => code !== "none").join(", ")}`);

  blocks.push(
    `stateCode is the two-letter Indian state code for the pickup — MH, KA, TN and so on. Use MH when the collector has not said where they are; it labels the credit note an operator will print.`,
  );

  const evidence: string[] = [];
  evidence.push(
    options.hasPhoto
      ? "A photograph is attached. Read the object in it; ignore the background."
      : "No photograph was attached, so you are working from the collector's description alone. Say so in notes and keep confidence modest.",
  );
  if (options.note?.trim()) {
    evidence.push(
      `The collector's own note, possibly translated from Hindi:\n"""${options.note.trim()}"""`,
    );
  }
  if (typeof options.declaredMassGrams === "number" && options.declaredMassGrams > 0) {
    evidence.push(
      `The collector declares a total mass of ${options.declaredMassGrams} g. If your own estimate differs from that by more than 30%, say so in notes and explain why.`,
    );
  }
  blocks.push(`EVIDENCE:\n${evidence.join("\n\n")}`);

  if (options.intake) {
    blocks.push(
      `Also return \`transcript\` (null when no voice note was attached) and \`fields\` as described.`,
    );
  }

  blocks.push(
    `Answer with the JSON object only: identified item, material fractions with masses, and the gatekeeper verdict. No money, no prose.`,
  );

  return blocks.join("\n\n");
}

/* --------------------------------------------------------------- schemas */

const materialSchema = {
  type: "OBJECT",
  properties: {
    id: { type: "STRING", enum: materialIds },
    name: { type: "STRING" },
    massGrams: { type: "NUMBER" },
  },
  required: ["id", "name", "massGrams"],
} as const;

const gatekeeperSchema = {
  type: "OBJECT",
  properties: {
    verdict: { type: "STRING", enum: ["verified", "rejected", "review"] },
    confidence: { type: "NUMBER" },
    matchedClass: { type: "STRING" },
    reason: { type: "STRING" },
    ruleCode: { type: "STRING", enum: [...REJECT_RULE_CODES] },
    signals: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },
          value: { type: "STRING" },
        },
        required: ["label", "value"],
      },
    },
  },
  required: ["verdict", "confidence", "matchedClass", "reason", "ruleCode", "signals"],
} as const;

/**
 * Gemini's `responseSchema` dialect (an OpenAPI subset). Declaring it here rather
 * than in the provider keeps the contract next to the prompt that explains it.
 */
export function itemResponseSchema(
  options: { intake?: boolean } = {},
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    itemClass: { type: "STRING", enum: itemClassCodes },
    itemLabel: { type: "STRING" },
    brand: { type: "STRING" },
    condition: { type: "STRING", enum: ["working", "dead", "damaged"] },
    unitCount: { type: "INTEGER" },
    stateCode: { type: "STRING" },
    hazards: { type: "ARRAY", items: { type: "STRING" } },
    materials: { type: "ARRAY", items: materialSchema },
    gatekeeper: gatekeeperSchema,
    notes: { type: "STRING" },
  };
  const required = [
    "itemClass",
    "itemLabel",
    "brand",
    "condition",
    "unitCount",
    "stateCode",
    "hazards",
    "materials",
    "gatekeeper",
    "notes",
  ];

  if (options.intake) {
    properties.fields = {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          label: { type: "STRING" },
          value: { type: "STRING" },
          confidence: { type: "NUMBER" },
          source: { type: "STRING", enum: ["photo", "voice"] },
        },
        required: ["label", "value", "confidence", "source"],
      },
    };
    properties.transcript = {
      type: "OBJECT",
      nullable: true,
      properties: {
        language: { type: "STRING" },
        text: { type: "STRING" },
        translation: { type: "STRING" },
        words: { type: "INTEGER" },
      },
      required: ["language", "text", "translation", "words"],
    };
    required.push("fields", "transcript");
  }

  return { type: "OBJECT", properties, required };
}
