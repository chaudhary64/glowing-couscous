/**
 * The catalogue the routing decision is made against: every material stream the
 * platform knows, and every facility that will take one.
 *
 * This file is the single source of truth for two different consumers, which is why it
 * lives beside the Lambda rather than inside it:
 *
 *   `scripts/pickup-seed.mjs` writes it into DynamoDB, once, at setup time;
 *   `scripts/pickup-check.mjs` reads the same values to check the arithmetic the API
 *     returned, so the check cannot agree with the API by copying its bug.
 *
 * The Lambda reads DynamoDB, never this file. A catalogue that could only change by
 * redeploying the function would make "this facility's licence lapsed" an engineering
 * task, and the whole point of putting the directory in a table is that it is data.
 *
 * ## Two decisions worth stating
 *
 * **Hazard is a property of the stream, never of the request.** `waste_streams.hazardous`
 * in `db/schema/network.ts` says the same thing: a caller cannot declare a lithium pack
 * non-hazardous, because the caller is the party with an incentive to. The request names
 * a stream; the catalogue decides what that means.
 *
 * **A facility is not authorised in general — it is authorised for a stream.** That is
 * `facility_streams` in the SQL schema, and it is `hazardousAuthorized` here: RX-01 may
 * take boards, but its board line is not licensed for lead-solder residue, so a
 * hazardous board load must not stop there even though the stream is "accepted".
 *
 * The rates are a demo card, like `lib/data/rate-card.ts`, and are labelled as such in
 * the API response. They are deliberately *not* imported from the TypeScript rate card:
 * see `docs/smart-pickup-digital-credit.md` for why the two runtimes each carry a card
 * and what would consolidate them.
 */

/** Rupee figures are integers in paise, like every money column in the SQL schema. */
export const CURRENCY = "INR";

export const RATE_BASIS =
  "EcoEPR smart-pickup card · IMD benchmark, 2026-Q3 · Mumbai zone (demo)";

/**
 * Material streams. `ratePaisePerKg` is the gross scrap value of the stream and
 * `handlingPaisePerKg` is the disposal cost of taking it — a hazardous stream can be
 * worth less than it costs to handle, and the collector is never shown a negative
 * offer, so the shortfall floors at zero where the money is computed.
 */
export const STREAMS = [
  {
    code: "boards",
    label: "PCB & board assemblies",
    labelHi: "बोर्ड",
    hazardous: true,
    ratePaisePerKg: 4200,
    handlingPaisePerKg: 800,
  },
  {
    code: "li-ion",
    label: "Lithium-ion packs",
    labelHi: "लिथियम बैटरी",
    hazardous: true,
    ratePaisePerKg: 900,
    handlingPaisePerKg: 500,
  },
  {
    code: "lead-acid",
    label: "Lead-acid batteries",
    labelHi: "लेड बैटरी",
    hazardous: true,
    ratePaisePerKg: 1800,
    handlingPaisePerKg: 600,
  },
  {
    code: "crt-glass",
    label: "CRT / leaded funnel glass",
    labelHi: "सीआरटी ग्लास",
    hazardous: true,
    ratePaisePerKg: 0,
    handlingPaisePerKg: 900,
  },
  {
    code: "it-equipment",
    label: "IT & telecom equipment",
    labelHi: "कंप्यूटर सामान",
    hazardous: false,
    ratePaisePerKg: 2500,
    handlingPaisePerKg: 300,
  },
  {
    code: "cables",
    label: "Cable & wire scrap",
    labelHi: "तार",
    hazardous: false,
    ratePaisePerKg: 3200,
    handlingPaisePerKg: 200,
  },
  {
    code: "working-devices",
    label: "Working devices (reuse)",
    labelHi: "चालू फोन",
    hazardous: false,
    ratePaisePerKg: 0,
    handlingPaisePerKg: 0,
  },
  {
    code: "mixed-plastics",
    label: "Mixed plastics",
    labelHi: "प्लास्टिक",
    hazardous: false,
    ratePaisePerKg: 1500,
    handlingPaisePerKg: 0,
  },
];

/**
 * The licensed facilities, with the streams each will actually accept.
 *
 * These are the four recyclers the product screens render from
 * `lib/data/operations.ts`, filled out with the per-stream authorisation the SQL
 * schema models and the fixtures do not. `reuseOnly` is RX-04: a reuse operator takes
 * working devices and pays a revenue share, which is not a scrap credit and is not a
 * recycling destination — so it is refused for every recycling stream by rule R-4.
 */
