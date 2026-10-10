/** Formatting helpers shared by every screen, so numbers read identically. */

const inr = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});

const inrCompact = new Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** ₹1,24,500 — Indian digit grouping, no decimals. */
export function formatInr(value: number): string {
  return `₹${inr.format(value)}`;
}

/** ₹1.2L — for headline figures where column width matters. */
export function formatInrCompact(value: number): string {
  return `₹${inrCompact.format(value)}`;
}

/** 412 g / 3.4 kg — scrap is weighed in grams but read in kilograms. */
export function formatMass(grams: number): string {
  if (grams >= 1000) {
    return `${(grams / 1000).toFixed(1)} kg`;
  }
  // Sub-gram masses are the precious-metal lines — gold and palladium plating is
  // fractions of a gram. Rounding those to a whole gram printed "0 g" beside a
  // five-figure value, which reads as a broken scale rather than a thin yield.
  if (grams > 0 && grams < 1) {
    return `${grams.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} g`;
  }
  return `${Math.round(grams).toLocaleString("en-IN")} g`;
}

export function formatTonnes(tonnes: number): string {
  return `${tonnes.toLocaleString("en-IN")} t`;
}

export function formatPct(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** 0.94 → "94%" for confidence chips. */
export function formatConfidence(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

export function formatSigned(value: number): string {
  const sign = value >= 0 ? "+" : "−";
  return `${sign}${inr.format(Math.abs(value))}`;
}

/** Per-kilogram rate, the unit a kabadiwala actually quotes. */
export function formatRate(perKg: number): string {
  return `₹${inr.format(perKg)}/kg`;
}

export function lineValue(massGrams: number, ratePerKg: number): number {
  return Math.round((massGrams / 1000) * ratePerKg);
}

/**
 * Pulls the clock time out of a fixture timestamp such as
 * "09 Oct 2026, 14:19 IST" so operator screens can show a narrow time column
 * without depending on the exact string shape. Falls back to the input.
 */
export function formatTimeOfDay(timestamp: string): string {
  const match = timestamp.match(/\b\d{2}:\d{2}\b/);
  return match ? match[0] : timestamp;
}

/**
 * An ISO timestamp as an operator reads it: "09 Oct 2026, 14:19".
 *
 * Distinct from `formatTimeOfDay`, which scrapes a clock time out of the pre-formatted
 * strings the fixtures carry. This is for the timestamps a query returns, which are ISO
 * and would otherwise print as a machine string in a narrow column. No zone suffix is
 * added: the reader is shown their own clock, and claiming "IST" over a value the server
 * formatted in another zone would be the more confident lie.
 */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
  const clock = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return `${day}, ${clock}`;
}

/**
 * An instant as the fixtures spell one: "09 Nov 2026, 23:59 IST".
 *
 * The rate card's own expiry is written that way, and a row stores the instant rather
 * than the string — so this is the inverse of `parseIstStamp` and the pair has to
 * round-trip exactly, or a stored rate-card expiry would read back as a different
 * moment from the one the card published.
 */
export function formatIstStamp(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return typeof iso === "string" ? iso : "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")} IST`;
}

/**
 * The reverse of `formatIstStamp`: "09 Nov 2026, 23:59 IST" as an instant.
 *
 * Returns null rather than guessing when the string is not that shape, because the
 * only caller stores the answer in a `timestamptz` and a wrong instant on a quote
 * expiry is worse than a null the screen renders as "no expiry".
 */
export function parseIstStamp(text: string): Date | null {
  const match = text.trim().match(/^(\d{2}) ([A-Za-z]{3}) (\d{4}), (\d{2}):(\d{2}) IST$/);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const monthIndex = months.indexOf(month);
  if (monthIndex === -1) return null;
  // IST is a fixed +05:30 — no daylight saving, which is why this is arithmetic and
  // not a timezone database lookup.
  const utcMillis = Date.UTC(Number(year), monthIndex, Number(day), Number(hour), Number(minute));
  return new Date(utcMillis - 5.5 * 60 * 60 * 1000);
}

/**
 * Bytes as a person reads them, for evidence whose exact size nothing acts on.
 *
 * The binary units are deliberate: the archive stores what S3 stored, and a screen that
 * quietly switched to decimal MB would disagree with every other tool looking at the
 * same object.
 */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
