import type { Scope } from "@/lib/auth/scope";
import { pickupApiConfigured, requestPickupApi } from "@/lib/pickup/api";
import { isApiError, type PickupEvent, type PickupView } from "@/lib/pickup/types";
import { COLLECTOR_NOT_LINKED, collectorIdFor } from "@/lib/records/scope";

/**
 * Reading the smart-pickup service from a page.
 *
 * The two screens that used to render `lib/data/operations.ts` — `/recyclers` and
 * `/pickups` — are reading the service that actually holds this data: the catalogue
 * `scripts/pickup-seed.mjs` writes into DynamoDB, and the loads `POST /pickups` really
 * creates. Until this file existed, the directory and the board were hand-authored
 * copies of those rows, which is a copy that can only ever drift.
 *
 * Four rules, copied from `lib/records/queues.ts` and `lib/s3/media-assets.ts`, because a
 * read that reports its own state is what keeps a demo honest:
 *
 * 1. **An unconfigured API is not an error.** Every read answers with `configured: false`
 *    and an empty `rows`, and the screen can say the service is off rather than drawing
 *    an empty directory that looks like a registry with nothing in it.
 *
 * 2. **A failed read is a sentence, never a thrown page.** The API's own problem message
 *    is passed through when there is one, logged, and returned in `error`.
 *
 * 3. **Nothing is invented.** A field the API does not return is `null` or empty, never a
 *    plausible default — a capacity of 0 that reads as a real ceiling is worse than no
 *    capacity at all.
 *
 * 4. **The per-stream authorisation is read, not guessed.** Which streams a facility
 *    accepts, and whether it is authorised for a hazardous one, comes from the
 *    authorisation rows the router itself reads. It is deliberately not derived by
 *    matching stream names against a list in the UI, which is how the old `lib/streams.ts`
 *    helper worked and how it could disagree with the router.
 */

export interface PickupRead<T> {
  configured: boolean;
  error: string | null;
  rows: T[];
}

/** What one facility says about one stream, from its authorisation row. */
export interface DestinationStream {
  /** The catalogue's code, e.g. `lead-acid`. */
  code: string;
  /** The catalogue's label, e.g. `Lead-acid batteries`. */
  label: string;
  /** The catalogue's hazard class — a property of the material, not of the site. */
  hazardous: boolean;
  accepted: boolean;
  hazardousAuthorized: boolean;
  capacityKgPerDay: number;
  /** Declared mass already committed to this facility for this stream today. */
  assignedMassGToday: number;
  /** The stream's own ceiling minus what is assigned — per stream, not per site. */
  remainingKg: number;
  note: string | null;
}

/** A licensed destination, as the directory of record describes it. */
export interface Destination {
  id: string;
  name: string;
  cpcbLicense: string;
  city: string;
  capacityKgPerDay: number;
  slaHours: number | null;
  reuseOnly: boolean;
  active: boolean;
  /** Every stream the catalogue knows, with this facility's answer about each. */
  streams: DestinationStream[];
}

/**
 * Which loads a scope reaches. The service returns every load; the cut is made here, by
 * the same `Scope` the Postgres readers take, so the board and the record agree on whose
 * rows are whose.
 *
 * A Collector's loads are the ones routed with their collector record's id (the handoff
 * routes with `items.collector_id`); an Officer's are the ones routed to their facility.
 * A load carries no brand, so a Viewer's scope reaches none and says why.
 */
type LoadFilter = { kind: "keep"; keep: (load: PickupView) => boolean } | { kind: "refused"; message: string };

const BRAND_HAS_NO_LOADS =
  "A load carries no brand: a brand's claim is on its credit note, not on the load, so no load is in this brand's scope.";

async function loadFilter(scope: Scope): Promise<LoadFilter> {
  switch (scope.kind) {
    case "all":
      return { kind: "keep", keep: () => true };
    case "unresolved":
      return { kind: "refused", message: scope.reason };
    case "brand":
      return { kind: "refused", message: BRAND_HAS_NO_LOADS };
    case "facility":
      return { kind: "keep", keep: (load) => load.facilityId === scope.facilityId };
    case "collector": {
      const collector = await collectorIdFor(scope.userId);
      if (collector.error) return { kind: "refused", message: collector.error };
      if (!collector.id) return { kind: "refused", message: COLLECTOR_NOT_LINKED };
      const id = collector.id;
      return { kind: "keep", keep: (load) => load.collectorId === id };
    }
  }
}

