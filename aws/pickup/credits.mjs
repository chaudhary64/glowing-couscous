/**
 * The credit note: what the collector is owed, computed on the server from the
 * catalogue's rate card, and the id the note is filed under.
 *
 * The same rule the valuation pipeline defends, applied one layer down: **the caller
 * never states a rupee figure.** Settlement takes one number from the outside world —
 * the weighed mass at the gate — and every other figure is arithmetic against a rate
 * the platform owns. A request that carried an `amountPaise` would be a request that
 * could pay itself.
 *
 * The arithmetic is kept line by line on the note rather than as a total, because the
 * point of a note is that someone else can add it up:
 *
 *   gross    = ratePaisePerKg    × massG / 1000
 *   handling = handlingPaisePerKg × massG / 1000
 *   amount   = max(0, gross − handling)
 *
 * The floor is real and deliberate, and it matches `priceMaterials` in
 * `lib/data/rate-card.ts`: a hazardous stream can cost more to handle than it is worth
 * — CRT glass is worth nothing and costs ₹9/kg to take — and the collector is never
 * handed a negative offer. The shortfall is the brand's disposal cost, not a debt owed
 * by the person in the lane.
 */

export const MASS_VARIANCE_FLAG = "mass_variance";
export const MASS_VARIANCE_LIMIT_PCT = 25;

/** Paise are integers everywhere in this system; nothing is stored as a float. */
function scaled(perKg, massG) {
  return Math.round((perKg * massG) / 1000);
}

/** Price one weighed load. Pure, so the check script can reproduce it exactly. */
export function priceLoad(stream, massG) {
  const grossPaise = scaled(stream.ratePaisePerKg ?? 0, massG);
  const handlingPaise = scaled(stream.handlingPaisePerKg ?? 0, massG);
  return {
    massG,
    ratePaisePerKg: stream.ratePaisePerKg ?? 0,
    handlingPaisePerKg: stream.handlingPaisePerKg ?? 0,
    grossPaise,
    handlingPaise,
    amountPaise: Math.max(0, grossPaise - handlingPaise),
    rateBasis: stream.rateBasis ?? null,
  };
}

/**
 * `CN-2026-0001` from `PU-2026-0001`. Derived, not random, for one reason: the note id
 * is then a function of the load, so a retried settlement that loses its response
 * cannot mint a second note under a second id — it collides with the first and is
 * reported as the existing one. That is the whole idempotency story, and it is a
 * naming rule rather than a locking mechanism.
 */
export function creditNoteId(pickupId) {
  return `CN-${pickupId.replace(/^PU-/, "")}`;
}

/**
 * The cross-reference the brand's EPR note will be filed under. The EPR note itself —
 * `epr_credit_notes` in the SQL schema — is a separate instrument owned by a separate
 * table and is out of scope here; this string is the join a Composer or an auditor
 * would use, and it is derived from item, stream and facility so the same load always
 * produces the same reference.
 */
export function complianceRef({ itemCode, stream, facilityId, year }) {
  const seed = [itemCode, stream, facilityId].join(":");
  return `EPR-${year}-${serial(seed)}-MH`;
}

/** FNV-1a, same function as `stableSerial` in the catalogue and `lib/data/rate-card.ts`. */
function serial(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return String((hash >>> 0) % 10000).padStart(4, "0");
}

/**
 * Build the note. `declaredMassG` is recorded beside the weighed mass rather than
 * replaced by it: the two numbers disagreeing is the interesting case, and a note that
 * kept only the final figure could not show that it did.
 *
 * A variance beyond 25% does not block the note — the collector was promised an instant
 * receipt — it flags it, so the trail says a human should look rather than the API
 * pretending it did not happen.
 */
export function buildNote({
  pickupId,
  collectorId,
  itemCode,
  stream,
  facilityId,
  facilityName,
  cpcbLicense,
  declaredMassG,
  weighedMassG,
  settledVia,
  issuedAt,
  issuedBy,
  issuedBySub,
}) {
  const priced = priceLoad(stream, weighedMassG);
  const variance =
    declaredMassG > 0
      ? Math.round(((weighedMassG - declaredMassG) / declaredMassG) * 1000) / 10
      : 0;
  const flags = Math.abs(variance) > MASS_VARIANCE_LIMIT_PCT ? [MASS_VARIANCE_FLAG] : [];
  const year = new Date(issuedAt).getUTCFullYear();
  const noteId = creditNoteId(pickupId);

  return {
    noteId,
    type: "credit_note",
    status: "issued",
    currency: "INR",
    pickupId,
    collectorId,
    itemCode,
    stream: stream.code,
    streamLabel: stream.label,
    facilityId,
    facilityName,
    cpcbLicense,
    complianceRef: complianceRef({ itemCode, stream: stream.code, facilityId, year }),
    declaredMassG,
    massG: weighedMassG,
    massVariancePct: variance,
    ...priced,
    flags,
    issuedAt,
    issuedBy,
    // The Cognito subject the token carried, not a body field: a note records who
    // released the money, and that has to be the identity the API actually verified.
    issuedBySub: issuedBySub ?? null,
    settledVia,
    issuedVia: "smart-pickup",
    collectorKey: `COLLECTOR#${collectorId}`,
  };
}
