/**
 * Rate card tests — run with `npm run test:rates`.
 *
 * Node's built-in runner, no framework, and no database: `cardFromRows` is the whole of
 * the merge between the card seeded from code and the day's market card, so the rows it
 * reads can be written out here and the card it returns checked field by field.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RATE_CARD } from "@/lib/data/rate-card";

import { cardFromRows, type CardRow, type ClassRow, type LineRow } from "./card";
import { marketFromNote } from "./daily";

const SEEDED: CardRow = { id: "seed-1", code: "ecoepr-2026-q3", basis: "EcoEPR rate card · IMD benchmark, 2026-Q3 · Mumbai zone" };
const DAILY: CardRow = { id: "daily-1", code: "DAILY-2026-10-12", basis: "MetalpriceAPI market prices for 12 Oct 2026 · ₹/kg" };

/** A line on the seeded card: it carries the pricing id in `code`, and its handling text. */
function seededLine(material: "cu" | "au", ratePerKg: number, notes = "Scrap copper"): LineRow {
  const line = RATE_CARD[material];
  return {
    rateCardId: SEEDED.id,
    code: material,
    materialName: line.name,
    symbol: line.symbol,
    category: line.category,
    ratePaisePerKg: Math.round(ratePerKg * 100),
    notes,
  };
}

/**
 * A line as `storeDaily` writes it: no `code`, because the daily card is keyed by the
 * material's name, and the market price it was derived from in `notes`.
 */
function dailyLine(material: "cu" | "ni", ratePerKg: number, marketPerKg: number, extra = ""): LineRow {
  const line = RATE_CARD[material];
  return {
    rateCardId: DAILY.id,
    code: null,
    materialName: line.name,
    symbol: line.symbol,
    category: line.category,
    ratePaisePerKg: ratePerKg * 100,
    notes: `Market ₹${marketPerKg.toFixed(2)}/kg · pays ${((ratePerKg / marketPerKg) * 100).toFixed(1)}% of it · ${extra || "MetalpriceAPI"}`,
  };
}

function classRow(card: CardRow, code: "board_it", handlingFee: number, eprCreditInr: number): ClassRow {
  return {
    rateCardId: card.id,
    code,
    label: "IT & telecom board assembly",
    cpcb: "E-waste · Class E2 IT & telecom",
    handlingFeePaise: Math.round(handlingFee * 100),
    eprCreditPaise: Math.round(eprCreditInr * 100),
  };
}

