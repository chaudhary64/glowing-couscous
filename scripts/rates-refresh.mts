/**
 * `npm run rates:refresh` — put today's rate card in force, and print it.
 *
 * The app does this by itself on the first request of the day that needs a price, so
 * this is for seeing it happen: after setting `METALPRICE_API_KEY`, for a scheduled job
 * that would rather not wait for traffic, or to read which card is in force and why.
 * It goes through the module the pricing code uses (`lib/rates/daily.ts`), against the
 * database in `.env.local`, so it spends at most the one call a day the app would.
 *
 *   npm run rates:refresh               today's card, fetched and stored if it is missing
 *   npm run rates:refresh -- --dry-run  ask MetalpriceAPI and print, with no database
 *
 * Exits 1 when today's card is not the one in force, with the reason.
 */
import { closeDatabase } from "@/db/client";
import { RATE_CARD, materialIds } from "@/lib/data/rate-card";
import { formatRate } from "@/lib/format";
import { currentRates } from "@/lib/rates/daily";
import { fedMaterials, fetchMarketPrices, fixedPrices } from "@/lib/rates/feed";

const pad = (text: string, width: number) => text.padEnd(width);
const padStart = (text: string, width: number) => text.padStart(width);

if (process.argv.includes("--dry-run")) {
  const key = process.env.METALPRICE_API_KEY?.trim();
  if (!key) {
    console.error("METALPRICE_API_KEY is not set (put it in .env.local).");
    process.exit(1);
  }
  const market = await fetchMarketPrices(key).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
  console.log(`MetalpriceAPI prices for ${market.date}, at ₹${market.inrPerUsd.toFixed(2)} per US$\n`);
  for (const id of fedMaterials) {
    const perKg = market.perKg[id];
    const fixed = fixedPrices[id];
    const [price, from] =
      perKg !== undefined
        ? [formatRate(perKg), "daily"]
        : fixed
          ? [formatRate(fixed.perKg), `fixed: ${fixed.source}`]
          : [market.needsPaidPlan.includes(id) ? "needs a paid plan" : "not priced", ""];
    console.log(`  ${pad(RATE_CARD[id].name, 22)}${padStart(price, 18)}  ${from}`);
  }
  process.exit(0);
}

const sheet = await currentRates();
console.log(sheet.source === "daily" ? `Daily card for ${sheet.day}` : "Demo card (lib/data/rate-card.ts)");
console.log(`  ${sheet.basis}`);
console.log(`  valid until ${sheet.validUntil}`);
if (sheet.note) console.log(`\n  ${sheet.note}`);

console.log(`\n  ${pad("Material", 26)}${padStart("Rate", 16)}${padStart("Market", 18)}${padStart("Share", 9)}  Source`);
for (const id of materialIds) {
  const line = sheet.lines[id];
  if (line.ratePerKg === 0 && line.marketPerKg === null) continue;
  console.log(
    `  ${pad(RATE_CARD[id].name, 26)}${padStart(formatRate(line.ratePerKg), 16)}` +
      `${padStart(line.marketPerKg === null ? "manual" : formatRate(line.marketPerKg), 18)}` +
      `${padStart(line.share === null ? "" : `${(line.share * 100).toFixed(1)}%`, 9)}` +
      `  ${line.fixedSource ? `fixed: ${line.fixedSource}` : line.marketPerKg === null ? "manual" : "daily"}`,
  );
}

await closeDatabase();
process.exit(sheet.source === "daily" && sheet.note === null ? 0 : 1);
