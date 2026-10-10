/**
 * Every read and write the smart-pickup API makes, in one file.
 *
 * The handler is deliberately kept free of DynamoDB detail: it validates a request,
 * asks the repository a question, and shapes the answer. That split is what lets
 * `scripts/pickup-check.mjs` talk to the same tables through the same module it
 * exercises over HTTP.
 *
 * ## How the three tables are laid out
 *
 * `PICKUP_TABLE_RECYCLERS` — the directory, one table for three kinds of item:
 *
 *   `STREAM#<code>` / `META`                    the catalogue and its rate card
 *   `FACILITY#<id>` / `META`                    the licensed site as it is registered
 *   `FACILITY#<id>` / `STREAM#<code>`           what that site will actually accept
 *
 *   The authorisation item is a *denormalised snapshot* of the facility — name, city,
 *   licence, capacity, SLA — so one Query answers "who may take this stream, and can
 *   they today" without a second round trip per candidate. The snapshot is written by
 *   the seeder, which is the only writer; the `FACILITY#<id>`/`META` item is the
 *   registry of record. Re-running the seeder is therefore the way to change either.
 *
 *   `stream-index` on authorisation items is the routing query.
 *   `catalogue-index` is how the API lists streams and facilities.
 *
 * `PICKUP_TABLE_PICKUPS` — one item per load at `PICKUP#…`/`META`, plus an atomic
 *   counter item per year (`COUNTER#<year>`/`META`) that mints the readable id
 *   (`PU-2026-0001`). A counter rather than a random id because an operator reads these
 *   out loud, and `ADD` on a single item is the cheapest way to keep them unique.
 *
 *   `collector-index` (collectorKey, requestedAt) — a collector's ledger.
 *   `facility-index` (facilityKey, facilityDay) — a facility's day, and the daily
 *   capacity the router subtracts.
 *
 * `PICKUP_TABLE_CREDIT_NOTES` — the collector's note, keyed by note id, with the
 *   pickup id as a GSI so "the note for this load" is one Query.
 */
import {
  deleteItem,
  getItem,
  putItem,
  query,
  transactWrite,
  updateItem,
} from "./dynamo.mjs";

/** Table names are configuration, and the Lambda has no business starting without them. */
export function tables() {
  const names = {
    recyclers: process.env.PICKUP_TABLE_RECYCLERS,
    pickups: process.env.PICKUP_TABLE_PICKUPS,
    creditNotes: process.env.PICKUP_TABLE_CREDIT_NOTES,
  };
  const missing = Object.entries(names)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(
      `Missing table configuration: ${missing
        .map((key) => `PICKUP_TABLE_${key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`)
        .join(", ")}`,
    );
  }
  return names;
}

/* ------------------------------------------------------------------ directory */

export async function getStream(code) {
  return getItem(tables().recyclers, { pk: `STREAM#${code}`, sk: "META" });
}

export async function listStreams() {
  return query(tables().recyclers, {
    index: "catalogue-index",
    keyCondition: "catalogueKey = :kind",
    values: { ":kind": "STREAM" },
  });
}

export async function listFacilities() {
  return query(tables().recyclers, {
    index: "catalogue-index",
    keyCondition: "catalogueKey = :kind",
    values: { ":kind": "FACILITY" },
  });
}

/**
 * Every facility that has an opinion about this stream, accepted or not.
 *
 * The name is aliased because `stream` is a DynamoDB reserved word: used bare in a key
 * condition it is rejected outright with a validation error, which is a server-side
 * failure rather than a routing one, and the fix belongs next to the query rather than
 * in a renamed attribute. `#stream` is the index's hash key, so the alias is the whole
 * condition.
 */
export async function authorizationsForStream(stream) {
  return query(tables().recyclers, {
    index: "stream-index",
    keyCondition: "#stream = :stream",
    names: { "#stream": "stream" },
    values: { ":stream": stream },
  });
}

/* -------------------------------------------------------------------- pickups */

/**
 * The next readable pickup id. `ADD` on a single counter item is atomic, so two
 * concurrent requests cannot mint the same one — and a counter that is only ever
 * incremented never needs a conditional write of its own.
 */
export async function nextPickupId(year) {
  const row = await updateItem(
    tables().pickups,
    { pickupId: `COUNTER#${year}`, sk: "META" },
    { update: "ADD serial :one", values: { ":one": 1 }, returns: "ALL_NEW" },
  );
  const serial = Number(row?.serial ?? 0);
  return { pickupId: `PU-${year}-${String(serial).padStart(4, "0")}`, serial };
}

