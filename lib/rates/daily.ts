import { and, desc, eq, like, lt } from "drizzle-orm";

import { database } from "@/db/client";
import { rateCardLines, rateCards } from "@/db/schema";
import {
  RATE_BASIS,
  RATE_CARD,
  RATE_VALID_UNTIL,
  materialIds,
  type MaterialId,
} from "@/lib/data/rate-card";

import {
  FEED_SYMBOLS,
  displayDay,
  fedMaterials,
  fetchMarketPrices,
  fixedPrices,
  istDate,
  paidRate,
  type FedMaterial,
  type MarketPrices,
} from "./feed";

/**
 * The rate card in force: one dated card a day, kept in `rate_cards` / `rate_card_lines`.
 *
 * The first request of a day (Indian time) that needs a price asks MetalpriceAPI once,
 * turns the answer into rupees per kilogram and stores the day's card; every later
 * request that day, on any server sharing the database, reads it back. A metal the feed
 * prices is paid at the day's market price times its share of the market, fixed on the
 * first day the feed priced it: the demo card's rate divided by that day's market price
 * (the `DAILY-ANCHOR` card), capped at the market itself. So switching the feed on
 * changes no payout, except to bring a rate the demo card set above the market down to
 * it, and every day after moves with the market. A fed metal the key's plan will not
 * price is paid the same way from its fixed market price (`fixedPrices` in `./feed`), and
 * materials with no market price at all keep the demo card's own rate.
 *
 * Nothing here can stop a valuation. With no `METALPRICE_API_KEY`, no database, or a
 * failed call, the last stored card stays in force, and with none stored, the static
 * card in `lib/data/rate-card.ts` does, with a note that says which and why.
 */

export interface RateSheetLine extends MarketNote {
  /** What the card pays, in whole rupees per kilogram. */
  ratePerKg: number;
}

export interface RateSheet {
  /** "daily" when a stored daily card is in force; "static" when the demo card is. */
  source: "daily" | "static";
  /** The stored card the rates come from, for `valuations.rate_card_id`; null for the demo card. */
  cardId: string | null;
  basis: string;
  validUntil: string;
  /** The day the daily card is for (YYYY-MM-DD), or null for the demo card. */
  day: string | null;
  lines: Record<MaterialId, RateSheetLine>;
  /** Why today's daily card is not the one in force; null when it is. */
  note: string | null;
}

const ANCHOR_CODE = "DAILY-ANCHOR";
const dailyCode = (day: string) => `DAILY-${day}`;
/** Matches only the dated cards, not the anchor. */
const DAILY_CODES = "DAILY-2%";
/** A fed line's note starts with the market price, which is how a read gets it back. */
const MARKET_NOTE = /^Market ₹([\d.]+)\/kg/;
const PAID_PLAN_NOTE = "Needs a paid MetalpriceAPI plan, so the demo card's rate";
/** A line priced from a fixed market price ends with where that price came from. */
const FIXED_NOTE = / · fixed: (.+)$/;

/**
 * How a stored line's note says its rate was arrived at.
 *
 * The note is the only place a card records where a rate came from, so it is parsed in
 * one place: `storeDaily` writes it, `sheetFromCard` reads the day's card back through
 * it, and `lib/rates/card.ts` reads the card in force through it — whichever card that
 * turns out to be.
 */
export interface MarketNote {
  /** The market price in rupees per kilogram, when the line was priced from one. */
  marketPerKg: number | null;
  /** The share of that market price the line pays (0 to 1), when it was priced from one. */
  share: number | null;
  /** Where the market price came from when it is a fixed one rather than the day's feed. */
  fixedSource: string | null;
  /** True when the feed has this metal but the key's plan would not price it. */
  needsPaidPlan: boolean;
}

