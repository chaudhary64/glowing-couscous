import type { MaterialId } from "@/lib/data/rate-card";

/**
 * Daily market prices for the rate card, from MetalpriceAPI (metalpriceapi.com).
 *
 * The free plan updates once a day and allows 100 requests a month, and the card asks
 * once a day for every symbol at once. It prices precious metals only: every base metal
 * is refused with "XCU query requires a paid plan" (416), so a refused symbol is dropped
 * and the rest asked again. Refusals are not counted against the plan (checked against
 * the usage endpoint), so the free plan still costs one counted call a day, and a paid
 * plan prices every metal with no change here. Until then those metals are priced from
 * the fixed market prices below.
 *
 * The `unit` parameter (kilograms) is a paid feature too, so prices arrive per ounce and
 * are converted here. The API's symbol list gives gold, silver and palladium per "Troy
 * Ounce" and every other metal per "Ounce", so those are taken as avoirdupois ounces.
 * Payouts do not depend on that reading (the share of the market cancels the unit out);
 * the market price shown beside them does.
 * Rupees come from the same response: `INR` is asked for beside the metals, so one call
 * gives both the dollar price and the dollar's price in rupees.
 *
 * Nothing here touches the database; `lib/rates/daily.ts` decides when to call and what
 * to keep.
 */

/**
 * The card's materials that have a market price, and the symbol each is quoted under.
 * Iron and steel stay manual on purpose: the feed's `IRON` is iron ore, not scrap.
 * Brass and tantalum have no symbol at all.
 */
export const FEED_SYMBOLS = {
  au: "XAU",
  ag: "XAG",
  pd: "XPD",
  cu: "XCU",
  al: "ALU",
  ni: "NI",
  zn: "ZNC",
  sn: "XSN",
  co: "XCO",
  nd: "XND",
} as const satisfies Partial<Record<MaterialId, string>>;

export type FedMaterial = keyof typeof FEED_SYMBOLS;

export const fedMaterials = Object.keys(FEED_SYMBOLS) as FedMaterial[];

const PRECIOUS: ReadonlySet<string> = new Set(["XAU", "XAG", "XPD"]);

export const TROY_OUNCES_PER_KG = 32.1507466;
export const OUNCES_PER_KG = 35.2739619;

/**
 * Market prices for the fed metals the free plan will not price, looked up by hand and
 * held until a plan that prices them daily is in use. Each is the latest close when they
 * were taken, on Monday 12 Oct 2026 before the LME opened, in US$ per tonne:
 *
 *   copper, aluminium, nickel, zinc, tin   LME official cash settlement, Fri 9 Oct 2026,
 *                                          as westmetall.com/en/markdaten.php lists it
 *   cobalt                                 LME, 8 Oct 2026, from tradingeconomics.com
 *   neodymium                              China, ¥947,500/t on 9 Oct 2026, from
 *                                          tradingeconomics.com, at ¥6.6932 per US$
 *
 * They become rupees at ₹96.6373 per US$, the rate MetalpriceAPI gave for the same close,
 * so a fixed price and a fed one are the same kind of number. A fixed price is paid
 * exactly like a fed one: the card pays the share of it the metal was anchored at, so a
 * new figure here moves the next day's card, and a live price, once the plan has one,
 * takes over from it.
 */
const FIXED_INR_PER_USD = 96.637346982;
const FIXED: Partial<Record<FedMaterial, { usdPerTonne: number; source: string }>> = {
  cu: { usdPerTonne: 14_689, source: "LME cash, 09 Oct 2026" },
  al: { usdPerTonne: 3_055.5, source: "LME cash, 09 Oct 2026" },
  ni: { usdPerTonne: 15_545, source: "LME cash, 09 Oct 2026" },
  zn: { usdPerTonne: 3_840, source: "LME cash, 09 Oct 2026" },
  sn: { usdPerTonne: 52_900, source: "LME cash, 09 Oct 2026" },
  co: { usdPerTonne: 39_245, source: "LME, 08 Oct 2026" },
  nd: { usdPerTonne: 947_500 / 6.6932, source: "China, 09 Oct 2026" },
};

/** The fixed market prices, in rupees per kilogram, with where each came from. */
export const fixedPrices: Partial<Record<FedMaterial, { perKg: number; source: string }>> = Object.fromEntries(
  Object.entries(FIXED).map(([id, { usdPerTonne, source }]) => [
    id,
    { perKg: Math.round(((usdPerTonne * FIXED_INR_PER_USD) / 1000) * 100) / 100, source },
  ]),
);

const ENDPOINT = "https://api.metalpriceapi.com/v1/latest";

export interface MarketPrices {
  /** The day the prices are for, as the response stamps them (YYYY-MM-DD, IST). */
  date: string;
  /** Rupees per US dollar, from the same response. */
  inrPerUsd: number;
  /** Market price in rupees per kilogram, for each material the response priced. */
  perKg: Partial<Record<FedMaterial, number>>;
  /** Materials the key's plan would not price ("requires a paid plan"). */
  needsPaidPlan: FedMaterial[];
}

export class FeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedError";
  }
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/** The calendar day in India for an instant, as YYYY-MM-DD. */
export function istDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "12 Oct 2026" for a YYYY-MM-DD day. Spelled out rather than left to `Intl`, whose
 * en-GB September is "Sept" on current Node: `parseIstStamp` reads three letters, and a
 * four-letter month would leave a September valuation with no expiry.
 */
