import { lineValue } from "@/lib/format";
import type { MaterialCategory, MaterialLine, Valuation } from "@/lib/types";

/**
 * The EcoEPR rate card, in one place.
 *
 * Two things price an item: the material lines the assay produces, and the
 * per-class schedules at the bottom. Neither is allowed to be a model's opinion.
 * The identification model returns *which* material it sees and *how much* of it
 * (a number a reviewer can argue with); everything with a rupee sign on it is
 * computed here, by the same arithmetic the fixtures and the receipt use. That is
 * why `priceMaterials` lives in this file rather than in the AI layer: if the
 * model could type a figure, the whole valuation story would be theatre.
 *
 * Rate provenance is honest about itself: the benchmarks are labelled in-app as
 * a demo rate card. Replace `RATE_CARD` with a licensed feed and nothing else
 * has to move.
 */

export interface RateCardLine {
  /** Canonical trade name. An item may override it with its own description. */
  name: string;
  /** Chemical symbol shown as the short mono marker. `—` for non-metals. */
  symbol: string;
  category: MaterialCategory;
  /** INR per kilogram. Zero means no material value: the line must still be
   *  declared, because a hazardous or inert fraction still has handling cost. */
  ratePerKg: number;
  handling: string;
}

/**
 * Material ids are the shared vocabulary between the fixtures, the prompt and the
 * pricing code. `steel` is coated/prepared casing stock and pays more than `fe`,
 * unprepared light iron — a real distinction on any Indian rate card.
 */
export const RATE_CARD = {
  cu: { name: "Copper", symbol: "Cu", category: "base", ratePerKg: 540, handling: "Smelter recovered" },
  al: { name: "Aluminium", symbol: "Al", category: "base", ratePerKg: 165, handling: "Scrap aluminium" },
  fe: { name: "Light iron", symbol: "Fe", category: "base", ratePerKg: 42, handling: "Scrap steel" },
  steel: { name: "Steel casing", symbol: "Fe", category: "base", ratePerKg: 48, handling: "Scrap steel" },
  brass: { name: "Brass fittings", symbol: "Cu-Zn", category: "base", ratePerKg: 380, handling: "Scrap brass" },
  zn: { name: "Zinc die-cast", symbol: "Zn", category: "base", ratePerKg: 240, handling: "Scrap zinc" },
  sn: { name: "Tin solder", symbol: "Sn", category: "base", ratePerKg: 1900, handling: "Smelter recovered" },
  ni: { name: "Nickel", symbol: "Ni", category: "base", ratePerKg: 1620, handling: "Hydromet recovery" },
  co: { name: "Cobalt", symbol: "Co", category: "base", ratePerKg: 2850, handling: "Hydromet recovery" },
  ta: { name: "Tantalum capacitors", symbol: "Ta", category: "base", ratePerKg: 18000, handling: "Capacitor recovery" },
  nd: { name: "Neodymium magnet", symbol: "Nd", category: "base", ratePerKg: 2800, handling: "Rare-earth recovery" },
  au: { name: "Gold", symbol: "Au", category: "precious", ratePerKg: 5842000, handling: "Refinery assay" },
  ag: { name: "Silver", symbol: "Ag", category: "precious", ratePerKg: 92000, handling: "Refinery assay" },
  pd: { name: "Palladium", symbol: "Pd", category: "precious", ratePerKg: 2750000, handling: "Refinery assay" },
  pb: { name: "Lead solder", symbol: "Pb", category: "hazardous", ratePerKg: 0, handling: "No value · disposal cost" },
  "pb-glass": { name: "Leaded funnel glass", symbol: "Pb", category: "hazardous", ratePerKg: 0, handling: "Glass-to-glass, licensed" },
  li: { name: "Lithium", symbol: "Li", category: "hazardous", ratePerKg: 0, handling: "Discharge before transport" },
  electrolyte: { name: "Electrolyte residue", symbol: "—", category: "hazardous", ratePerKg: 0, handling: "Sealed containment" },
  caps: { name: "Electrolytic capacitors", symbol: "—", category: "hazardous", ratePerKg: 0, handling: "Puncture-free containment" },
  cell: { name: "Battery pack housing", symbol: "—", category: "hazardous", ratePerKg: 0, handling: "Swell check required" },
  toner: { name: "Toner / ink residue", symbol: "—", category: "hazardous", ratePerKg: 0, handling: "Sealed containment" },
  resin: { name: "Fibre-reinforced resin", symbol: "—", category: "inert", ratePerKg: 0, handling: "Landfill, permitted" },
  plastic: { name: "Mixed plastics", symbol: "—", category: "inert", ratePerKg: 0, handling: "Plastics recycle" },
  glass: { name: "Display glass", symbol: "—", category: "inert", ratePerKg: 0, handling: "Permitted glass" },
  pet: { name: "PET resin", symbol: "—", category: "inert", ratePerKg: 0, handling: "Not an e-waste stream" },
} as const satisfies Record<string, RateCardLine>;

export type MaterialId = keyof typeof RATE_CARD;

export const materialIds = Object.keys(RATE_CARD) as MaterialId[];

export function isMaterialId(value: unknown): value is MaterialId {
  return typeof value === "string" && value in RATE_CARD;
}

/**
 * Build a priced material line from the card. `name` stays item-specific
 * ("Copper windings" vs "Deflection coils") because the collector reads that
 * column; `handling` is only overridden where the route genuinely differs from
 * the card default (loose plastic in a power supply is a board line, not a
 * plastics bin).
 */