export async function putPickup(pickup) {
  await putItem(tables().pickups, { ...pickup, sk: "META" }, {
    condition: "attribute_not_exists(pickupId)",
  });
}

export async function getPickup(pickupId) {
  return getItem(tables().pickups, { pickupId, sk: "META" });
}

export async function listPickupsByCollector(collectorId, limit = 25) {
  return query(tables().pickups, {
    index: "collector-index",
    keyCondition: "collectorKey = :key",
    values: { ":key": `COLLECTOR#${collectorId}` },
    forward: false,
    limit,
  });
}

/**
 * How much this facility has already accepted today, which is what "capacity" means
 * here: a licensed daily ceiling minus what is already committed, not a live weighing.
 * Only assignments count — a load that was never routed was never promised to the site.
 */
export async function assignedMassToday(facilityId, day) {
  const rows = await query(tables().pickups, {
    index: "facility-index",
    keyCondition: "facilityKey = :key AND begins_with(facilityDay, :day)",
    values: { ":key": `FACILITY#${facilityId}`, ":day": String(day) },
  });
  return rows.reduce((sum, row) => sum + Number(row.declaredMassG ?? 0), 0);
}

/* --------------------------------------------------------------- credit notes */

/**
 * A note is only ever written by `settle`'s transaction — there is deliberately no
 * standalone "create a note" path, because a note that exists without a settled pickup
 * is the half-state the transaction is there to make impossible.
 */
export async function getCreditNoteByPickup(pickupId) {
  const rows = await query(tables().creditNotes, {
    index: "pickup-index",
    keyCondition: "pickupId = :pickupId",
    values: { ":pickupId": pickupId },
    limit: 1,
  });
  return rows[0] ?? null;
}

/**
 * Settlement: the pickup moves to `settled` and the note is written in one
 * transaction, under conditions that make the pair impossible to duplicate or to
 * half-apply.
 *
 *   `attribute_not_exists(creditNoteId)` on the pickup — one settlement per load.
 *   `attribute_not_exists(noteId)` on the note — one note per settlement.
 *
 * Both conditions are on the same transaction, so a retry of a settlement whose
 * response was lost loses the race once and then reports the existing note instead of
 * minting a second one. `TransactionCanceledException` is the *expected* outcome of
 * that race, not an error, which is why the caller resolves it by reading state.
 *
 * Two operations, two items, one transaction. A `ConditionCheck` on the pickup beside
 * this update would express the same condition twice and DynamoDB refuses the whole
 * request for it — "Transaction request cannot include multiple operations on one
 * item" — so the condition lives on the update, which is where it does the work.
 */
export async function settle({ pickupId, weighedMassG, settledVia, note }) {
  const now = new Date().toISOString();
  await transactWrite([
    {
      kind: "update",
      table: tables().pickups,
      key: { pickupId, sk: "META" },
      update:
        "SET #status = :settled, weighedMassG = :mass, creditNoteId = :noteId, settledAt = :now, settledVia = :via, creditNoteAmountPaise = :amount",
      condition: "attribute_not_exists(creditNoteId)",
      names: { "#status": "status" },
      values: {
        ":settled": "settled",
        ":mass": weighedMassG,
        ":noteId": note.noteId,
        ":now": now,
        ":via": settledVia,
        ":amount": note.amountPaise,
      },
    },
    {
      kind: "put",
      table: tables().creditNotes,
      item: { ...note, sk: "NOTE" },
      condition: "attribute_not_exists(noteId)",
    },
  ]);
  return now;
}

/* --------------------------------------------------------------------- probes */

/**
 * Deletion exists for the check scripts and nothing else. The API has no delete route:
 * a pickup and a credit note are the compliance trail, and an endpoint that removes
 * them would be an endpoint that removes evidence.
 */
export async function deletePickup(pickupId) {
  await deleteItem(tables().pickups, { pickupId, sk: "META" });
}

export async function deleteCreditNote(noteId) {
  await deleteItem(tables().creditNotes, { noteId, sk: "NOTE" });
}

/* ---------------------------------------------------------------------- views */

/** Internal keys — the GSI attributes and the sort key — are not part of the API. */
const INTERNAL = new Set([
  "pk",
  "sk",
  "collectorKey",
  "facilityKey",
  "facilityDay",
  "catalogueKey",
  "type",
]);

export function view(row) {
  if (!row) return null;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (INTERNAL.has(key)) continue;
    out[key] = value;
  }
  return out;
}