/** The market provenance a stored line's `notes` records, for a rate of `ratePerKg`. */
export function marketFromNote(ratePerKg: number, notes: string | null): MarketNote {
  const match = notes ? MARKET_NOTE.exec(notes) : null;
  const marketPerKg = match ? Number(match[1]) : null;
  return {
    marketPerKg,
    share: marketPerKg ? ratePerKg / marketPerKg : null,
    fixedSource: notes ? (FIXED_NOTE.exec(notes)?.[1] ?? null) : null,
    needsPaidPlan: notes === PAID_PLAN_NOTE,
  };
}

const isFed = (id: MaterialId): id is FedMaterial => id in FEED_SYMBOLS;
const idByName = new Map<string, MaterialId>(materialIds.map((id) => [RATE_CARD[id].name, id]));
/** The database's own words, not Drizzle's wrapper, which repeats the whole query and its parameters. */
const messageOf = (error: unknown): string =>
  error instanceof Error ? (error.cause instanceof Error ? error.cause.message : error.message) : String(error);
const symbolOf = (id: MaterialId) => (RATE_CARD[id].symbol === "—" ? null : RATE_CARD[id].symbol);

/** The static demo card, as a sheet. */
export function staticSheet(note: string | null = null): RateSheet {
  const lines = {} as Record<MaterialId, RateSheetLine>;
  for (const id of materialIds) {
    lines[id] = { ratePerKg: RATE_CARD[id].ratePerKg, marketPerKg: null, share: null, fixedSource: null, needsPaidPlan: false };
  }
  return {
    source: "static",
    cardId: null,
    basis: RATE_BASIS,
    validUntil: RATE_VALID_UNTIL,
    day: null,
    lines,
    note,
  };
}

export const STATIC_SHEET = staticSheet();

type Db = NonNullable<ReturnType<typeof database>>["db"];
/** The query surface a transaction shares with the database handle. */
type Executor = Pick<Db, "select" | "insert" | "update">;

interface StoredCard {
  id: string;
  basis: string | null;
  effectiveFrom: string;
}

const cardColumns = { id: rateCards.id, basis: rateCards.basis, effectiveFrom: rateCards.effectiveFrom };

async function cardByCode(db: Executor, code: string): Promise<StoredCard | null> {
  const [card] = await db.select(cardColumns).from(rateCards).where(eq(rateCards.code, code)).limit(1);
  return card ?? null;
}

async function latestDailyCard(db: Executor): Promise<StoredCard | null> {
  const [card] = await db
    .select(cardColumns)
    .from(rateCards)
    .where(like(rateCards.code, DAILY_CODES))
    .orderBy(desc(rateCards.effectiveFrom))
    .limit(1);
  return card ?? null;
}

/** Each material's line on a stored card, keyed by material id. */
async function linesOf(db: Executor, cardId: string) {
  const rows = await db
    .select({ name: rateCardLines.materialName, paise: rateCardLines.ratePaisePerKg, notes: rateCardLines.notes })
    .from(rateCardLines)
    .where(eq(rateCardLines.rateCardId, cardId));
  const byId = new Map<MaterialId, { paise: number; notes: string | null }>();
  for (const row of rows) {
    const id = idByName.get(row.name);
    if (id) byId.set(id, { paise: row.paise, notes: row.notes });
  }
  return byId;
}

async function sheetFromCard(db: Executor, card: StoredCard, today: string, note: string | null): Promise<RateSheet> {
  const stored = await linesOf(db, card.id);
  const lines = {} as Record<MaterialId, RateSheetLine>;
  for (const id of materialIds) {
    const row = stored.get(id);
    const ratePerKg = row ? row.paise / 100 : RATE_CARD[id].ratePerKg;
    lines[id] = { ratePerKg, ...marketFromNote(ratePerKg, row?.notes ?? null) };
  }
  return {
    source: "daily",
    cardId: card.id,
    basis: card.basis ?? `Daily rate card · ${displayDay(card.effectiveFrom)}`,
    // An offer made today holds today, whichever day's card it was priced from.
    validUntil: `${displayDay(today)}, 23:59 IST`,
    day: card.effectiveFrom,
    lines,
    note,
  };
}