export function material(
  id: MaterialId,
  name: string,
  massGrams: number,
  handling?: string,
): MaterialLine {
  const line: RateCardLine = RATE_CARD[id];
  return {
    id,
    name,
    symbol: line.symbol,
    category: line.category,
    massGrams,
    ratePerKg: line.ratePerKg,
    handling: handling ?? line.handling,
  };
}

export const RATE_BASIS = "EcoEPR rate card · IMD benchmark, 2026-Q3 · Mumbai zone";
export const RATE_VALID_UNTIL = "09 Nov 2026, 23:59 IST";

export type ValuationSeed = Pick<
  Valuation,
  "handlingFee" | "eprCreditInr" | "eprCreditNote" | "rateBasis" | "validUntil"
>;

/** Gross value is the sum of the lines, never a parallel figure. */
export function priceMaterials(
  materials: MaterialLine[],
  seed: ValuationSeed,
): Valuation {
  const grossValue = materials.reduce(
    (sum, line) => sum + lineValue(line.massGrams, line.ratePerKg),
    0,
  );

  return {
    grossValue,
    handlingFee: seed.handlingFee,
    netToCollector: grossValue - seed.handlingFee,
    eprCreditInr: seed.eprCreditInr,
    eprCreditNote: seed.eprCreditNote,
    rateBasis: seed.rateBasis,
    validUntil: seed.validUntil,
  };
}

/** Item mass is the exact sum of its lines, to two decimals. */
export function itemMass(materials: MaterialLine[]): number {
  return Number(
    materials.reduce((sum, line) => sum + line.massGrams, 0).toFixed(2),
  );
}

/** True when any line is hazardous — decides the route and the surcharge. */
export function isHazardous(materials: MaterialLine[]): boolean {
  return materials.some((line) => line.category === "hazardous");
}

/* ------------------------------------------------------------------ classes */

/**
 * Item classes are the hinge between a model that sees and a schedule that
 * prices. The model picks one of these codes; it never picks a rupee figure.
 * `E-waste · Class E1/E2/E5` in the gatekeeper screen is the CPCB category this
 * maps onto.
 */
export const ITEM_CLASSES = {
  board_it: {
    label: "IT & telecom board assembly",
    cpcb: "E-waste · Class E2 IT & telecom",
    handlingFee: 240,
    eprCreditInr: 2450,
  },
  battery_li: {
    label: "Lithium-ion battery pack",
    cpcb: "E-waste · Class E5 batteries",
    handlingFee: 180,
    eprCreditInr: 3200,
  },
  display_crt: {
    label: "CRT / large display",
    cpcb: "E-waste · Class E1 large equipment",
    handlingFee: 320,
    eprCreditInr: 1850,
  },
  it_large: {
    label: "Large IT equipment",
    cpcb: "E-waste · Class E2 IT & telecom",
    handlingFee: 180,
    eprCreditInr: 1500,
  },
  appliance_large: {
    label: "Large appliance",
    cpcb: "E-waste · Class E1 large equipment",
    handlingFee: 320,
    eprCreditInr: 1200,
  },
  pcb_scrap: {
    label: "Loose board scrap",
    cpcb: "E-waste · Class E2 IT & telecom",
    handlingFee: 120,
    eprCreditInr: 1300,
  },
  component_psu: {
    label: "Power supply / component",
    cpcb: "E-waste · Class E2 IT & telecom",
    handlingFee: 120,
    eprCreditInr: 940,
  },
  small_ewaste: {
    label: "Small e-waste",
    cpcb: "E-waste · Class E3 small equipment",
    handlingFee: 60,
    eprCreditInr: 220,
  },
  handset: {
    label: "Handset",
    cpcb: "E-waste · Class E3 small equipment",
    handlingFee: 60,
    eprCreditInr: 310,
  },
  cable_scrap: {
    label: "Cable / wire scrap",
    cpcb: "E-waste · Class E2 IT & telecom",
    handlingFee: 60,
    eprCreditInr: 400,
  },
  not_ewaste: {
    label: "Not e-waste",
    cpcb: "Outside the EPR schedule",
    handlingFee: 0,
    eprCreditInr: 0,
  },
} as const;

export type ItemClassCode = keyof typeof ITEM_CLASSES;

export const itemClassCodes = Object.keys(ITEM_CLASSES) as ItemClassCode[];

export function isItemClassCode(value: unknown): value is ItemClassCode {
  return typeof value === "string" && value in ITEM_CLASSES;
}

/**
 * Doorstep handling tariff by class. A phone is one hand and one signature; a
 * CRT is a two-man van and a licensed glass line, so the fee is per class, not a
 * function of weight the collector cannot measure.
 */
export function handlingFeeFor(code: ItemClassCode): number {
  return ITEM_CLASSES[code].handlingFee;
}

/**
 * Brand liability offset per class. An EPR credit is a compliance artefact — a
 * transfer of the producer's take-back obligation — so it comes off a published
 * schedule, and it is only issued once the gatekeeper has verified something.
 */
export function eprCreditFor(code: ItemClassCode, verified: boolean): number {
  return verified ? ITEM_CLASSES[code].eprCreditInr : 0;
}

/**
 * Credit note id, e.g. EPR-2026-0431-MH. Derived from the item class and the
 * submission so the same input yields the same note, which is what makes it
 * checkable against the audit trail later.
 */
/** FNV-1a serial, so the same submission always produces the same number. */
export function stableSerial(seed: string): string {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return String((hash >>> 0) % 10000).padStart(4, "0");
}

export function eprNoteId(
  code: ItemClassCode,
  stateCode: string,
  seed: string,
  year = 2026,
): string {
  return `EPR-${year}-${stableSerial(`${code}:${seed}`)}-${stateCode}`;
}