export const FACILITIES = [
  {
    id: "RX-01",
    name: "EcoRecycle Mumbai",
    cpcbLicense: "CPCB/EW/2019/MH/0442",
    city: "Mumbai",
    capacityKgPerDay: 12000,
    slaHours: 24,
    reuseOnly: false,
    active: true,
    streams: [
      {
        stream: "boards",
        accepted: true,
        hazardousAuthorized: false,
        note: "Board line holds no lead-solder authorisation",
      },
      { stream: "it-equipment", accepted: true, hazardousAuthorized: false },
      { stream: "cables", accepted: true, hazardousAuthorized: false },
      {
        stream: "li-ion",
        accepted: true,
        hazardousAuthorized: true,
        capacityKgPerDay: 1500,
        note: "One licensed battery bench; the site ceiling is per-stream here",
      },
    ],
  },
  {
    id: "RX-02",
    name: "GreenLoop Battery Line",
    cpcbLicense: "CPCB/EW/2021/MH/1109",
    city: "Navi Mumbai",
    capacityKgPerDay: 4000,
    slaHours: 12,
    reuseOnly: false,
    active: true,
    streams: [
      { stream: "li-ion", accepted: true, hazardousAuthorized: true },
      { stream: "lead-acid", accepted: true, hazardousAuthorized: true },
      {
        stream: "boards",
        accepted: false,
        note: "No board line on site",
      },
    ],
  },
  {
    id: "RX-03",
    name: "Sahyadri Metals (Pune)",
    cpcbLicense: "CPCB/EW/2018/MH/0217",
    city: "Pune",
    capacityKgPerDay: 9000,
    slaHours: 36,
    reuseOnly: false,
    active: true,
    streams: [
      { stream: "boards", accepted: true, hazardousAuthorized: true },
      { stream: "cables", accepted: true, hazardousAuthorized: false },
      { stream: "crt-glass", accepted: true, hazardousAuthorized: true },
    ],
  },
  {
    id: "RX-04",
    name: "Reuse Partner · 2G Refurb",
    cpcbLicense: "— (reuse, not recycling)",
    city: "Mumbai",
    capacityKgPerDay: 2000,
    slaHours: 48,
    reuseOnly: true,
    active: true,
    streams: [
      {
        stream: "working-devices",
        accepted: true,
        hazardousAuthorized: false,
        note: "Reuse operator: pays a revenue share, not a scrap credit",
      },
    ],
  },
];

/**
 * Straight-line distance between the pilot cities, in kilometres, for the ETA the
 * timeline shows. A real route would come from a directions service; this is an
 * estimate and the API labels it as one. Same-city hops are derived from the item so
 * two identical submissions produce the same number.
 */
export const CITY_DISTANCE_KM = {
  "Mumbai|Navi Mumbai": 22,
  "Mumbai|Pune": 148,
  "Mumbai|Thane": 28,
  "Navi Mumbai|Pune": 120,
  "Navi Mumbai|Thane": 16,
  "Pune|Thane": 140,
};

/** The pilot cities, used to refuse a typo rather than invent a distance for it. */
export const PILOT_CITIES = ["Mumbai", "Navi Mumbai", "Thane", "Pune"];

/** Assumed van speed for the ETA, km/h. Slow on purpose: this is a laden pickup. */
export const VAN_KMH = 28;

/**
 * FNV-1a, 32-bit, rendered as four digits. The same seed always produces the same
 * serial, which is what makes a note id checkable against the audit trail later:
 * `stableSerial` in `lib/data/rate-card.ts` is the same function for the same reason.
 */
export function stableSerial(seed) {
  let hash = 2166136261;
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return String((hash >>> 0) % 10000).padStart(4, "0");
}

/**
 * The distance the route label and ETA are built from. Same city is a short hop
 * derived from the item code; a pair of pilot cities is the table above; anything else
 * is the fallback, and the response says `distanceIsEstimate: true` either way.
 */
export function estimateDistanceKm(fromCity, toCity, seed) {
  if (fromCity === toCity) return 4 + (Number(stableSerial(seed)) % 9);
  const key = [fromCity, toCity].sort().join("|");
  return CITY_DISTANCE_KM[key] ?? 150;
}

export function estimateEtaMinutes(distanceKm) {
  return Math.max(15, Math.round((distanceKm / VAN_KMH) * 60));
}

/** `R-4 · Pune` — the van round a load was folded into, as the fixtures label it. */
export function routeLabel(city, seed) {
  return `R-${(Number(stableSerial(seed)) % 9) + 1} · ${city}`;
}