export function displayDay(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day} ${MONTHS[Number(month) - 1]} ${year}`;
}

/**
 * Rupees per kilogram from one MetalpriceAPI `latest` response (base USD), or null when
 * it holds no usable price. `USDXAU` is dollars per ounce; when a response carries only
 * `XAU` (ounces per dollar), its reciprocal is the same figure.
 */
export function marketFromResponse(json: unknown): MarketPrices | null {
  if (typeof json !== "object" || json === null) return null;
  const body = json as { success?: boolean; timestamp?: number; rates?: Record<string, number> };
  if (body.success === false || !body.rates) return null;

  const rates = body.rates;
  const inrPerUsd = rates.INR;
  if (!(typeof inrPerUsd === "number" && inrPerUsd > 0)) return null;

  const perKg: Partial<Record<FedMaterial, number>> = {};
  for (const id of fedMaterials) {
    const symbol = FEED_SYMBOLS[id];
    const direct = rates[`USD${symbol}`];
    const inverse = rates[symbol];
    const usdPerOunce =
      typeof direct === "number" && direct > 0
        ? direct
        : typeof inverse === "number" && inverse > 0
          ? 1 / inverse
          : null;
    if (usdPerOunce === null || !Number.isFinite(usdPerOunce)) continue;
    const ouncesPerKg = PRECIOUS.has(symbol) ? TROY_OUNCES_PER_KG : OUNCES_PER_KG;
    perKg[id] = round2(usdPerOunce * inrPerUsd * ouncesPerKg);
  }
  if (Object.keys(perKg).length === 0) return null;

  const at = typeof body.timestamp === "number" ? new Date(body.timestamp * 1000) : new Date();
  return { date: istDate(at), inrPerUsd, perKg, needsPaidPlan: [] };
}

/**
 * What the card pays for a material: the day's market price times the share of the
 * market the card paid when the feed was first switched on (the anchor), never more
 * than the market itself. Day one therefore pays exactly the card it replaced, unless
 * that was more than the market, and every day after moves with the market.
 *
 * Whole rupees, like the card it replaces: a valuation stores its rate in paise as an
 * integer, and every screen prints rates without decimals.
 */
export function paidRate(
  cardRate: number,
  anchorMarket: number,
  marketToday: number,
): { ratePerKg: number; share: number } {
  const share = anchorMarket > 0 ? Math.min(1, cardRate / anchorMarket) : 1;
  return { ratePerKg: Math.round(marketToday * share), share };
}

/** How the API refuses a symbol the key's plan does not cover: "XCU query requires a paid plan." */
const PAID_ONLY = /^(\w+) query requires a paid plan/;
const idBySymbol = new Map(fedMaterials.map((id) => [FEED_SYMBOLS[id] as string, id]));

/** One answer from `latest`, for these symbols plus the rupee. */
async function ask(apiKey: string, symbols: string[], signal: AbortSignal, fetchImpl: typeof fetch) {
  const url = new URL(ENDPOINT);
  url.searchParams.set("base", "USD");
  url.searchParams.set("currencies", ["INR", ...symbols].join(","));

  let response: Response;
  try {
    // The key travels as a header, so it never sits in a URL a log might keep.
    response = await fetchImpl(url, { headers: { "X-API-KEY": apiKey }, signal, cache: "no-store" });
  } catch (error) {
    throw new FeedError(
      `MetalpriceAPI could not be reached (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const json: unknown = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, json };
}

/**
 * Every fed metal plus the rupee rate, in one counted call. Throws `FeedError` with a
 * readable reason.
 */
export async function fetchMarketPrices(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MarketPrices> {
  // One deadline for the whole exchange, refusals included, so a slow API cannot hold
  // the request that is waiting on it.
  const signal = AbortSignal.timeout(10_000);
  const needsPaidPlan: FedMaterial[] = [];
  let symbols: string[] = fedMaterials.map((id) => FEED_SYMBOLS[id]);

  for (;;) {
    const { status, ok, json } = await ask(apiKey, symbols, signal, fetchImpl);

    // A refusal arrives as HTTP 200 with `success: false` and the reason in the body, e.g.
    // `{ "success": false, "error": { "statusCode": 102, "message": "…invalid access key…" } }`.
    const failure = json as { success?: boolean; error?: { statusCode?: number; message?: string } } | null;
    if (!ok || failure?.success === false) {
      const reason = failure?.error?.message;
      const refused = reason ? PAID_ONLY.exec(reason)?.[1] : undefined;
      const id = refused ? idBySymbol.get(refused) : undefined;
      if (ok && refused && id && symbols.includes(refused) && symbols.length > 1) {
        symbols = symbols.filter((symbol) => symbol !== refused);
        needsPaidPlan.push(id);
        continue;
      }
      const code = failure?.error?.statusCode;
      throw new FeedError(
        reason
          ? `MetalpriceAPI refused the request${code ? ` (${code})` : ""}: ${reason}`
          : `MetalpriceAPI answered ${status}`,
      );
    }

    const prices = marketFromResponse(json);
    if (!prices) throw new FeedError("MetalpriceAPI answered, but with no price the card can use");
    return { ...prices, needsPaidPlan };
  }
}
