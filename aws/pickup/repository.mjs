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
 *   Beside each load's `META` item sit its audit events, `EVENT#<iso time>#<kind>#<n>`:
 *   routed, PIN issued, every wrong PIN, settled, paid. Same partition, so the whole
 *   history of a load is one Query, and each event is written in the same transaction
 *   as the state change it describes — there is no state the trail does not explain.
 *   Event items carry neither `collectorKey` nor `facilityKey`, so both indexes stay
 *   sparse: a collector's ledger and a facility's daily capacity see loads, not events.
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
  query,
  transactWrite,
  updateItem,
} from "./dynamo.mjs";
import { PIN_MAX_ATTEMPTS } from "./pin.mjs";

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

/** A load and the events that created it, written together or not at all. */
export async function putPickup(pickup, events = []) {
  await transactWrite([
    {
      kind: "put",
      table: tables().pickups,
      item: { ...pickup, sk: "META" },
      condition: "attribute_not_exists(pickupId)",
    },
    ...events.map(eventPut),
  ]);
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
 * The pickup update and the note put are the settlement; the event rows that ride along
 * are separate items in the pickup's partition, so they do not count against the rule
 * below.
 *
 * A `ConditionCheck` on the pickup beside
 * this update would express the same condition twice and DynamoDB refuses the whole
 * request for it — "Transaction request cannot include multiple operations on one
 * item" — so the condition lives on the update, which is where it does the work.
 */
export async function settle({ pickupId, weighedMassG, settledVia, note, pinHash, events = [] }) {
  const now = new Date().toISOString();
  await transactWrite([
    {
      kind: "update",
      table: tables().pickups,
      key: { pickupId, sk: "META" },
      update:
        "SET #status = :settled, weighedMassG = :mass, creditNoteId = :noteId, settledAt = :now, settledVia = :via, creditNoteAmountPaise = :amount, payoutStatus = :pending",
      // The PIN conditions are re-stated here, at the write, not only checked in the
      // handler: a wrong guess on another terminal can lock the PIN, or a reissue can
      // replace it, between the handler's read and this transaction. Settling against
      // a PIN that stopped being valid a millisecond ago is still settling against a
      // stale PIN.
      condition:
        "attribute_not_exists(creditNoteId) AND pinHash = :pinHash AND pinAttempts < :maxAttempts AND pinExpiresAt > :now",
      names: { "#status": "status" },
      values: {
        ":settled": "settled",
        ":mass": weighedMassG,
        ":noteId": note.noteId,
        ":now": now,
        ":via": settledVia,
        ":amount": note.amountPaise,
        ":pending": "pending",
        ":pinHash": pinHash,
        ":maxAttempts": PIN_MAX_ATTEMPTS,
      },
    },
    {
      kind: "put",
      table: tables().creditNotes,
      item: { ...note, sk: "NOTE" },
      condition: "attribute_not_exists(noteId)",
    },
    ...events.map(eventPut),
  ]);
  return now;
}

/* ------------------------------------------------------------------- handoff PIN */

/**
 * One wrong PIN, counted. `ADD` is atomic, so two terminals guessing at once cannot both
 * read "4 attempts" and both get a sixth try. The conditions refuse to count against a
 * load that has settled or a PIN that has since been replaced — a stale guess must not
 * burn an attempt off the fresh PIN.
 *
 * Returns the stored attempt count after the increment.
 */
export async function recordPinFailure({ pickupId, pinHash, events = [] }) {
  await transactWrite([
    {
      kind: "update",
      table: tables().pickups,
      key: { pickupId, sk: "META" },
      update: "ADD pinAttempts :one",
      condition:
        "attribute_not_exists(creditNoteId) AND pinHash = :pinHash AND pinAttempts < :maxAttempts",
      values: { ":one": 1, ":pinHash": pinHash, ":maxAttempts": PIN_MAX_ATTEMPTS },
    },
    ...events.map(eventPut),
  ]);
  const row = await getPickup(pickupId);
  return Number(row?.pinAttempts ?? 0);
}

/**
 * A fresh PIN for a load that has not settled: new hash, new clock, counter at zero.
 * The old PIN stops working the moment this commits, because settlement compares
 * against the stored hash at write time.
 */
export async function reissuePin({ pickupId, attributes, events = [] }) {
  await transactWrite([
    {
      kind: "update",
      table: tables().pickups,
      key: { pickupId, sk: "META" },
      update:
        "SET pinHash = :pinHash, pinIssuedAt = :issuedAt, pinExpiresAt = :expiresAt, pinAttempts = :zero",
      condition: "attribute_exists(pickupId) AND attribute_not_exists(creditNoteId)",
      values: {
        ":pinHash": attributes.pinHash,
        ":issuedAt": attributes.pinIssuedAt,
        ":expiresAt": attributes.pinExpiresAt,
        ":zero": 0,
      },
    },
    ...events.map(eventPut),
  ]);
}

/* ------------------------------------------------------------------------ payout */

/**
 * The simulated UPI credit, applied once. `payoutStatus = pending` is the condition, so
 * a stream record delivered twice — which DynamoDB Streams is allowed to do — pays once
 * and then fails the condition, and the caller treats that as "already paid".
 */
export async function markPaid({ pickupId, payout, events = [] }) {
  await transactWrite([
    {
      kind: "update",
      table: tables().pickups,
      key: { pickupId, sk: "META" },
      update:
        "SET payoutStatus = :paid, payoutRef = :ref, payoutVpa = :vpa, payoutAmountPaise = :amount, paidAt = :at, payoutSimulated = :simulated",
      condition: "payoutStatus = :pending",
      values: {
        ":paid": "paid",
        ":pending": "pending",
        ":ref": payout.ref,
        ":vpa": payout.vpa,
        ":amount": payout.amountPaise,
        ":at": payout.paidAt,
        ":simulated": true,
      },
    },
    ...events.map(eventPut),
  ]);
}

/* ------------------------------------------------------------------------ events */

/**
 * An audit event, keyed so a Query on the load's partition returns its history in the
 * order it happened. The trailing counter keeps two events in the same millisecond —
 * "settled" and the PIN check that allowed it — from colliding on one key.
 */
export function pickupEvent(pickupId, kind, { at, actor = null, details = {} }, sequence = 0) {
  return {
    pickupId,
    sk: `EVENT#${at}#${String(sequence).padStart(2, "0")}#${kind}`,
    type: "event",
    kind,
    at,
    actorSub: actor?.sub ?? null,
    actorRole: actor?.role ?? null,
    details,
  };
}

function eventPut(event) {
  return {
    kind: "put",
    table: tables().pickups,
    item: event,
    condition: "attribute_not_exists(sk)",
  };
}

export async function listEvents(pickupId) {
  return query(tables().pickups, {
    keyCondition: "pickupId = :pickupId AND begins_with(sk, :prefix)",
    values: { ":pickupId": pickupId, ":prefix": "EVENT#" },
    consistent: true,
  });
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

/** Every event row of a load, for the same check scripts. */
export async function deleteEvents(pickupId) {
  for (const event of await listEvents(pickupId)) {
    await deleteItem(tables().pickups, { pickupId, sk: event.sk });
  }
}

export async function deleteCreditNote(noteId) {
  await deleteItem(tables().creditNotes, { noteId, sk: "NOTE" });
}

/* ---------------------------------------------------------------------- views */

/**
 * Internal keys — the GSI attributes and the sort key — are not part of the API, and
 * neither is the PIN hash: it never leaves the table, through any route.
 */
const INTERNAL = new Set([
  "pinHash",
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