/** The service's own page size; a scoped read asks for all of it and cuts afterwards. */
const BOARD_CEILING = 100;

function notConfigured<T>(): PickupRead<T> {
  return { configured: false, error: null, rows: [] };
}

function failed<T>(what: string, error: unknown): PickupRead<T> {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .trim();
  console.error(`[pickup] reading ${what} failed`, message);
  return { configured: true, error: message.slice(0, 200), rows: [] };
}

/** The API's own problem message when it sent one, so the screen shows its sentence. */
function problemMessage(body: unknown): string {
  if (isApiError(body)) return body.error.message;
  return "The smart-pickup service refused the read.";
}

/* ------------------------------------------------------------------- shapes */

interface StreamRow {
  code: string;
  label: string;
  hazardous: boolean;
}

interface FacilityRow {
  facilityId: string;
  name: string;
  cpcbLicense: string;
  city: string;
  capacityKgPerDay: number;
  slaHours: number | null;
  reuseOnly: boolean;
  active: boolean;
}

interface DestinationRow {
  recyclerId: string;
  accepted: boolean;
  hazardousAuthorized: boolean;
  capacityKgPerDay: number;
  assignedMassGToday: number;
  remainingKg: number;
  note: string | null;
}

/* -------------------------------------------------------------------- reads */

/**
 * The stream catalogue. Read first by the directory, because a facility's authorisations
 * are keyed by stream code and the labels come from here rather than from the
 * authorisation snapshot.
 */
async function readStreams(): Promise<StreamRow[]> {
  const result = await requestPickupApi("GET", "/streams");
  if (result?.status !== 200) throw new Error(problemMessage(result?.body));
  const body = result.body as { streams?: StreamRow[] } | null;
  return body?.streams ?? [];
}

/** The facilities as they are registered — the directory of record, not an auth snapshot. */
async function readFacilities(): Promise<FacilityRow[]> {
  const result = await requestPickupApi("GET", "/recyclers");
  if (result?.status !== 200) throw new Error(problemMessage(result?.body));
  const body = result.body as { facilities?: FacilityRow[] } | null;
  return body?.facilities ?? [];
}

/**
 * Who may take one stream, with the day's remaining capacity. This is the same read the
 * compliance officer's question is answered from, so the page and the router cannot
 * disagree about whether a facility is authorised for a hazardous stream.
 */
async function readDestinationsForStream(stream: string): Promise<DestinationRow[]> {
  const result = await requestPickupApi("GET", "/recyclers", { query: { stream } });
  if (result?.status !== 200) throw new Error(problemMessage(result?.body));
  const body = result.body as { destinations?: DestinationRow[] } | null;
  return body?.destinations ?? [];
}

/**
 * The directory: every licensed facility, with what each is authorised to take.
 *
 * One read for the catalogue, one for the registry, and one per stream for the
 * authorisations — issued together rather than in sequence, because the per-stream reads
 * do not depend on each other and a page that waited on eight of them one at a time would
 * be slow for no reason.
 *
 * A facility is drawn even when it has no authorisation row for a stream: that is the
 * useful fact — it is registered but not authorised — and dropping it would make an
 * unlicensed site look like a site that does not exist.
 */
/**
 * Which facilities a scope reaches in the directory. The directory is the platform's
 * catalogue, so `all` reads it whole; an Officer reads their own facility's capacity and
 * nobody else's; the other scopes cannot open `/recyclers` and are refused here too.
 */
function destinationFilter(scope: Scope): { keep: (d: Destination) => boolean } | { refused: string } {
  if (scope.kind === "all") return { keep: () => true };
  if (scope.kind === "facility") return { keep: (destination) => destination.id === scope.facilityId };
  if (scope.kind === "unresolved") return { refused: scope.reason };
  return { refused: "The recycler directory is read by an Officer for their own facility, or by an Admin; this account's scope reaches none of it." };
}

