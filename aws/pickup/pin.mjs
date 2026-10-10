/**
 * The handoff PIN: the proof that the load in front of the recycler is the load the
 * collector's phone routed.
 *
 * Settlement already prices the load from the weighed mass and the catalogue, so a
 * caller can never state its own rupee figure. What it could still do is settle a load
 * that never reached the gate — an operator typing a pickup id from a list. The PIN
 * closes that: it is shown once, on the collector's phone, and the recycler can only
 * settle by reading it off that screen.
 *
 * Three rules, each with a reason:
 *
 *   **Random, from the CSPRNG.** `crypto.randomInt`, not `Math.random`: the PIN is the
 *   whole secret, and a predictable generator makes the next one guessable.
 *
 *   **Five attempts, then locked.** Four digits is 10,000 possibilities, which is not a
 *   secret against an unlimited online guesser. The attempt counter is what makes it
 *   one — 5 in 10,000 is the most a guesser gets before the load needs a fresh PIN from
 *   the phone.
 *
 *   **Fifteen minutes, then expired.** A PIN is for a handoff in progress, not a
 *   standing credential; a screenshot from this morning should not settle a load this
 *   afternoon.
 *
 * Only a hash is stored. With a 10,000-value space that is not protection against
 * someone who can read the table — they could hash every PIN in a millisecond — and it
 * is not claimed to be. It keeps the PIN out of every read path by construction: `view`
 * strips `pinHash`, and there is no plain value anywhere to leak into a log or a GET.
 */
import { createHash, randomInt, timingSafeEqual } from "node:crypto";

export const PIN_LENGTH = 4;
export const PIN_MAX_ATTEMPTS = 5;
export const PIN_TTL_MS = 15 * 60 * 1000;

const PIN_PATTERN = /^\d{4}$/;

export function isWellFormedPin(value) {
  return typeof value === "string" && PIN_PATTERN.test(value);
}

/** `0000`–`9999`, uniformly. Leading zeros are kept: `0427` is a PIN, `427` is not. */
export function generatePin() {
  return String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, "0");
}

/**
 * Bound to the pickup id, so the same four digits on two loads hash differently and a
 * hash copied from one item proves nothing about another.
 */
export function hashPin(pickupId, pin) {
  return createHash("sha256").update(`ecoepr-handoff:${pickupId}:${pin}`).digest("hex");
}

export function pinMatches(pickupId, pin, storedHash) {
  if (!isWellFormedPin(pin) || typeof storedHash !== "string") return false;
  const candidate = Buffer.from(hashPin(pickupId, pin), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

/**
 * The attributes a freshly issued PIN writes onto the pickup. A reissue writes the same
 * set, which is what resets the counter and the clock together.
 */
export function issuePin(pickupId, now = new Date()) {
  const pin = generatePin();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + PIN_TTL_MS).toISOString();
  return {
    pin,
    attributes: {
      pinHash: hashPin(pickupId, pin),
      pinIssuedAt: issuedAt,
      pinExpiresAt: expiresAt,
      pinAttempts: 0,
    },
  };
}

/** Where a pickup's PIN stands, for the handler's refusal and for the phone's screen. */
export function pinState(pickup, now = new Date()) {
  const attempts = Number(pickup?.pinAttempts ?? 0);
  const expiresAt = pickup?.pinExpiresAt ?? null;
  return {
    issued: typeof pickup?.pinHash === "string",
    attempts,
    attemptsRemaining: Math.max(0, PIN_MAX_ATTEMPTS - attempts),
    locked: attempts >= PIN_MAX_ATTEMPTS,
    expired: expiresAt ? now.getTime() >= Date.parse(expiresAt) : false,
    expiresAt,
  };
}