/**
 * Store today's card in one transaction, anchoring any material the feed prices for the
 * first time at today's price. Concurrent first requests are safe: card codes and a
 * card's material names are unique, so the second writer's inserts do nothing and the
 * card the first one wrote is the one in force.
 */
async function storeDaily(db: Db, day: string, market: MarketPrices): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(rateCards)
      .values({
        code: ANCHOR_CODE,
        name: "Market prices the daily card is anchored to",
        basis: `MetalpriceAPI market prices for ${displayDay(market.date)} · ₹/kg`,
        effectiveFrom: day,
        active: false,
        notes: "Each fed material pays the demo card's rate divided by this price, as a share of each day's market, capped at the market.",
      })
      .onConflictDoNothing({ target: rateCards.code });
    const anchor = await cardByCode(tx, ANCHOR_CODE);
    if (!anchor) throw new Error("the anchor card could not be read back");

    // The day's market: the feed's prices, and the fixed price of any fed metal the feed
    // did not price, which from here on is anchored and paid exactly like a fed one.
    const prices: Partial<Record<FedMaterial, number>> = { ...market.perKg };
    const fixedSource: Partial<Record<FedMaterial, string>> = {};
    for (const id of fedMaterials) {
      const fixed = fixedPrices[id];
      if (prices[id] === undefined && fixed) {
        prices[id] = fixed.perKg;
        fixedSource[id] = fixed.source;
      }
    }

    // A material priced for the first time is anchored at today's price, so it joins
    // the card paying exactly what the card paid for it, and moves from tomorrow.
    const priced = Object.entries(prices) as [FedMaterial, number][];
    if (priced.length > 0) {
      await tx
        .insert(rateCardLines)
        .values(
          priced.map(([id, perKg]) => ({
            rateCardId: anchor.id,
            materialName: RATE_CARD[id].name,
            symbol: symbolOf(id),
            category: RATE_CARD[id].category,
            ratePaisePerKg: Math.round(perKg * 100),
            notes: fixedSource[id]
              ? `Market ₹${perKg.toFixed(2)}/kg · fixed: ${fixedSource[id]}`
              : `Market ₹${perKg.toFixed(2)}/kg on ${displayDay(market.date)}`,
          })),
        )
        .onConflictDoNothing({ target: [rateCardLines.rateCardId, rateCardLines.materialName] });
    }
    const anchored = await linesOf(tx, anchor.id);

    const [card] = await tx
      .insert(rateCards)
      .values({
        code: dailyCode(day),
        name: `Daily rate card · ${displayDay(day)}`,
        basis: `MetalpriceAPI market prices for ${displayDay(market.date)}, at ₹${market.inrPerUsd.toFixed(2)} per US$${
          Object.keys(fixedSource).length > 0 ? ", with fixed prices for the metals it does not price" : ""
        } · ₹/kg`,
        effectiveFrom: day,
        active: true,
      })
      .onConflictDoNothing({ target: rateCards.code })
      .returning({ id: rateCards.id });
    if (!card) return;

    await tx.insert(rateCardLines).values(
      materialIds.map((id) => {
        const entry = RATE_CARD[id];
        const base = { rateCardId: card.id, materialName: entry.name, symbol: symbolOf(id), category: entry.category };
        const marketToday = isFed(id) ? prices[id] : undefined;
        const anchorLine = anchored.get(id);
        if (marketToday !== undefined && anchorLine) {
          const { ratePerKg, share } = paidRate(entry.ratePerKg, anchorLine.paise / 100, marketToday);
          const fixed = isFed(id) ? fixedSource[id] : undefined;
          return {
            ...base,
            ratePaisePerKg: ratePerKg * 100,
            notes: `Market ₹${marketToday.toFixed(2)}/kg · pays ${(share * 100).toFixed(1)}% of it · ${fixed ? `fixed: ${fixed}` : "MetalpriceAPI"}`,
          };
        }
        return {
          ...base,
          ratePaisePerKg: entry.ratePerKg * 100,
          notes: !isFed(id)
            ? "Manual rate: the feed has no market price for this material"
            : market.needsPaidPlan.includes(id)
              ? PAID_PLAN_NOTE
              : "Not in today's feed, so the demo card's rate",
        };
      }),
    );

    // Yesterday's card stops being the one in force today.
    await tx
      .update(rateCards)
      .set({ active: false, effectiveTo: day })
      .where(and(like(rateCards.code, DAILY_CODES), eq(rateCards.active, true), lt(rateCards.effectiveFrom, day)));
  });
}