describe("cardFromRows", () => {
  it("reads the rates and the schedule off the seeded card", () => {
    const card = cardFromRows({
      cards: [SEEDED],
      lines: [seededLine("cu", 540)],
      classes: [classRow(SEEDED, "board_it", 240, 2450)],
      note: null,
    });

    assert.equal(card?.source, "database");
    assert.equal(card?.cardId, SEEDED.id);
    assert.equal(card?.day, null);
    assert.equal(card?.basis, SEEDED.basis);
    assert.equal(card?.validUntil, "09 Nov 2026, 23:59 IST");
    assert.equal(card?.materials.cu.ratePerKg, 540);
    assert.equal(card?.materials.cu.handling, "Scrap copper");
    assert.equal(card?.classes.board_it.handlingFee, 240);
    assert.equal(card?.classes.board_it.eprCreditInr, 2450);
    assert.deepEqual(card?.market, {});
    assert.equal(card?.error, null);
  });

  it("keeps every material in the card in code, so a partial card still prices", () => {
    const card = cardFromRows({
      cards: [SEEDED],
      lines: [seededLine("cu", 999)],
      classes: [classRow(SEEDED, "board_it", 240, 2450)],
      note: null,
    });

    // The one line the card carries wins; the materials it does not carry keep the rate
    // they had in code rather than dropping to zero.
    assert.equal(card?.materials.cu.ratePerKg, 999);
    assert.equal(card?.materials.au.ratePerKg, RATE_CARD.au.ratePerKg);
    assert.equal(card?.materials["pb-glass"].ratePerKg, 0);
    assert.equal(Object.keys(card?.materials ?? {}).length, Object.keys(RATE_CARD).length);
  });

  it("prices from the day's card and takes the schedule from the seeded one", () => {
    const card = cardFromRows({
      cards: [DAILY, SEEDED],
      lines: [dailyLine("cu", 512, 950), dailyLine("ni", 1620, 1514, "fixed: LME cash, 09 Oct 2026")],
      classes: [classRow(SEEDED, "board_it", 240, 2450)],
      note: null,
    });

    assert.equal(card?.source, "daily");
    assert.equal(card?.cardId, DAILY.id);
    assert.equal(card?.day, "2026-10-12");
    assert.equal(card?.basis, DAILY.basis);
    assert.match(card?.validUntil ?? "", /23:59 IST$/);
    // The day's rate is the card's, keyed by material id even though the row has no code.
    assert.equal(card?.materials.cu.ratePerKg, 512);
    assert.equal(card?.materials.au.ratePerKg, RATE_CARD.au.ratePerKg);
    // And the handling instruction is still the card in code's, because the day's card
    // wrote the market price it came from into that column.
    assert.equal(card?.materials.cu.handling, RATE_CARD.cu.handling);
    // The class schedule is the seeded card's, since a day's card has none.
    assert.equal(card?.classes.board_it.handlingFee, 240);
    assert.equal(card?.error, null);
  });

  it("says what the day's card priced each material from", () => {
    const card = cardFromRows({
      cards: [DAILY, SEEDED],
      lines: [dailyLine("cu", 512, 950), dailyLine("ni", 1620, 1514, "fixed: LME cash, 09 Oct 2026")],
      classes: [],
      note: "METALPRICE_API_KEY is not set, so today's market prices were not fetched.",
    });

    assert.ok(Math.abs((card?.market.cu.marketPerKg ?? 0) - 950) < 0.01);
    assert.ok(Math.abs((card?.market.cu.share ?? 0) - 512 / 950) < 0.0001);
    assert.equal(card?.market.cu.fixedSource, null);
    assert.equal(card?.market.ni.fixedSource, "LME cash, 09 Oct 2026");
    assert.equal(card?.market.au, undefined);
    assert.equal(card?.note, "METALPRICE_API_KEY is not set, so today's market prices were not fetched.");
  });

  it("falls back to the classes in code when no stored card carries a schedule", () => {
    const card = cardFromRows({
      cards: [DAILY],
      lines: [dailyLine("cu", 512, 950)],
      classes: [],
      note: null,
    });

    assert.equal(card?.classes.board_it.handlingFee, 240);
    assert.equal(card?.classes.board_it.eprCreditInr, 2450);
    assert.match(card?.error ?? "", /no class schedule/);
  });

  it("is null when no card carries a rate", () => {
    assert.equal(cardFromRows({ cards: [SEEDED, DAILY], lines: [], classes: [], note: null }), null);
    assert.equal(cardFromRows({ cards: [], lines: [seededLine("cu", 540)], classes: [], note: null }), null);
  });
});

describe("marketFromNote", () => {
  const note = (text: string) => marketFromNote(512, text);

  it("reads the market price and the share it pays", () => {
    const read = note("Market ₹950.00/kg · pays 53.9% of it · MetalpriceAPI");
    assert.equal(read.marketPerKg, 950);
    assert.ok(Math.abs((read.share ?? 0) - 512 / 950) < 0.0001);
    assert.equal(read.fixedSource, null);
    assert.equal(read.needsPaidPlan, false);
  });

  it("reads a fixed market price and where it came from", () => {
    const read = note("Market ₹1514.30/kg · pays 106.9% of it · fixed: LME cash, 09 Oct 2026");
    assert.equal(read.fixedSource, "LME cash, 09 Oct 2026");
  });

  it("marks a material the plan would not price, and a manual one as neither", () => {
    const paid = note("Needs a paid MetalpriceAPI plan, so the demo card's rate");
    assert.equal(paid.needsPaidPlan, true);
    assert.equal(paid.marketPerKg, null);
    assert.equal(paid.share, null);

    const manual = note("Manual rate: the feed has no market price for this material");
    assert.equal(manual.needsPaidPlan, false);
    assert.equal(manual.marketPerKg, null);
    assert.equal(manual.fixedSource, null);
  });
});
