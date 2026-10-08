import { lineValue } from "@/lib/format";
import type { EwasteItem, MaterialLine, Valuation } from "@/lib/types";

/**
 * Sample inventory with fixed assay results.
 *
 * Values are hardcoded, but the arithmetic is not: `price()` derives the gross
 * value from the material lines with the same helper the receipt uses, so the
 * on-screen subtotal can never drift from the line items. Item mass is the exact
 * sum of its lines.
 */

type ValuationSeed = Pick<
  Valuation,
  "handlingFee" | "eprCreditInr" | "eprCreditNote" | "rateBasis" | "validUntil"
>;

function price(materials: MaterialLine[], seed: ValuationSeed): Valuation {
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

function itemMass(materials: MaterialLine[]): number {
  return Number(
    materials.reduce((sum, line) => sum + line.massGrams, 0).toFixed(2),
  );
}

const rateBasis = "EcoEPR rate card · IMD benchmark, 2026-Q3 · Mumbai zone";
const validUntil = "09 Nov 2026, 23:59 IST";

const mainboardMaterials: MaterialLine[] = [
  { id: "cu", name: "Copper traces", symbol: "Cu", category: "base", massGrams: 148, ratePerKg: 540, handling: "Smelter recovered" },
  { id: "au", name: "Gold plating", symbol: "Au", category: "precious", massGrams: 0.32, ratePerKg: 5842000, handling: "Refinery assay" },
  { id: "ag", name: "Silver contacts", symbol: "Ag", category: "precious", massGrams: 1.4, ratePerKg: 92000, handling: "Refinery assay" },
  { id: "pd", name: "Palladium traces", symbol: "Pd", category: "precious", massGrams: 0.09, ratePerKg: 2750000, handling: "Refinery assay" },
  { id: "pb", name: "Lead solder", symbol: "Pb", category: "hazardous", massGrams: 96, ratePerKg: 0, handling: "No value · disposal cost" },
  { id: "resin", name: "Fibre-reinforced resin", symbol: "—", category: "inert", massGrams: 166, ratePerKg: 0, handling: "Landfill, permitted" },
];

const batteryMaterials: MaterialLine[] = [
  { id: "co", name: "Cobalt (cathode)", symbol: "Co", category: "base", massGrams: 62, ratePerKg: 2850, handling: "Hydromet recovery" },
  { id: "ni", name: "Nickel", symbol: "Ni", category: "base", massGrams: 24, ratePerKg: 1620, handling: "Hydromet recovery" },
  { id: "steel", name: "Steel casing", symbol: "Fe", category: "base", massGrams: 118, ratePerKg: 48, handling: "Scrap steel" },
  { id: "li", name: "Lithium (reactive)", symbol: "Li", category: "hazardous", massGrams: 18, ratePerKg: 0, handling: "Discharge before transport" },
  { id: "electrolyte", name: "Electrolyte residue", symbol: "—", category: "hazardous", massGrams: 34, ratePerKg: 0, handling: "Sealed containment" },
  { id: "plastic", name: "Separator plastics", symbol: "—", category: "inert", massGrams: 12, ratePerKg: 0, handling: "Landfill, permitted" },
];

const crtMaterials: MaterialLine[] = [
  { id: "cu", name: "Deflection coils (copper)", symbol: "Cu", category: "base", massGrams: 620, ratePerKg: 540, handling: "Smelter recovered" },
  { id: "fe", name: "Steel chassis", symbol: "Fe", category: "base", massGrams: 2400, ratePerKg: 42, handling: "Scrap steel" },
  { id: "al", name: "Aluminium heat sink", symbol: "Al", category: "base", massGrams: 380, ratePerKg: 165, handling: "Scrap aluminium" },
  { id: "pb-glass", name: "Leaded funnel glass", symbol: "Pb", category: "hazardous", massGrams: 1900, ratePerKg: 0, handling: "Glass-to-glass, licensed" },
  { id: "glass", name: "Barium/strontium panel glass", symbol: "—", category: "inert", massGrams: 8700, ratePerKg: 0, handling: "Licensed glass line" },
  { id: "plastic", name: "ABS housing", symbol: "—", category: "inert", massGrams: 200, ratePerKg: 0, handling: "Plastics recycle" },
];

const psuMaterials: MaterialLine[] = [
  { id: "cu", name: "Copper windings", symbol: "Cu", category: "base", massGrams: 320, ratePerKg: 540, handling: "Smelter recovered" },
  { id: "fe", name: "Transformer steel", symbol: "Fe", category: "base", massGrams: 780, ratePerKg: 42, handling: "Scrap steel" },
  { id: "al", name: "Aluminium housing", symbol: "Al", category: "base", massGrams: 120, ratePerKg: 165, handling: "Scrap aluminium" },
  { id: "caps", name: "Electrolytic capacitors", symbol: "—", category: "hazardous", massGrams: 30, ratePerKg: 0, handling: "Puncture-free containment" },
  { id: "plastic", name: "PCB + plastics", symbol: "—", category: "inert", massGrams: 200, ratePerKg: 0, handling: "Board line, licensed" },
];

const phoneMaterials: MaterialLine[] = [
  { id: "au", name: "Gold bonding wire", symbol: "Au", category: "precious", massGrams: 0.03, ratePerKg: 5842000, handling: "Refinery assay" },
  { id: "ag", name: "Silver paste", symbol: "Ag", category: "precious", massGrams: 0.24, ratePerKg: 92000, handling: "Refinery assay" },
  { id: "cu", name: "Copper traces", symbol: "Cu", category: "base", massGrams: 22, ratePerKg: 540, handling: "Smelter recovered" },
  { id: "al", name: "Aluminium frame", symbol: "Al", category: "base", massGrams: 14, ratePerKg: 165, handling: "Scrap aluminium" },
  { id: "fe", name: "Steel fasteners", symbol: "Fe", category: "base", massGrams: 24, ratePerKg: 42, handling: "Scrap steel" },
  { id: "li", name: "Lithium cell", symbol: "Li", category: "hazardous", massGrams: 8, ratePerKg: 0, handling: "Discharge before transport" },
  { id: "cell", name: "Battery pack housing", symbol: "—", category: "hazardous", massGrams: 34, ratePerKg: 0, handling: "Swell check required" },
  { id: "glass", name: "Cover glass", symbol: "—", category: "inert", massGrams: 46, ratePerKg: 0, handling: "Permitted glass" },
  { id: "plastic", name: "Polycarbonate shell", symbol: "—", category: "inert", massGrams: 30, ratePerKg: 0, handling: "Plastics recycle" },
];

const bottleMaterials: MaterialLine[] = [
  { id: "pet", name: "PET resin", symbol: "—", category: "inert", massGrams: 42, ratePerKg: 0, handling: "Not an e-waste stream" },
];

export const items: EwasteItem[] = [
  {
    id: "ECO-2026-0431",
    label: "Dell laptop mainboard",
    category: "Laptop mainboard",
    brand: "Dell",
    condition: "dead",
    massGrams: itemMass(mainboardMaterials),
    city: "Mumbai",
    hazards: ["Lead solder above 0.1% w/w", "Beryllium in some connector alloys"],
    materials: mainboardMaterials,
    valuation: price(mainboardMaterials, {
      handlingFee: 240,
      eprCreditInr: 2450,
      eprCreditNote: "EPR-2026-0431-MH",
      rateBasis,
      validUntil,
    }),
    gatekeeper: {
      verdict: "verified",
      confidence: 0.97,
      modelVersion: "eco-gate v0.4",
      checkedAt: "09 Oct 2026, 14:22 IST",
      matchedClass: "E-waste · Class E2 IT & telecom",
      reason:
        "Board traces, solder pattern and component layout match a printed circuit board assembly. Declared dead matches the powered-off signature.",
      signals: [
        { label: "Image class", value: "PCB assembly · 0.97" },
        { label: "Brand plate read", value: "Dell · 0.94" },
        { label: "Hazard markers", value: "Lead solder present" },
        { label: "Power signature", value: "No boot LED" },
      ],
    },
  },
  {
    id: "ECO-2026-0432",
    label: "Samsung Galaxy battery pack",
    category: "Lithium-ion battery pack",
    brand: "Samsung",
    condition: "damaged",
    massGrams: itemMass(batteryMaterials),
    city: "Mumbai",
    hazards: ["Swelling detected — thermal runaway risk", "Lithium metal reactive in air"],
    materials: batteryMaterials,
    valuation: price(batteryMaterials, {
      handlingFee: 180,
      eprCreditInr: 3200,
      eprCreditNote: "EPR-2026-0432-MH",
      rateBasis,
      validUntil,
    }),
    gatekeeper: {
      verdict: "verified",
      confidence: 0.93,
      modelVersion: "eco-gate v0.4",
      checkedAt: "09 Oct 2026, 14:26 IST",
      matchedClass: "E-waste · Class E5 batteries",
      reason:
        "Cell stack and pouch geometry match a lithium-ion pack. Swelling flags it as hazardous, which forces a licensed battery route.",
      signals: [
        { label: "Image class", value: "Li-ion pack · 0.93" },
        { label: "Swelling model", value: "Deformed · 0.88" },
        { label: "Hazard markers", value: "Reactive cell, sealed" },
        { label: "Route override", value: "Battery-only recycler" },
      ],
    },
  },
  {
    id: "ECO-2026-0433",
    label: 'LG 21" CRT monitor',
    category: "CRT display",
    brand: "LG",
    condition: "dead",
    massGrams: itemMass(crtMaterials),
    city: "Pune",
    hazards: ["Leaded funnel glass, 1.9 kg", "Intact vacuum tube"],
    materials: crtMaterials,
    valuation: price(crtMaterials, {
      handlingFee: 320,
      eprCreditInr: 1850,
      eprCreditNote: "EPR-2026-0433-MH",
      rateBasis,
      validUntil,
    }),
    gatekeeper: {
      verdict: "review",
      confidence: 0.68,
      modelVersion: "eco-gate v0.4",
      checkedAt: "09 Oct 2026, 14:31 IST",
      matchedClass: "E-waste · Class E1 large equipment",
      reason:
        "Confirmed display equipment with leaded glass, but the weight class exceeds the doorstep pickup threshold. Held for a two-man van and a licensed glass line.",
      signals: [
        { label: "Image class", value: "Display equipment · 0.71" },
        { label: "Weight class", value: "Heavy · exceeds doorstep" },
        { label: "Hazard markers", value: "Leaded glass confirmed" },
        { label: "Fallback", value: "Manual reviewer queue" },
      ],
    },
  },
  {
    id: "ECO-2026-0434",
    label: "HP printer power supply",
    category: "Switch-mode power supply",
    brand: "HP",
    condition: "working",
    massGrams: itemMass(psuMaterials),
    city: "Pune",
    hazards: ["Charged capacitors — discharge before dismantling"],
    materials: psuMaterials,
    valuation: price(psuMaterials, {
      handlingFee: 120,
      eprCreditInr: 940,
      eprCreditNote: "EPR-2026-0434-MH",
      rateBasis,
      validUntil,
    }),
    gatekeeper: {
      verdict: "verified",
      confidence: 0.91,
      modelVersion: "eco-gate v0.4",
      checkedAt: "09 Oct 2026, 14:35 IST",
      matchedClass: "E-waste · Class E2 IT & telecom",
      reason:
        "Transformer windings and capacitor bank match a switch-mode supply. Copper yield is consistent with the declared 1.45 kg.",
      signals: [
        { label: "Image class", value: "Power supply · 0.91" },
        { label: "Copper estimate", value: "320 g ±12%" },
        { label: "Hazard markers", value: "Charged capacitors" },
        { label: "Route", value: "Standard board line" },
      ],
    },
  },
  {
    id: "ECO-2026-0435",
    label: "Redmi Note 12 (powers on)",
    category: "Smartphone",
    brand: "Xiaomi",
    condition: "working",
    massGrams: itemMass(phoneMaterials),
    city: "Thane",
    hazards: ["Do not shred a functioning handset"],
    materials: phoneMaterials,
    valuation: price(phoneMaterials, {
      handlingFee: 60,
      eprCreditInr: 310,
      eprCreditNote: "withheld — no material credit",
      rateBasis,
      validUntil,
    }),
    gatekeeper: {
      verdict: "rejected",
      confidence: 0.86,
      modelVersion: "eco-gate v0.4",
      checkedAt: "09 Oct 2026, 14:40 IST",
      matchedClass: "Refurbishment candidate",
      reason:
        "Device powers on and clears the refurbishment screen. Working units must enter reuse, not the shredding stream, so no material credit is issued.",
      signals: [
        { label: "Image class", value: "Handset · 0.96" },
        { label: "Boot signature", value: "Screen on" },
        { label: "Route override", value: "Reuse partner" },
        { label: "Credit", value: "Withheld by rule R-03" },
      ],
    },
  },
  {
    id: "ECO-2026-0436",
    label: "Plastic bottle (uploaded as e-waste)",
    category: "Not e-waste",
    brand: "Unread",
    condition: "dead",
    massGrams: itemMass(bottleMaterials),
    city: "Mumbai",
    hazards: [],
    materials: bottleMaterials,
    valuation: price(bottleMaterials, {
      handlingFee: 0,
      eprCreditInr: 0,
      eprCreditNote: "not issued — item rejected",
      rateBasis,
      validUntil,
    }),
    gatekeeper: {
      verdict: "rejected",
      confidence: 0.99,
      modelVersion: "eco-gate v0.4",
      checkedAt: "09 Oct 2026, 14:44 IST",
      matchedClass: "Not e-waste",
      reason:
        "No circuit, metal, cell or connector signature. This is the fraud case the gatekeeper exists to stop: it would otherwise earn a credit note.",
      signals: [
        { label: "Image class", value: "PET container · 0.99" },
        { label: "Metal signature", value: "None detected" },
        { label: "Circuit signature", value: "None detected" },
        { label: "Credit", value: "Blocked" },
      ],
    },
  },
];

export function getItem(id: string): EwasteItem {
  const found = items.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`Unknown item ${id}`);
  }
  return found;
}

/** The item the valuation, gatekeeper and pickup screens are centred on. */
export const focusItemId = "ECO-2026-0431";