export async function listDestinations(scope: Scope): Promise<PickupRead<Destination>> {
  const filter = destinationFilter(scope);
  if ("refused" in filter) {
    return pickupApiConfigured() ? { configured: true, error: filter.refused, rows: [] } : notConfigured<Destination>();
  }
  if (!pickupApiConfigured()) return notConfigured<Destination>();
  try {
    const [streams, facilities] = await Promise.all([
      readStreams(),
      readFacilities(),
    ]);
    const authorisations = await Promise.all(
      streams.map((stream) => readDestinationsForStream(stream.code)),
    );

    const byId = new Map<string, Destination>();
    for (const facility of facilities) {
      byId.set(facility.facilityId, {
        id: facility.facilityId,
        name: facility.name,
        cpcbLicense: facility.cpcbLicense,
        city: facility.city,
        capacityKgPerDay: facility.capacityKgPerDay,
        slaHours: facility.slaHours,
        reuseOnly: facility.reuseOnly,
        active: facility.active,
        streams: [],
      });
    }

    streams.forEach((stream, index) => {
      for (const row of authorisations[index]) {
        const destination = byId.get(row.recyclerId);
        // An authorisation for a facility the directory does not list is a table that
        // disagrees with itself. Skip it rather than invent a facility to hang it on.
        if (!destination) continue;
        destination.streams.push({
          code: stream.code,
          label: stream.label,
          hazardous: stream.hazardous,
          accepted: row.accepted === true,
          hazardousAuthorized: row.hazardousAuthorized === true,
          capacityKgPerDay: Number(row.capacityKgPerDay ?? 0),
          assignedMassGToday: Number(row.assignedMassGToday ?? 0),
          remainingKg: Number(row.remainingKg ?? 0),
          note: row.note ?? null,
        });
      }
    });

    const rows = [...byId.values()].filter(filter.keep).sort((a, b) => a.id.localeCompare(b.id));
    for (const destination of rows) {
      destination.streams.sort((a, b) => a.label.localeCompare(b.label));
    }
    return { configured: true, error: null, rows };
  } catch (error) {
    return failed("the recycler directory", error);
  }
}

/**
 * The load board: every load the service has routed, newest first.
 *
 * A load that has not settled carries its handoff state (`handoff`), which is the
 * question an operator asks of an open row; the PIN itself is never in a read.
 */
export async function listLoads(scope: Scope, limit = 25): Promise<PickupRead<PickupView>> {
  if (!pickupApiConfigured()) return notConfigured<PickupView>();
  try {
    const filter = await loadFilter(scope);
    if (filter.kind === "refused") return { configured: true, error: filter.message, rows: [] };
    // Cutting after the read means a scoped board asks for the whole page, or a collector
    // with three loads behind twenty-five of someone else's would see none of them.
    const unscoped = scope.kind === "all";
    const result = await requestPickupApi("GET", "/pickups", {
      query: { limit: String(unscoped ? limit : BOARD_CEILING) },
    });
    if (result?.status !== 200) {
      return {
        configured: true,
        error: problemMessage(result?.body),
        rows: [],
      };
    }
    const body = result.body as { pickups?: PickupView[] } | null;
    const rows = (body?.pickups ?? []).filter(filter.keep).slice(0, limit);
    return { configured: true, error: null, rows };
  } catch (error) {
    return failed("the load board", error);
  }
}

/**
 * One collector's activity, counted from the loads they asked for.
 *
 * This is the part of a roster that can be real. Nothing provisions a collector record —
 * no name, no tier, no languages — so those columns are absent rather than invented. What
 * the service does record is who asked for each route, and that answers the questions an
 * operator actually has: how many loads, how many still open, how much settled, and where.
 */
export interface CollectorActivity {
  collectorId: string;
  loads: number;
  open: number;
  hazardous: number;
  notes: number;
  settledInr: number;
  cities: string[];
  streams: string[];
  latestAt: string | null;
}

