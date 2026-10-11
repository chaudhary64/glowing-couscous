import { desc, eq } from "drizzle-orm";

import { database, databaseConfigured } from "@/db/client";
import { rateCardClasses, rateCardLines, rateCards } from "@/db/schema";
import {
  ITEM_CLASSES,
  RATE_BASIS,
  RATE_CARD,
  RATE_VALID_UNTIL,
  type RateCardLine,
} from "@/lib/data/rate-card";
import type { MaterialCategory, MaterialLine } from "@/lib/types";

/**
 * The rate card, read from the database.
 *
 * `lib/data/rate-card.ts` used to be the only card: `/rates` rendered it and
 * `priceProposal` priced every item from it, so the screen and the pricing path shared
 * one source by sharing one module. That is fine until an admin needs to change a rate,
 * at which point "edit the card" means "ship a commit". This reads the card the pipeline
 * actually stores — `rate_cards`, `rate_card_lines` and `rate_card_classes`, written by
 * `npm run rates:seed` — so a rate is data, and `/rates` shows the same rows the price
 * was computed from.
 *
 * The code card stays as the fallback, deliberately. No `DATABASE_URL` is a supported
 * shape for this app — the valuation path must still price a submitted item on a laptop
 * with no database — so an unconfigured or unseeded card answers with the code constants
 * and says so, and every other read here reports its own state rather than pretending.
 */

/** One item class, as the schedule stores it: the fee and the brand's credit. */
export interface ItemClass {
  label: string;
  cpcb: string;
  handlingFee: number;
  eprCreditInr: number;
}

/** The whole card in force: the material rates and the per-class schedule. */
export interface RateCardSet {
  /** Where the numbers came from — the row, or the fallback in code. */
  source: "database" | "code";
  /** How the card describes its own provenance. */
  basis: string;
  /** The IST stamp after which a quote must be recomputed. */
  validUntil: string;
  /** Material lines keyed by the id the model returns (`cu`, `pb-glass`). */
  materials: Record<string, RateCardLine>;
  /** Item classes keyed by the class code the model returns (`board_it`). */
  classes: Record<string, ItemClass>;
  configured: boolean;
  /** Set when the database was configured and the card could not be read from it. */
  error: string | null;
}

/** The card as it stands in code, for a deployment with no rate card seeded. */
export function codeRateCard(): RateCardSet {
  return {
    source: "code",
    basis: RATE_BASIS,
    validUntil: RATE_VALID_UNTIL,
    materials: { ...RATE_CARD },
    classes: Object.fromEntries(
      Object.entries(ITEM_CLASSES).map(([code, entry]) => [
        code,
        {
          label: entry.label,
          cpcb: entry.cpcb,
          handlingFee: entry.handlingFee,
          eprCreditInr: entry.eprCreditInr,
        },
      ]),
    ),
    configured: false,
    error: null,
  };
}

/** The card for a pricing path that has not read the database. */
export const CODE_RATE_CARD: RateCardSet = codeRateCard();

/**
 * The active card, read from the database, or the code card.
 *
 * Four outcomes, each answered plainly: no database is the code card with
 * `configured: false`; a read failure and an unseeded card are the code card with a
 * sentence in `error`; a seeded card is the rows themselves. The pricing path prices an
 * item identically to before when the database is absent, which is what makes this safe
 * to lean on from a synchronous, must-not-fail computation.
 */
export async function loadRateCard(): Promise<RateCardSet> {
  if (!databaseConfigured()) return codeRateCard();
  const connection = database();
  if (!connection) return codeRateCard();

  try {
    const { db } = connection;
    const [card] = await db
      .select({ id: rateCards.id, basis: rateCards.basis })
      .from(rateCards)
      .where(eq(rateCards.active, true))
      .orderBy(desc(rateCards.effectiveFrom))
      .limit(1);

    if (!card) {
      return {
        ...codeRateCard(),
        configured: true,
        error: "No rate card is seeded in this database, so these are the card shipped in code. Run `npm run rates:seed`.",
      };
    }

    const [lineRows, classRows] = await Promise.all([
      db
        .select()
        .from(rateCardLines)
        .where(eq(rateCardLines.rateCardId, card.id))
        .orderBy(rateCardLines.materialName),
      db
        .select()
        .from(rateCardClasses)
        .where(eq(rateCardClasses.rateCardId, card.id))
        .orderBy(rateCardClasses.displayOrder),
    ]);

    if (lineRows.length === 0 || classRows.length === 0) {
      return {
        ...codeRateCard(),
        configured: true,
        error:
          "The seeded rate card has no material lines or item classes on it, so these are the card shipped in code. Re-run `npm run rates:seed`.",
      };
    }

    const materials: Record<string, RateCardLine> = {};
    for (const row of lineRows) {
      const key = row.code ?? row.materialName;
      materials[key] = {
        name: row.materialName,
        symbol: row.symbol ?? "",
        category: row.category as MaterialCategory,
        // The column is paise; every screen and the pricing arithmetic speak rupees.
        ratePerKg: row.ratePaisePerKg / 100,
        handling: row.notes ?? "",
      };
    }

    const classes: Record<string, ItemClass> = {};
    for (const row of classRows) {
      classes[row.code] = {
        label: row.label,
        cpcb: row.cpcb ?? "",
        handlingFee: row.handlingFeePaise / 100,
        eprCreditInr: row.eprCreditPaise / 100,
      };
    }

    return {
      source: "database",
      basis: card.basis ?? RATE_BASIS,
      validUntil: RATE_VALID_UNTIL,
      materials,
      classes,
      configured: true,
      error: null,
    };
  } catch (error) {
    const cause =
      error instanceof Error && error.cause instanceof Error ? error.cause.message : null;
    const message = (cause ?? (error instanceof Error ? error.message : String(error)))
      .replace(/\s+/g, " ")
      .trim();
    console.error("[db] reading the rate card failed", message);
    return { ...codeRateCard(), configured: true, error: message.slice(0, 200) };
  }
}

/**
 * Build a priced material line from a card.
 *
 * The card is the source of the rate; the item still supplies its own description,
 * because the collector reads that column ("Copper windings" vs "Deflection coils"). A
 * line the card does not carry falls back to the class's code card entry rather than
 * pricing at zero — a rate of 0 means "no scrap value", and quietly turning a missing
 * rate into that would understate a payout instead of reporting a broken card.
 */
export function materialFrom(
  card: RateCardSet,
  id: string,
  name: string,
  massGrams: number,
  handling?: string,
): MaterialLine {
  const line: RateCardLine | undefined =
    card.materials[id] ?? (id in RATE_CARD ? RATE_CARD[id as keyof typeof RATE_CARD] : undefined);

  if (!line) {
    return {
      id,
      name,
      symbol: "",
      category: "inert",
      massGrams,
      ratePerKg: 0,
      handling: handling ?? "Unrated material — no line on the card",
    };
  }

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
