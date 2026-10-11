/**
 * Daily price feed tests — run with `npm run test:rates`.
 *
 * Node's built-in runner, no framework, and no network: `fetchMarketPrices` takes the
 * `fetch` it calls, so the one call a day the free plan allows is never spent here.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseIstStamp } from "@/lib/format";

import {
  FEED_SYMBOLS,
  FeedError,
  OUNCES_PER_KG,
  TROY_OUNCES_PER_KG,
  displayDay,
  fetchMarketPrices,
  fixedPrices,
  istDate,
  marketFromResponse,
  paidRate,
} from "./feed";

const near = (actual: number | undefined, expected: number, label: string) =>
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 0.01, `${label}: ${actual} is not ${expected}`);

/** A `latest` answer the way MetalpriceAPI writes it: base USD, both directions of each rate. */
function answer(rates: Record<string, number>, timestamp = Date.parse("2026-10-12T06:00:00Z") / 1000) {
  return { success: true, base: "USD", timestamp, rates };
}

describe("marketFromResponse", () => {
  it("prices a precious metal per troy ounce, in rupees per kilogram", () => {
    const prices = marketFromResponse(answer({ INR: 88, XAU: 1 / 4000, USDXAU: 4000 }));
    // $4,000 an ounce at ₹88 is ₹3,52,000 an ounce, and a kilogram is 32.15 troy ounces.
    near(prices?.perKg.au, 11_317_062.8, "gold");
    assert.equal(prices?.inrPerUsd, 88);
  });

  it("prices a base metal per avoirdupois ounce", () => {
    const prices = marketFromResponse(answer({ INR: 88, USDXCU: 0.3, USDALU: 0.08 }));
    near(prices?.perKg.cu, 0.3 * 88 * OUNCES_PER_KG, "copper");
    near(prices?.perKg.al, 0.08 * 88 * OUNCES_PER_KG, "aluminium");
    near(prices?.perKg.cu, 931.23, "copper, written out");
  });

  it("falls back to the reciprocal when only ounces per dollar are given", () => {
    const prices = marketFromResponse(answer({ INR: 88, XAG: 1 / 30 }));
    near(prices?.perKg.ag, 30 * 88 * TROY_OUNCES_PER_KG, "silver");
  });

  it("skips a metal the answer has no usable price for, and keeps the rest", () => {
    const prices = marketFromResponse(answer({ INR: 88, USDXAU: 4000, USDXPD: 0, XCO: -1, USDNI: Number.NaN }));
    assert.deepEqual(Object.keys(prices?.perKg ?? {}), ["au"]);
  });

  it("is null for a failed answer, a missing rupee rate, or no metal at all", () => {
    assert.equal(marketFromResponse({ success: false, error: { code: 101 } }), null);
    assert.equal(marketFromResponse(answer({ USDXAU: 4000 })), null);
    assert.equal(marketFromResponse(answer({ INR: 88 })), null);
    assert.equal(marketFromResponse(null), null);
    assert.equal(marketFromResponse("prices"), null);
  });

  it("dates the prices by the answer's timestamp, in India", () => {
    const prices = marketFromResponse(answer({ INR: 88, USDXAU: 4000 }, Date.parse("2026-10-11T20:00:00Z") / 1000));
    assert.equal(prices?.date, "2026-10-12");
  });
});

describe("fixedPrices", () => {
  it("covers exactly the metals the free plan refuses, so the feed always prices the rest", () => {
    assert.deepEqual(Object.keys(fixedPrices).sort(), ["al", "co", "cu", "nd", "ni", "sn", "zn"]);
  });

  it("turns US$ a tonne into rupees a kilogram at the feed's own rupee rate", () => {
    // $14,689 a tonne of copper at ₹96.6373 is ₹1,419.51 a kilogram.
    assert.deepEqual(
      Object.fromEntries(Object.entries(fixedPrices).map(([id, fixed]) => [id, fixed?.perKg])),
      { cu: 1419.51, al: 295.28, ni: 1502.23, zn: 371.09, sn: 5112.12, co: 3792.53, nd: 13680.14 },
    );
  });

  it("says where each price came from", () => {
    assert.equal(fixedPrices.cu?.source, "LME cash, 09 Oct 2026");
    assert.equal(fixedPrices.co?.source, "LME, 08 Oct 2026");
    assert.equal(fixedPrices.nd?.source, "China, 09 Oct 2026");
  });
});

describe("paidRate", () => {
  it("pays exactly the card's rate on the day the feed is switched on", () => {
    assert.equal(paidRate(540, 931.23, 931.23).ratePerKg, 540);
    assert.equal(paidRate(5_842_000, 11_317_062.8, 11_317_062.8).ratePerKg, 5_842_000);
  });

  it("moves with the market after that, keeping the share", () => {
    const { ratePerKg, share } = paidRate(540, 931.23, 931.23 * 1.1);
    assert.equal(ratePerKg, 594);
    near(share, 540 / 931.23, "share");
  });

  it("never pays more than the market", () => {
    // The demo card paid ₹2,800 for neodymium the day the market was ₹2,000.
    assert.deepEqual(paidRate(2800, 2000, 2100), { ratePerKg: 2100, share: 1 });
  });

  it("pays whole rupees, because a valuation stores its rate in whole paise", () => {
    assert.ok(Number.isInteger(paidRate(165, 248.37, 251.91).ratePerKg));
  });

  it("pays the market when there is no anchor price to take a share of", () => {
    assert.deepEqual(paidRate(540, 0, 900), { ratePerKg: 900, share: 1 });
  });
});

