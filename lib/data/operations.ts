/*
  This file used to carry the whole logistics story: a five-person collector roster with
  invented credit balances, six invented loads with invented credit notes, and four
  facilities with the same CPCB numbers as `aws/pickup/catalogue.mjs`.

  All three are gone. `/collectors`, `/pickups`, `/recyclers` and the dashboard read the
  smart-pickup service instead, through `lib/pickup/directory.ts` — a name, a licence
  number or a credit balance that exists in two places is one that can disagree with
  itself, and the one that counts is the row the service holds.

  What is left is the public landing page's summary figures, which no working screen
  reads.
*/

/**
 * The landing page's headline logistics figures.
 *
 * Authored, and deliberately the only thing left in this file: the public page makes a
 * claim about scale rather than reporting a live one. Nothing on a working screen imports
 * this, so it cannot contradict a screen that counts — and if it ever appears on one, it
 * needs a writer first.
 */
export const logisticsStats = {
  openPickups: 23,
  hazardousShare: 0.41,
  medianSettleHours: 5.2,
  creditsIssuedInr: 113050,
  notesIssued: 806,
  unlicensedDisposalsBlocked: 12,
};
