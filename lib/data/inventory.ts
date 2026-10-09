import {
  RATE_BASIS,
  RATE_VALID_UNTIL,
  eprCreditFor,
  handlingFeeFor,
  itemMass,
  material,
  priceMaterials,
  type ItemClassCode,
} from "@/lib/data/rate-card";
import type { EwasteItem, MaterialLine, Valuation } from "@/lib/types";

/**
 * Sample inventory with fixed assay results.
 *
 * Values are fixed, but the arithmetic is not: the material lines are built from
 * the rate card in `lib/data/rate-card.ts`, and `priceFor` derives gross value
 * from those lines with the same helper the receipt and the live AI path use, so
 * the on-screen subtotal can never drift from the line items. Item mass is the
 * exact sum of its lines.
 *
 * The credit note ids are authored per record on purpose — this is the sample
 * audit trail a reviewer checks against, not something computed on the fly.
 */

/**
 * Price an item through the class schedule. `creditOverride` exists for the one
 * sample that shows a credit it then withholds under R-03 (working equipment):
 * the screen has to display what the item would have earned.
 */
function priceFor(
  code: ItemClassCode,
  materials: MaterialLine[],
  eprCreditNote: string,
  creditOverride?: number,
): Valuation {
  return priceMaterials(materials, {
    handlingFee: handlingFeeFor(code),
    eprCreditInr: creditOverride ?? eprCreditFor(code, true),
    eprCreditNote,
    rateBasis: RATE_BASIS,
    validUntil: RATE_VALID_UNTIL,
  });
}

const mainboardMaterials: MaterialLine[] = [
  material("cu", "Copper traces", 148),
  material("au", "Gold plating", 0.32),
  material("ag", "Silver contacts", 1.4),
  material("pd", "Palladium traces", 0.09),
  material("pb", "Lead solder", 96),
  material("resin", "Fibre-reinforced resin", 166),
];

const batteryMaterials: MaterialLine[] = [
  material("co", "Cobalt (cathode)", 62),
  material("ni", "Nickel", 24),
  material("steel", "Steel casing", 118),
  material("li", "Lithium (reactive)", 18),
  material("electrolyte", "Electrolyte residue", 34),
  material("plastic", "Separator plastics", 12, "Landfill, permitted"),
];

const crtMaterials: MaterialLine[] = [
  material("cu", "Deflection coils (copper)", 620),
  material("fe", "Steel chassis", 2400),
  material("al", "Aluminium heat sink", 380),
  material("pb-glass", "Leaded funnel glass", 1900),
  material("glass", "Barium/strontium panel glass", 8700, "Licensed glass line"),
  material("plastic", "ABS housing", 200),
];

const psuMaterials: MaterialLine[] = [
  material("cu", "Copper windings", 320),
  material("fe", "Transformer steel", 780),
  material("al", "Aluminium housing", 120),
  material("caps", "Electrolytic capacitors", 30),
  material("plastic", "PCB + plastics", 200, "Board line, licensed"),
];

const phoneMaterials: MaterialLine[] = [
  material("au", "Gold bonding wire", 0.03),
  material("ag", "Silver paste", 0.24),
  material("cu", "Copper traces", 22),
  material("al", "Aluminium frame", 14),
  material("fe", "Steel fasteners", 24),
  material("li", "Lithium cell", 8),
  material("cell", "Battery pack housing", 34),
  material("glass", "Cover glass", 46),
  material("plastic", "Polycarbonate shell", 30),
];

const bottleMaterials: MaterialLine[] = [
  material("pet", "PET resin", 42),
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
    valuation: priceFor("board_it", mainboardMaterials, "EPR-2026-0431-MH"),
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
    valuation: priceFor("battery_li", batteryMaterials, "EPR-2026-0432-MH"),
    gatekeeper: {
      verdict: "verified",
      confidence: 0.93,
      modelVersion: "eco-gate v0.4",
      checkedAt: "09 Oct 2026, 14:26 IST",
      ruleCode: "R-04",
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
    valuation: priceFor("display_crt", crtMaterials, "EPR-2026-0433-MH"),
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
    valuation: priceFor("component_psu", psuMaterials, "EPR-2026-0434-MH"),
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
    valuation: priceFor(
      "handset",
      phoneMaterials,
      "withheld — no material credit",
      310,
    ),
    gatekeeper: {
      verdict: "rejected",
      confidence: 0.86,
      modelVersion: "eco-gate v0.4",
      checkedAt: "09 Oct 2026, 14:40 IST",
      ruleCode: "R-03",
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
    valuation: priceFor("not_ewaste", bottleMaterials, "not issued — item rejected"),
    gatekeeper: {
      verdict: "rejected",
      confidence: 0.99,
      modelVersion: "eco-gate v0.4",
      checkedAt: "09 Oct 2026, 14:44 IST",
      ruleCode: "R-01",
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