describe("days", () => {
  it("turns an instant into the calendar day in India", () => {
    assert.equal(istDate(new Date("2026-10-11T20:00:00Z")), "2026-10-12");
    assert.equal(istDate(new Date("2026-10-11T18:29:59Z")), "2026-10-11");
    assert.equal(istDate(new Date("2026-10-11T18:30:00Z")), "2026-10-12");
  });

  it("writes a day with a three-letter month, September included", () => {
    assert.equal(displayDay("2026-10-12"), "12 Oct 2026");
    assert.equal(displayDay("2026-09-05"), "05 Sep 2026");
  });

  it("writes an expiry the valuation recorder can read back", () => {
    const expiry = parseIstStamp(`${displayDay("2026-09-05")}, 23:59 IST`);
    assert.equal(expiry?.toISOString(), "2026-09-05T18:29:00.000Z");
  });
});

describe("fetchMarketPrices", () => {
  function fakeFetch(respond: (url: URL) => Response | Promise<Response>) {
    const calls: { url: URL; headers: Headers }[] = [];
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, headers: new Headers(init?.headers) });
      return respond(url);
    }) as typeof fetch;
    return { calls, impl };
  }

  /** How the live API refuses a symbol the plan does not cover, verbatim. */
  const paidOnly = (symbol: string) =>
    Response.json({ success: false, error: { statusCode: 416, message: `${symbol} query requires a paid plan.` } });
  const asked = (url: URL) => url.searchParams.get("currencies")?.split(",") ?? [];

  it("asks once for every fed metal and the rupee, with the key in a header", async () => {
    const { calls, impl } = fakeFetch(() => Response.json(answer({ INR: 88, USDXAU: 4000, USDXCU: 0.3 })));
    const prices = await fetchMarketPrices("test-key", impl);

    assert.equal(calls.length, 1);
    const [{ url, headers }] = calls;
    assert.equal(url.origin + url.pathname, "https://api.metalpriceapi.com/v1/latest");
    assert.equal(url.searchParams.get("base"), "USD");
    assert.deepEqual(url.searchParams.get("currencies")?.split(","), ["INR", ...Object.values(FEED_SYMBOLS)]);
    assert.equal(headers.get("x-api-key"), "test-key");
    assert.ok(!url.href.includes("test-key"), "the key must not be in the URL");
    near(prices.perKg.au, 11_317_062.8, "gold");
  });

  it("on the free plan, drops each metal it refuses and prices the rest", async () => {
    // The free plan's behaviour on 12 Oct 2026: every base metal refused, one at a time,
    // and the precious metals answered. The figures are that day's answer.
    const PAID = new Set(["XCU", "ALU", "NI", "ZNC", "XSN", "XCO", "XND"]);
    const { calls, impl } = fakeFetch((url) => {
      const refused = asked(url).find((symbol) => PAID.has(symbol));
      return refused
        ? paidOnly(refused)
        : Response.json(answer({ INR: 96.637346982, USDXAU: 4194.3493725253, USDXAG: 60.7419329474, USDXPD: 1149.7024052809 }));
    });
    const prices = await fetchMarketPrices("free-key", impl);

    assert.equal(calls.length, 8, "seven refusals, then the answer");
    assert.deepEqual(asked(calls[7].url), ["INR", "XAU", "XAG", "XPD"]);
    assert.deepEqual(prices.needsPaidPlan, ["cu", "al", "ni", "zn", "sn", "co", "nd"]);
    assert.deepEqual(Object.keys(prices.perKg), ["au", "ag", "pd"]);
    // About ₹1.30 crore a kilogram of gold, ₹1.89 lakh of silver.
    near(prices.perKg.au, 4194.3493725253 * 96.637346982 * TROY_OUNCES_PER_KG, "gold");
    assert.ok(Math.abs((prices.perKg.au ?? 0) - 13_032_000) < 5_000, String(prices.perKg.au));
    assert.ok(Math.abs((prices.perKg.ag ?? 0) - 188_700) < 500, String(prices.perKg.ag));
  });

  it("gives up when the plan refuses even the last metal", async () => {
    const { calls, impl } = fakeFetch((url) => paidOnly(asked(url)[1]));
    await assert.rejects(fetchMarketPrices("key", impl), /refused the request \(416\): XND query requires a paid plan/);
    assert.equal(calls.length, 10, "nine dropped, the tenth refusal is final");
  });

  it("reports the API's own reason when it refuses, which it does with a 200", async () => {
    // The body the live API sends for a key it does not know, verbatim.
    const { calls, impl } = fakeFetch(() =>
      Response.json({
        success: false,
        error: {
          statusCode: 102,
          message: "User did not supply an access key or supplied an invalid access key. Please sign up for a FREE API Key at metalpriceapi.com",
        },
      }),
    );
    await assert.rejects(fetchMarketPrices("bad", impl), (error: unknown) => {
      assert.ok(error instanceof FeedError);
      assert.match(error.message, /^MetalpriceAPI refused the request \(102\): User did not supply an access key or supplied an invalid access key\./);
      return true;
    });
    assert.equal(calls.length, 1, "only a paid-plan refusal is retried");
  });

  it("reports the status when the answer has no body", async () => {
    const { impl } = fakeFetch(() => new Response("upstream down", { status: 503 }));
    await assert.rejects(fetchMarketPrices("key", impl), /MetalpriceAPI answered 503/);
  });

  it("reports an unreachable API", async () => {
    const { impl } = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    await assert.rejects(fetchMarketPrices("key", impl), /could not be reached \(fetch failed\)/);
  });

  it("refuses an answer with nothing the card can use", async () => {
    const { impl } = fakeFetch(() => Response.json(answer({ INR: 88 })));
    await assert.rejects(fetchMarketPrices("key", impl), /no price the card can use/);
  });
});