/**
 * The loads, grouped by the collector who asked for them.
 *
 * Summed here rather than in the service because the API returns loads and nothing else;
 * a second read model would be a second thing to keep in step. The board read is capped
 * at 100 loads, which is the API's own ceiling — a pilot number, and the place to move
 * the grouping into a query when it stops being one.
 */
export async function listCollectorActivity(
  scope: Scope,
  limit = 25,
): Promise<PickupRead<CollectorActivity>> {
  const board = await listLoads(scope, BOARD_CEILING);
  if (!board.configured) return notConfigured<CollectorActivity>();
  if (board.error) {
    return { configured: true, error: board.error, rows: [] };
  }

  const byCollector = new Map<string, CollectorActivity>();
  for (const load of board.rows) {
    // A load with no collector id is still a load. Naming the group is more honest than
    // dropping the row, which would make the totals disagree with the board.
    const id = load.collectorId || "unattributed";
    const row =
      byCollector.get(id) ??
      ({
        collectorId: id,
        loads: 0,
        open: 0,
        hazardous: 0,
        notes: 0,
        settledInr: 0,
        cities: [],
        streams: [],
        latestAt: null,
      } satisfies CollectorActivity);

    row.loads += 1;
    if (load.status !== "settled") row.open += 1;
    if (load.hazardous) row.hazardous += 1;
    if (load.creditNoteId) {
      row.notes += 1;
      row.settledInr += Number(load.creditNoteAmountPaise ?? 0) / 100;
    }
    if (load.city && !row.cities.includes(load.city)) row.cities.push(load.city);
    if (load.streamLabel && !row.streams.includes(load.streamLabel)) {
      row.streams.push(load.streamLabel);
    }
    if (!row.latestAt || load.requestedAt > row.latestAt) {
      row.latestAt = load.requestedAt;
    }
    byCollector.set(id, row);
  }

  const rows = [...byCollector.values()]
    .sort(
      (a, b) =>
        b.settledInr - a.settledInr ||
        b.loads - a.loads ||
        a.collectorId.localeCompare(b.collectorId),
    )
    .slice(0, limit);

  return { configured: true, error: null, rows };
}

/**
 * A load's audit trail.
 *
 * Every step the service takes writes an event in the same transaction as the state
 * change it describes, so this is the load's history rather than a reconstruction of it:
 * routed, PIN issued, every wrong guess, settled, paid. A screen can render the trail
 * without inventing the steps between them.
 */
export async function listLoadEvents(
  pickupId: string,
): Promise<PickupRead<PickupEvent>> {
  if (!pickupApiConfigured()) return notConfigured<PickupEvent>();
  try {
    const result = await requestPickupApi("GET", `/pickups/${pickupId}/events`);
    if (result?.status !== 200) {
      return { configured: true, error: problemMessage(result?.body), rows: [] };
    }
    const body = result.body as { events?: PickupEvent[] } | null;
    return { configured: true, error: null, rows: body?.events ?? [] };
  } catch (error) {
    return failed("a load's audit trail", error);
  }
}

/**
 * One load with its credit note, for a screen that opens a single row. A load outside the
 * caller's scope is answered the way a missing one is, so an id cannot be used to learn
 * that someone else's load exists.
 */
export async function getLoad(
  scope: Scope,
  pickupId: string,
): Promise<{ configured: boolean; error: string | null; load: PickupView | null }> {
  if (!pickupApiConfigured()) return { configured: false, error: null, load: null };
  try {
    const filter = await loadFilter(scope);
    if (filter.kind === "refused") return { configured: true, error: filter.message, load: null };
    const result = await requestPickupApi("GET", `/pickups/${pickupId}`);
    if (result?.status !== 200) {
      return { configured: true, error: problemMessage(result?.body), load: null };
    }
    const body = result.body as { pickup?: PickupView } | null;
    const load = body?.pickup ?? null;
    if (load && !filter.keep(load)) {
      return { configured: true, error: "No load with that id is in this account's scope.", load: null };
    }
    return { configured: true, error: null, load };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[pickup] reading one load failed", message);
    return { configured: true, error: message.slice(0, 200), load: null };
  }
}
