import { areaByCode } from "@/lib/geo/areas";
import { listLocatedItems } from "@/lib/records/queues";
import type { StoredItem } from "@/lib/types";

/**
 * The load the collector's phone hands over, read from the record.
 *
 * The handoff screens used to be demonstrated on `DEMO_LOAD`, a constant typed into the
 * repository: the same two inverter batteries every take, never a row. That is a coherent
 * demo and a dishonest screen — the phone said "today's load" about a value no one had
 * ever recorded. There is no separate "load" table to read instead: `POST /pickups` mints
 * a load when the button is pressed, so the thing the button routes has to come from
 * somewhere real before it exists. It comes from here.
 *
 * The source is the newest **cleared** item the router can route: the gatekeeper has
 * verified it, so a credit is genuinely owed on it, and it is the step immediately before
 * routing. The stream the pickup service routes on is derived from the item's class, the
 * mass is the assayed mass, the hazards are the notes a recycler must be told, and the
 * ward is the one the submission was geotagged in. Nothing is invented to fill a gap: an
 * item with no class the service knows, no mass, or no location is skipped, and this says
 * which one failed rather than fabricating the missing half.
 *
 * "The newest the router can route" rather than simply "the newest cleared" is a real
 * distinction, not a convenience: a collector who declined to share a location leaves a
 * cleared item with no city, and the router needs one to pick a licensed destination. The
 * next cleared item that has one is the honest load to hand over.
 */

/** A load, shaped the way the collector's phone and the handoff button need it. */
export interface HandoffLoad {
  /** `items.code` — the id the priced result carries. */
  itemCode: string;
  label: string;
  /** The pickup catalogue's stream code, e.g. `li-ion`. */
  stream: string;
  streamLabel: string;
  declaredMassG: number;
  hazardNotes: string[];
  /** The collector on the item, or `unattributed` when the column is null. */
  collectorId: string;
  collectorName: string | null;
  city: string;
  wardCode: string | null;
}

export interface HandoffLoadRead {
  /** False when there is no `DATABASE_URL`: no item can be read to hand over. */
  configured: boolean;
  /** Set when the database was configured and the read failed. Never thrown. */
  error: string | null;
  load: HandoffLoad | null;
  /** Why there is no load, when there is none — a sentence a screen can show verbatim. */
  reason: string | null;
}

/**
 * The item class to the waste stream the pickup catalogue routes on.
 *
 * The two runtimes keep separate vocabularies on purpose — `lib/data/rate-card.ts` prices
 * an item into classes (`board_it`), `aws/pickup/catalogue.mjs` routes streams (`boards`)
 * — and this is the one join between them, written from the class labels the record
 * stores as `items.device_category`. A class that is not here is not routable, and says so,
 * rather than being sent down a stream that might not be licensed for it.
 */
const CATEGORY_STREAM: Record<string, { code: string; label: string }> = {
  "IT & telecom board assembly": { code: "boards", label: "PCB & board assemblies" },
  "Loose board scrap": { code: "boards", label: "PCB & board assemblies" },
  "Lithium-ion battery pack": { code: "li-ion", label: "Lithium-ion packs" },
  "CRT / large display": { code: "crt-glass", label: "CRT / leaded funnel glass" },
  "Large IT equipment": { code: "it-equipment", label: "IT & telecom equipment" },
  "Large appliance": { code: "it-equipment", label: "IT & telecom equipment" },
  "Power supply / component": { code: "it-equipment", label: "IT & telecom equipment" },
  "Small e-waste": { code: "it-equipment", label: "IT & telecom equipment" },
  Handset: { code: "it-equipment", label: "IT & telecom equipment" },
  "Cable / wire scrap": { code: "cables", label: "Cable & wire scrap" },
  "Not e-waste": { code: "mixed-plastics", label: "Mixed plastics" },
};

/** The stream a class routes on, or null when the service has no line for it. */
export function streamForCategory(category: string): { code: string; label: string } | null {
  return CATEGORY_STREAM[category] ?? null;
}

/**
 * The city name to route from, from the filing area the submission was geotagged in.
 *
 * A BMC ward is Mumbai; anywhere else the finest area is a district, and its own name is
 * the place the pickup leaves from. The router only uses this to prefer a same-city facility
 * and to estimate distance, so naming the district is honest and a fabricated pilot city
 * would not be.
 */
function cityForWard(code: string): string | null {
  const area = areaByCode(code);
  if (!area) return null;
  return area.kind === "ward" ? (area.region ?? "Mumbai") : area.name;
}

/** Why one cleared item is not a load, or null when it is. */
function unroutableReason(item: StoredItem): string | null {
  if (!streamForCategory(item.category)) {
    return `${item.id} is a ${item.category}, which the pickup catalogue has no stream for`;
  }
  if (item.massGrams < 1) {
    return `${item.id} was assayed at ${item.massGrams} g, so there is nothing to weigh`;
  }
  if (!item.wardCode || !cityForWard(item.wardCode)) {
    return `${item.id} was submitted without a location, and the router needs a city`;
  }
  return null;
}

/** The load one cleared item becomes; only called once `unroutableReason` says null. */
function loadFromItem(item: StoredItem): HandoffLoad | null {
  const stream = streamForCategory(item.category);
  const city = item.wardCode ? cityForWard(item.wardCode) : null;
  if (!stream || !city) return null;
  return {
    itemCode: item.id,
    label: item.label,
    stream: stream.code,
    streamLabel: stream.label,
    declaredMassG: item.massGrams,
    hazardNotes: item.hazards,
    collectorId: item.collectorId ?? "unattributed",
    collectorName: null,
    city,
    wardCode: item.wardCode,
  };
}

export async function readHandoffLoad(): Promise<HandoffLoadRead> {
  // Only located items are read: the city comes from the geotag, and a submission made
  // with no fix is not a routable load. Bounded like every other read here; when the
  // newest located cleared item stops being in the first page this becomes a narrower query.
  const result = await listLocatedItems(50);
  if (!result.configured) {
    return {
      configured: false,
      error: null,
      load: null,
      reason:
        "The records database is not connected, so no cleared item can be read to hand over.",
    };
  }
  if (result.error) {
    return {
      configured: true,
      error: result.error,
      load: null,
      reason: null,
    };
  }

  const cleared = result.rows.filter((row) => row.verdict === "verified");
  if (cleared.length === 0) {
    return {
      configured: true,
      error: null,
      load: null,
      reason:
        "No item has been cleared by the gatekeeper yet, so there is no load to hand over. Price a submission on the intake screen first.",
    };
  }

  let firstFailure: string | null = null;
  for (const item of cleared) {
    const failure = unroutableReason(item);
    if (failure) {
      firstFailure ??= failure;
      continue;
    }
    const load = loadFromItem(item);
    if (load) return { configured: true, error: null, reason: null, load };
  }

  return {
    configured: true,
    error: null,
    load: null,
    reason: `None of the ${cleared.length} cleared items on file can be routed yet. The newest one fails because ${firstFailure}.`,
  };
}