/**
 * Per server process. A read is reused for ten minutes, so a busy day costs one query
 * per instance per ten minutes. A failed call is retried after an hour rather than on
 * every request, and prices that were fetched but could not be stored are kept for the
 * day, because the free plan's 100 calls a month are the budget being protected.
 */
let memo: { day: string; at: number; sheet: RateSheet } | null = null;
let inflight: { day: string; sheet: Promise<RateSheet> } | null = null;
let fetched: { day: string; market: MarketPrices } | null = null;
let lastFailure = Number.NEGATIVE_INFINITY;
const MEMO_MS = 10 * 60_000;
const RETRY_MS = 60 * 60_000;

/** Forget the cached sheet and the failure clock. For tests and scripts. */
export function resetRatesCache(): void {
  memo = null;
  inflight = null;
  fetched = null;
  lastFailure = Number.NEGATIVE_INFINITY;
}

async function fallback(db: Executor, today: string, note: string): Promise<RateSheet> {
  const latest = await latestDailyCard(db);
  return latest ? sheetFromCard(db, latest, today, note) : staticSheet(note);
}

/**
 * The rate card in force at `now`. Never rejects. Requests that arrive together share
 * one read, so the first minutes of a busy day still cost one call to the feed.
 */
export function currentRates(now: Date = new Date()): Promise<RateSheet> {
  const today = istDate(now);
  if (memo && memo.day === today && now.getTime() - memo.at < MEMO_MS) return Promise.resolve(memo.sheet);
  if (inflight && inflight.day === today) return inflight.sheet;

  const sheet = readRates(today, now.getTime()).finally(() => {
    if (inflight?.sheet === sheet) inflight = null;
  });
  inflight = { day: today, sheet };
  return sheet;
}

async function readRates(today: string, at: number): Promise<RateSheet> {
  const remember = (sheet: RateSheet) => {
    memo = { day: today, at, sheet };
    return sheet;
  };

  try {
    const connection = database();
    if (!connection) {
      return staticSheet("No database is configured, so no daily card can be kept; the demo card is in force.");
    }
    const { db } = connection;

    const stored = await cardByCode(db, dailyCode(today));
    if (stored) return remember(await sheetFromCard(db, stored, today, null));

    const key = process.env.METALPRICE_API_KEY?.trim();
    if (!key) {
      return remember(await fallback(db, today, "METALPRICE_API_KEY is not set, so today's market prices were not fetched."));
    }
    if (at - lastFailure < RETRY_MS) {
      return remember(await fallback(db, today, "Today's market prices could not be fetched; the next try is within the hour."));
    }

    let market: MarketPrices;
    try {
      market = fetched?.day === today ? fetched.market : await fetchMarketPrices(key);
      fetched = { day: today, market };
    } catch (error) {
      lastFailure = at;
      console.error("[rates] the daily price feed failed:", messageOf(error));
      return remember(await fallback(db, today, `Today's market prices could not be fetched: ${messageOf(error)}.`));
    }
    try {
      await storeDaily(db, today, market);
    } catch (error) {
      lastFailure = at;
      console.error("[rates] storing today's card failed:", messageOf(error));
      return remember(await fallback(db, today, `Today's card could not be stored: ${messageOf(error)}.`));
    }

    const card = await cardByCode(db, dailyCode(today));
    return remember(card ? await sheetFromCard(db, card, today, null) : staticSheet("Today's card could not be read back."));
  } catch (error) {
    console.error("[rates] reading the rate card failed:", messageOf(error));
    return staticSheet(`The rate card could not be read (${messageOf(error)}), so the demo card is in force.`);
  }
}
