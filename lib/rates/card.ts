import { desc, eq, inArray } from "drizzle-orm";

import { database, databaseConfigured } from "@/db/client";
import { rateCardClasses, rateCardLines, rateCards } from "@/db/schema";
import {
  ITEM_CLASSES,
  RATE_BASIS,
  RATE_CARD,
  RATE_VALID_UNTIL,
  materialIds,
  type MaterialId,
  type RateCardLine,
} from "@/lib/data/rate-card";
import type { MaterialCategory, MaterialLine } from "@/lib/types";

import { currentRates, marketFromNote, type MarketNote } from "./daily";
import { displayDay, istDate } from "./feed";

/**
 * The rate card in force, read from the database.
 *
 * `lib/data/rate-card.ts` used to be the only card: `/rates` rendered it and
 * `priceProposal` priced every item from it, so the screen and the pricing path shared
 * one source by sharing one module. That is fine until an admin needs to change a rate,
 * at which point "edit the card" means "ship a commit". This reads the card the pipeline
 * actually stores — `rate_cards`, `rate_card_lines` and `rate_card_classes` — so a rate
 * is data, and `/rates` shows the same rows the price was computed from.
 *
 * Two writers put rows there, and they answer different questions. `npm run rates:seed`
 * converges the card in code into the tables once, classes and all. `lib/rates/daily.ts`
 * writes one dated card a day from the market feed, with a line per material and the
 * market price it derived the rate from in the line's `notes` — which is why a day's card
 * carries no class schedule: the feed has no opinion about handling fees or EPR credits.
 * So the card in force is read in two parts. The rates are the newest active card's,
 * which is the day's card when one exists and the seeded card otherwise, and the class
 * schedule is the newest active card that carries one. Both fall back to the card in
 * code — that is what keeps a laptop with no database pricing submissions — and the
 * screen says which card it is showing, and why.
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
  /**
   * Where the numbers came from — the day's market card, another stored card, or the
   * fallback in code.
   */
  source: "daily" | "database" | "code";
  /** The stored card the rates came from (`rate_cards.id`), for `valuations.rate_card_id`. */
  cardId: string | null;
  /** The day a daily card is for (YYYY-MM-DD); null for a card that is not daily. */
  day: string | null;
  /** How the card describes its own provenance. */
  basis: string;
  /** The IST stamp after which a quote must be recomputed. */
  validUntil: string;
  /** Material lines keyed by the id the model returns (`cu`, `pb-glass`). */
  materials: Record<string, RateCardLine>;
  /**
   * What a day's card says each line's rate follows, keyed like `materials`. Empty for a
   * card that was not priced from the feed.
   */
  market: Record<string, MarketNote>;
  /** Item classes keyed by the class code the model returns (`board_it`). */
  classes: Record<string, ItemClass>;
  configured: boolean;
  /** Why today's daily card is not the one in force; null when it is (or there is none). */
  note: string | null;
  /** Set when the database was configured and part of the card had to fall back. */
  error: string | null;
}

/** The `rate_cards` columns a card is read from. */
export interface CardRow {
  id: string;
  code: string;
  basis: string | null;
}

/** The `rate_card_lines` columns a card is read from. */
export interface LineRow {
  rateCardId: string;
  /** The pricing vocabulary's id. Null on a line stored without one — a day's card. */
  code: string | null;
  materialName: string;
  symbol: string | null;
  category: string;
  ratePaisePerKg: number;
  notes: string | null;
}

/** The `rate_card_classes` columns a card is read from. */
export interface ClassRow {
  rateCardId: string;
  code: string;
  label: string;
  cpcb: string | null;
  handlingFeePaise: number;
  eprCreditPaise: number;
}

/** Everything a read of the tables gives the card: the rows, and why they are these. */
export interface CardRows {
  /** The active cards, newest first. */
  cards: CardRow[];
  lines: LineRow[];
  classes: ClassRow[];
  /** Why today's daily card is not the one in force; null when it is (or there is none). */
  note: string | null;
}

const DAILY_CODE = /^DAILY-\d{4}-\d{2}-\d{2}$/;
const isDailyCode = (code: string) => DAILY_CODE.test(code);
const idByName = new Map<string, MaterialId>(materialIds.map((id) => [RATE_CARD[id].name, id]));
/** The classes that price an item, as the card in code holds them. */
const codeClasses = (): Record<string, ItemClass> =>
  Object.fromEntries(
    Object.entries(ITEM_CLASSES).map(([code, entry]) => [
      code,
      {
        label: entry.label,
        cpcb: entry.cpcb,
        handlingFee: entry.handlingFee,
        eprCreditInr: entry.eprCreditInr,
      },
    ]),
  );

/** The card as it stands in code, for a deployment with no rate card seeded. */
export function codeRateCard(): RateCardSet {
  return {
    source: "code",
    cardId: null,
    day: null,
    basis: RATE_BASIS,
    validUntil: RATE_VALID_UNTIL,
    materials: { ...RATE_CARD },
    market: {},
    classes: codeClasses(),
    configured: false,
    note: null,
    error: null,
  };
}

/** The card for a pricing path that has not read the database. */
export const CODE_RATE_CARD: RateCardSet = codeRateCard();

/**
 * The card a set of stored rows describes, or null when no card carries a rate.
 *
 * Pure, and separated from the read that feeds it: this is where a day's card and the
 * seeded one are put together, and it is the part worth testing against rows rather than
 * against a database. `lib/rates/card.test.mts` does exactly that.
 */
