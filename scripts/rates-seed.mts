/**
 * Write the rate card into Postgres.
 *
 * `lib/data/rate-card.ts` is the source of truth for the whole card: one line per
 * material, and one entry per item class with its handling fee and its EPR credit.
 * Until this script existed those values were only in code, so `/rates` and the pricing
 * path each had their own copy of the same numbers — the exact two-copies problem the
 * rest of this project refuses.
 *
 * Like `scripts/pickup-seed.mjs`, this **converges** the card rather than adding to it:
 * every line it expects is written, and every line under the same card that it does not
 * expect is deleted, so re-running it after a rate is retired is the way to retire it and
 * a half-seeded card is not a state this can be left in.
 *
 * Usage:
 *   npm run rates:seed
 *
 * It reads `DATABASE_URL` from `.env.local`, the same value the app and the migrations
 * read. Deleting is safe here in a way it is not for a priced item: this table is
 * configuration, and nothing references a rate line's own row.
 */
import { and, eq, ne, notInArray } from "drizzle-orm";

import { closeDatabase, database } from "@/db/client";
import { rateCardClasses, rateCardLines, rateCards } from "@/db/schema";
import {
  ITEM_CLASSES,
  RATE_BASIS,
  RATE_CARD,
  RATE_VALID_UNTIL,
  itemClassCodes,
  materialIds,
} from "@/lib/data/rate-card";

const CARD_CODE = "ecoepr-2026-q3";
const CARD_NAME = "EcoEPR rate card · IMD benchmark 2026-Q3 · Mumbai zone";
/** The card's published window. `RATE_VALID_UNTIL` is the day it stops being in force. */
const EFFECTIVE_FROM = "2026-10-01";
const EFFECTIVE_TO = "2026-11-09";

const connection = database();
if (!connection) {
  console.error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in, or export it in the shell.",
  );
  process.exit(1);
}
const { db } = connection;

console.log(`Seeding rate card ${CARD_CODE} (${RATE_BASIS})`);

/* --------------------------------------------------------------------- card */

const [card] = await db
  .insert(rateCards)
  .values({
    code: CARD_CODE,
    name: CARD_NAME,
    basis: RATE_BASIS,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: EFFECTIVE_TO,
    active: true,
    notes: `Seeded from lib/data/rate-card.ts. Prices every valuation until ${RATE_VALID_UNTIL}.`,
  })
  .onConflictDoUpdate({
    target: rateCards.code,
    set: {
      name: CARD_NAME,
      basis: RATE_BASIS,
      effectiveFrom: EFFECTIVE_FROM,
      effectiveTo: EFFECTIVE_TO,
      active: true,
    },
  })
  .returning({ id: rateCards.id });

if (!card) {
  console.error("The rate card row was not written.");
  await closeDatabase();
  process.exit(1);
}

// One active card, so "the card in force" is not a question two rows can disagree about.
await db
  .update(rateCards)
  .set({ active: false })
  .where(and(eq(rateCards.active, true), ne(rateCards.code, CARD_CODE)));

/* ---------------------------------------------------------------- materials */

const materialNames = materialIds.map((id) => RATE_CARD[id].name);

for (const id of materialIds) {
  const line = RATE_CARD[id];
  await db
    .insert(rateCardLines)
    .values({
      rateCardId: card.id,
      code: id,
      materialName: line.name,
      symbol: line.symbol,
      category: line.category,
      // The app computes in whole rupees; the column is paise, like every money column.
      ratePaisePerKg: Math.round(line.ratePerKg * 100),
      notes: line.handling,
    })
    .onConflictDoUpdate({
      target: [rateCardLines.rateCardId, rateCardLines.materialName],
      set: {
        code: id,
        symbol: line.symbol,
        category: line.category,
        ratePaisePerKg: Math.round(line.ratePerKg * 100),
        notes: line.handling,
      },
    });
}

await db
  .delete(rateCardLines)
  .where(
    and(
      eq(rateCardLines.rateCardId, card.id),
      notInArray(rateCardLines.materialName, materialNames),
    ),
  );

/* ------------------------------------------------------------------ classes */

for (const [index, code] of itemClassCodes.entries()) {
  const entry = ITEM_CLASSES[code];
  await db
    .insert(rateCardClasses)
    .values({
      rateCardId: card.id,
      code,
      label: entry.label,
      cpcb: entry.cpcb,
      handlingFeePaise: Math.round(entry.handlingFee * 100),
      eprCreditPaise: Math.round(entry.eprCreditInr * 100),
      displayOrder: index,
    })
    .onConflictDoUpdate({
      target: [rateCardClasses.rateCardId, rateCardClasses.code],
      set: {
        label: entry.label,
        cpcb: entry.cpcb,
        handlingFeePaise: Math.round(entry.handlingFee * 100),
        eprCreditPaise: Math.round(entry.eprCreditInr * 100),
        displayOrder: index,
      },
    });
}

await db
  .delete(rateCardClasses)
  .where(
    and(
      eq(rateCardClasses.rateCardId, card.id),
      notInArray(rateCardClasses.code, [...itemClassCodes]),
    ),
  );

console.log(
  `Wrote ${materialIds.length} material lines and ${itemClassCodes.length} item classes for ${CARD_CODE}.`,
);
console.log("Done.");

await closeDatabase();
