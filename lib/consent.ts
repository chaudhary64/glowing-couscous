"use client";

import { useSyncExternalStore } from "react";

/**
 * The visitor's choices about cookies and location, kept in one first-party cookie.
 *
 * The site sets one essential cookie of its own, the sign-in session
 * (`ecoepr.session`, httpOnly); it is needed to use the app and is not optional. What
 * *is* optional is location: an intake can carry the device's position so it is filed
 * to its district and counted on the hotspot map. A position is personal data (India's
 * DPDP Act, 2023), so it is asked for, recorded as a choice here, and never assumed.
 *
 * - `location: true`  — the intake screen captures the position as it opens. The
 *   browser still asks its own permission once; after that it remembers.
 * - `location: false` — never captured automatically; the intake asks once before
 *   sending, and the collector can always add it by hand.
 *
 * Stored as `ecoepr.consent`, `SameSite=Lax`, `Secure` on https, for a year. Read on
 * the client only, through a store with a server snapshot of "unknown", so server HTML
 * never depends on it and hydration never mismatches.
 */

export interface Consent {
  /** Version of the notice the choice was made against. */
  v: 1;
  location: boolean;
  /** ISO date the choice was made. */
  at: string;
}

const NAME = "ecoepr.consent";
const EVENT = "ecoepr:consent";
const YEAR_S = 365 * 24 * 60 * 60;

function parse(): Consent | null {
  const raw = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${NAME}=`))
    ?.slice(NAME.length + 1);
  if (!raw) return null;
  try {
    const value = JSON.parse(decodeURIComponent(raw)) as Partial<Consent>;
    return value.v === 1 && typeof value.location === "boolean" && typeof value.at === "string" ? (value as Consent) : null;
  } catch {
    return null;
  }
}

export function saveConsent(location: boolean): Consent {
  const consent: Consent = { v: 1, location, at: new Date().toISOString() };
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${NAME}=${encodeURIComponent(JSON.stringify(consent))}; Path=/; Max-Age=${YEAR_S}; SameSite=Lax${secure}`;
  window.dispatchEvent(new Event(EVENT));
  return consent;
}

// The snapshot must be referentially stable between changes, so it is cached by the
// raw cookie string it was parsed from.
let cachedRaw: string | undefined;
let cached: Consent | null = null;
function snapshot(): Consent | null {
  const raw = document.cookie;
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cached = parse();
  }
  return cached;
}

function subscribe(notify: () => void) {
  window.addEventListener(EVENT, notify);
  return () => window.removeEventListener(EVENT, notify);
}

/** `undefined` while unknown (on the server, before hydration); `null` when not chosen yet. */
export function useConsent(): Consent | null | undefined {
  return useSyncExternalStore<Consent | null | undefined>(subscribe, snapshot, () => undefined);
}