export function cardFromRows({ cards, lines, classes, note }: CardRows): RateCardSet | null {
  const ratesFrom = cards.find((card) => lines.some((row) => row.rateCardId === card.id));
  if (!ratesFrom) return null;

  // The class schedule is the newest card that carries one, which need not be the card
  // the rates came from: a day's card never has one.
  const scheduleFrom = cards.find((card) => classes.some((row) => row.rateCardId === card.id));
  const daily = isDailyCode(ratesFrom.code);

  // The card in code first, so a card that holds only part of the card still prices every
  // material: a line the stored card is missing keeps the rate it had in code rather than
  // dropping to zero, which would understate a payout instead of reporting a broken card.
  const materials: Record<string, RateCardLine> = { ...RATE_CARD };
  const market: Record<string, MarketNote> = {};
  for (const row of lines) {
    if (row.rateCardId !== ratesFrom.id) continue;
    const id = row.code ?? idByName.get(row.materialName) ?? row.materialName;
    const ratePerKg = row.ratePaisePerKg / 100;
    materials[id] = {
      name: row.materialName,
      symbol: row.symbol ?? "",
      category: row.category as MaterialCategory,
      // The column is paise; every screen and the pricing arithmetic speak rupees.
      ratePerKg,
      // A day's card writes what it derived the rate from into `notes`, so the handling
      // instruction it would otherwise carry comes from the card in code; every other card
      // keeps its own notes as the handling text they were written as.
      handling: daily ? (RATE_CARD[id as MaterialId]?.handling ?? "") : (row.notes ?? ""),
    };
    if (daily) market[id] = marketFromNote(ratePerKg, row.notes);
  }

  const classes_: Record<string, ItemClass> = { ...codeClasses() };
  for (const row of classes) {
    if (row.rateCardId !== scheduleFrom?.id) continue;
    classes_[row.code] = {
      label: row.label,
      cpcb: row.cpcb ?? "",
      handlingFee: row.handlingFeePaise / 100,
      eprCreditInr: row.eprCreditPaise / 100,
    };
  }

  return {
    source: daily ? "daily" : "database",
    cardId: ratesFrom.id,
    day: daily ? ratesFrom.code.slice("DAILY-".length) : null,
    basis: ratesFrom.basis ?? RATE_BASIS,
    // An offer made today holds today, whichever day's card it was priced from.
    validUntil: daily ? `${displayDay(istDate(new Date()))}, 23:59 IST` : RATE_VALID_UNTIL,
    materials,
    market,
    classes: classes_,
    configured: true,
    note,
    error: scheduleFrom
      ? null
      : "The stored card carries no class schedule, so the handling fees and the EPR credits are the card shipped in code.",
  };
}

/**
 * The active card, read from the database, or the code card.
 *
 * The day's card is asked for first, through `currentRates()`: that is the call which
 * fetches today's market prices and stores the day's card, and it never rejects — with no
 * key, no database or a failed feed it keeps the last stored card and says so. Asking
 * before reading is what makes the first request of the day, on any server sharing the
 * database, price from the day's card rather than yesterday's.
 *
 * Four outcomes, each answered plainly: no database is the code card with
 * `configured: false`; an unseeded database and a read failure are the code card with a
 * sentence in `error`; a stored card is its rows, with the class schedule borrowed from
 * another card when the one in force has none, and the code card's rates behind any line
 * the stored one is missing. The pricing path prices an item identically to before when
 * the database is absent, which is what makes this safe to lean on from a computation
 * that must not fail.
 */
export async function loadRateCard(): Promise<RateCardSet> {
  if (!databaseConfigured()) return codeRateCard();
  const connection = database();
  if (!connection) return codeRateCard();

  try {
    const { db } = connection;

    // Never rejects: it stores today's card, or explains why it could not.
    const sheet = await currentRates();

    const cards = await db
      .select({
        id: rateCards.id,
        code: rateCards.code,
        basis: rateCards.basis,
      })
      .from(rateCards)
      .where(eq(rateCards.active, true))
      // Newest first: a day's card becomes active the moment it is stored, and the card
      // seeded from code stays active beside it.
      .orderBy(desc(rateCards.effectiveFrom))
      .limit(5);

    if (cards.length === 0) {
      return {
        ...codeRateCard(),
        configured: true,
        error:
          "No rate card is seeded in this database, so these are the card shipped in code. Run `npm run rates:seed`.",
      };
    }

    const cardIds = cards.map((card) => card.id);
    const [lines, classes] = await Promise.all([
      db
        .select({
          rateCardId: rateCardLines.rateCardId,
          code: rateCardLines.code,
          materialName: rateCardLines.materialName,
          symbol: rateCardLines.symbol,
          category: rateCardLines.category,
          ratePaisePerKg: rateCardLines.ratePaisePerKg,
          notes: rateCardLines.notes,
        })
        .from(rateCardLines)
        .where(inArray(rateCardLines.rateCardId, cardIds))
        .orderBy(rateCardLines.materialName),
      db
        .select({
          rateCardId: rateCardClasses.rateCardId,
          code: rateCardClasses.code,
          label: rateCardClasses.label,
          cpcb: rateCardClasses.cpcb,
          handlingFeePaise: rateCardClasses.handlingFeePaise,
          eprCreditPaise: rateCardClasses.eprCreditPaise,
        })
        .from(rateCardClasses)
        .where(inArray(rateCardClasses.rateCardId, cardIds))
        .orderBy(rateCardClasses.displayOrder),
    ]);

    const card = cardFromRows({ cards, lines, classes, note: sheet.note });
    if (!card) {
      return {
        ...codeRateCard(),
        configured: true,
        error:
          "The seeded rate card has no material lines on it, so these are the card shipped in code. Re-run `npm run rates:seed`.",
      };
    }
    return card;
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
