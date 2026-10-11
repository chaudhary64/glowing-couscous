/**
 * `ecoepr-smart-pickup` — the whole of feature 4 behind one HTTP API.
 *
 * Feature 4 makes two promises, and there is one route for each:
 *
 *   `POST /pickups`                 route this load to a licensed recycler, and say why
 *   `POST /pickups/{id}/settle`     weigh it and hand the collector a credit note
 *
 * Between the two sits the handoff: `POST /pickups` mints a 4-digit PIN that is shown
 * once, on the collector's phone, and settlement only goes through when the recycler
 * types it at the gate (`pin.mjs` has the rules). `POST /pickups/{id}/pin` issues a
 * fresh one when the first expired or was locked by wrong guesses, and
 * `GET /pickups/{id}/events` reads back the audit trail every step writes. The money
 * itself moves after settlement, asynchronously — see `payout.mjs`.
 *
 * Everything else here exists to read back what those two wrote: the collector's
 * ledger, one load with its note, the note on its own, the stream catalogue and the
 * authorised-recycler directory. Nothing on this API updates or deletes a pickup —
 * the trail is the compliance claim, so the only two writes are "a load exists" and
 * "a load settled, once".
 *
 * One Lambda, not five. The routes share the catalogue read, the router, the rate card
 * and the marshaller, and on Lambda the alternative to one function that carries those
 * is one function that imports a layer carrying them; for a surface this small the
 * layer is the more moving parts. The function is a router over `rawPath`, which also
 * means an explicit API Gateway route and a direct `aws lambda invoke` with a synthetic
 * event take the same path.
 *
 * Every response is JSON, and every failure is a code the caller can branch on — see
 * `http.mjs`. What this file adds on top is the ordering: **route before you write
 * anything**, so a load with no licensed destination is a 409 and not a row in the
 * table that somebody has to reconcile.
 */
import { CURRENCY, PILOT_CITIES } from "./catalogue.mjs";
import { buildNote, creditNoteId } from "./credits.mjs";
import {
  json,
  parseBody,
  problem,
  queryParams,
  readInteger,
  readString,
  readStringList,
  serverError,
  validate,
} from "./http.mjs";
import {
  PIN_MAX_ATTEMPTS,
  PIN_TTL_MS,
  issuePin,
  isWellFormedPin,
  pinMatches,
  pinState,
} from "./pin.mjs";
import {
  assignedMassToday,
  authorizationsForStream,
  getCreditNoteByPickup,
  getPickup,
  getStream,
  listEvents,
  listFacilities,
  listPickupsByCollector,
  listRecentLoads,
  listStreams,
  nextPickupId,
  pickupEvent,
  putPickup,
  recordPinFailure,
  reissuePin,
  settle,
  tables,
  view,
} from "./repository.mjs";
import { routeLoad } from "./routing.mjs";
import { ANY_ROLE, OPERATOR, requireRole } from "./security.mjs";

const SERVICE = "ecoepr-smart-pickup";

export const handler = async (event) => {
  const requestId =
    event?.requestContext?.requestId ?? event?.requestContext?.http?.requestId ?? null;
  try {
    return await route(event);
  } catch (error) {
    // The stack goes to CloudWatch; the caller gets a reference and no internals. A raw
    // DynamoDB exception on the wire tells a client how the table is keyed and tells an
    // operator nothing they cannot find faster in the log.
    console.error(
      JSON.stringify({
        level: "error",
        service: SERVICE,
        requestId,
        message: error?.message ?? String(error),
        name: error?.name,
      }),
    );
    return serverError("The smart-pickup service could not complete this request", requestId);
  }
};

async function route(event) {
  const method = (event?.requestContext?.http?.method ?? event?.httpMethod ?? "GET").toUpperCase();
  const path = normalizedPath(event);
  const segments = path.split("/").filter(Boolean);

  if (method === "OPTIONS") return json(204, {});

  // Every route needs a signed-in member of the tenant, including `/health`: this API
  // fronts a collector's identity and a brand's compliance trail, and there is nothing
  // on it worth publishing to an anonymous caller.
  const access = requireRole(event, ANY_ROLE);
  if (!access.ok) return access.response;

  if (segments.length === 1 && segments[0] === "health" && method === "GET") {
    return await health();
  }
  if (segments.length === 1 && segments[0] === "streams" && method === "GET") {
    return await streams();
  }
  if (segments.length === 1 && segments[0] === "recyclers" && method === "GET") {
    return await recyclers(event);
  }
  if (segments.length === 1 && segments[0] === "pickups") {
    if (method === "POST") {
      const write = requireRole(event, OPERATOR);
      if (!write.ok) return write.response;
      return await createPickup(event, write.caller);
    }
    if (method === "GET") return await pickupsIndex(event);
    return methodNotAllowed("POST, GET");
  }
  if (segments.length === 2 && segments[0] === "pickups" && method === "GET") {
    return await onePickup(segments[1]);
  }
  if (segments.length === 3 && segments[0] === "pickups" && segments[2] === "events" && method === "GET") {
    return await pickupEvents(segments[1]);
  }
  if (segments.length === 3 && segments[0] === "pickups" && segments[2] === "pin" && method === "POST") {
    const write = requireRole(event, OPERATOR);
    if (!write.ok) return write.response;
    return await newPin(segments[1], write.caller);
  }
  if (segments.length === 3 && segments[0] === "pickups" && segments[2] === "settle" && method === "POST") {
    const write = requireRole(event, OPERATOR);
    if (!write.ok) return write.response;
    return await settlePickup(event, segments[1], write.caller);
  }
  if (segments.length === 2 && segments[0] === "credit-notes" && method === "GET") {
    return await oneNote(segments[1]);
  }

  return problem("invalid_request", `No route for ${method} ${path}`, {
    hint: "POST /pickups, POST /pickups/{id}/pin, POST /pickups/{id}/settle, GET /pickups, GET /pickups/{id}, GET /pickups/{id}/events, GET /credit-notes/{pickupId}, GET /streams, GET /recyclers, GET /health",
  });
}

function methodNotAllowed(allow) {
  return json(405, {
    error: { code: "method_not_allowed", message: "Method not allowed on this route", allow },
  });
}

/**
 * `rawPath` with a named stage stripped. The API deploys to `$default`, where there is
 * no prefix, but a stage named in the invoke URL would otherwise look like a route
 * segment and turn every route into a 404 — a failure that costs an hour to find.
 */
function normalizedPath(event) {
  const stage = event?.requestContext?.stage;
  const path = event?.rawPath ?? event?.path ?? "/";
  if (stage && stage !== "$default" && path.startsWith(`/${stage}/`)) {
    return path.slice(stage.length + 1);
  }
  return path;
}

/* -------------------------------------------------------------------- reads */

async function health() {
  // `tables()` throws when one of the three names is missing, so a function deployed
  // without its configuration fails here, loudly, instead of answering "healthy" and
  // then 500-ing on the first real request.
  const named = tables();
  const catalogue = await listStreams();
  return json(200, {
    ok: true,
    service: SERVICE,
    region: process.env.AWS_REGION ?? null,
    streams: catalogue.length,
    tables: { ...named },
    pilotCities: PILOT_CITIES,
    currency: CURRENCY,
    time: new Date().toISOString(),
  });
}

async function streams() {
  const rows = await listStreams();
  const catalogue = rows
    .map((row) => ({
      code: row.code,
      label: row.label,
      labelHi: row.labelHi ?? null,
      hazardous: Boolean(row.hazardous),
      ratePaisePerKg: Number(row.ratePaisePerKg ?? 0),
      handlingPaisePerKg: Number(row.handlingPaisePerKg ?? 0),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return json(200, { currency: CURRENCY, streams: catalogue });
}

/**
 * The directory, with the day's remaining capacity included. This is the read a
 * compliance officer uses to answer "who could have taken this load today", and it is
 * computed from the same rule the router uses rather than from a second opinion.
 */
async function recyclers(event) {
  const params = queryParams(event);
  const stream = typeof params.stream === "string" ? params.stream.trim() : "";
  const city = typeof params.city === "string" ? params.city.trim() : "";
  const day = currentDay();

  if (!stream) {
    const facilities = (await listFacilities())
      .map((row) => view(row))
      .sort((a, b) => String(a.facilityId ?? a.code).localeCompare(String(b.facilityId ?? b.code)));
    return json(200, { day, facilities });
  }

  const catalogueRow = await getStream(stream);
  if (!catalogueRow) {
    return problem("unknown_stream", `No stream is registered under "${stream}"`, {
      knownStreams: (await listStreams()).map((row) => row.code),
    });
  }

  const authorizations = await authorizationsForStream(stream);
  const filtered = city
    ? authorizations.filter((row) => row.city === city)
    : authorizations;
  const assigned = await Promise.all(
    filtered.map((row) => assignedMassToday(row.facilityId, day)),
  );

  return json(200, {
    day,
    stream: stream,
    hazardous: Boolean(catalogueRow.hazardous),
    city: city || null,
    destinations: filtered
      .map((row, index) => {
        const capacityKgPerDay = Number(row.capacityKgPerDay ?? 0);
        const remainingKg = Math.max(0, capacityKgPerDay - assigned[index] / 1000);
        return {
          recyclerId: row.facilityId,
          name: row.facilityName,
          cpcbLicense: row.cpcbLicense,
          city: row.city,
          accepted: row.accepted === true,
          hazardousAuthorized: row.hazardousAuthorized === true,
          reuseOnly: row.reuseOnly === true,
          active: row.active !== false,
          slaHours: row.slaHours ?? null,
          capacityKgPerDay,
          assignedMassGToday: assigned[index],
          remainingKg: Number(remainingKg.toFixed(3)),
          note: row.note ?? null,
        };
      })
      .sort((a, b) => String(a.recyclerId).localeCompare(String(b.recyclerId))),
  });
}

async function onePickup(pickupId) {
  const pickup = await getPickup(pickupId);
  if (!pickup) return notFound(pickupId);
  const note = await getCreditNoteByPickup(pickupId);
  return json(200, { pickup: withPinState(pickup), creditNote: view(note) });
}

async function pickupEvents(pickupId) {
  const pickup = await getPickup(pickupId);
  if (!pickup) return notFound(pickupId);
  const events = (await listEvents(pickupId)).map(view);
  return json(200, { pickupId, count: events.length, events });
}

/**
 * The pickup as the API shows it, with where its PIN stands spelled out — attempts
 * left, locked, expired — so the gate can say which of those just happened without
 * re-deriving the rules. The PIN itself is never in it; `view` drops the hash.
 */
function withPinState(pickup) {
  const out = view(pickup);
  if (!pickup.creditNoteId && typeof pickup.pinHash === "string") {
    const state = pinState(pickup);
    out.handoff = {
      attemptsRemaining: state.attemptsRemaining,
      locked: state.locked,
      expired: state.expired,
      expiresAt: state.expiresAt,
    };
  }
  return out;
}

async function oneNote(pickupId) {
  const pickup = await getPickup(pickupId);
  const note = await getCreditNoteByPickup(pickupId);
  if (!note) {
    return problem("credit_note_not_found", `No credit note is issued for ${pickupId}`, {
      pickupExists: Boolean(pickup),
      pickupStatus: pickup?.status ?? null,
    });
  }
  return json(200, { pickup: pickup ? view(pickup) : null, creditNote: view(note) });
}

/**
 * `GET /pickups` answers one of two questions, and the parameter decides which.
 *
 * With `collectorId` it is a collector's ledger: what this person is owed, load by load.
 * Without it, it is the operator's board: every load the platform has routed, newest
 * first. Same table, read two ways — which is why they share a route rather than each
 * claiming a path of its own, and why adding the board did not change the ledger's
 * response by a byte.
 */
async function pickupsIndex(event) {
  const params = queryParams(event);
  const collector =
    typeof params.collectorId === "string" ? params.collectorId.trim() : "";
  if (collector) return await collectorLedger(event);
  return await recentLoads(event);
}

/**
 * The board read: every load, newest first.
 *
 * The PIN's state rides along (`withPinState`), because the question an operator asks of
 * a row that has not settled is "is the handoff still live" — and a board that made them
 * open each load to find out would be a board nobody uses. The PIN itself never appears:
 * it is shown once, on the collector's phone.
 */
async function recentLoads(event) {
  const params = queryParams(event);
  const limit = readInteger(params, "limit", { min: 1, max: 100, required: false });
  const rows = await listRecentLoads(limit.ok && limit.value ? limit.value : 25);
  const pickups = rows.map(withPinState);
  return json(200, {
    day: currentDay(),
    count: pickups.length,
    pickups,
  });
}

async function collectorLedger(event) {
  const params = queryParams(event);
  const collector = readString(params, "collectorId", { max: 80 });
  if (!collector.ok) {
    return problem("invalid_request", collector.message, { fields: { collectorId: collector.message } });
  }
  const limit = readInteger(params, "limit", { min: 1, max: 100, required: false });
  const rows = await listPickupsByCollector(collector.value, limit.ok && limit.value ? limit.value : 25);
  const pickups = rows.map(view);
  return json(200, {
    collectorId: collector.value,
    count: pickups.length,
    netPromisedPaise: pickups.reduce(
      (sum, row) => sum + Number(row.creditNoteAmountPaise ?? 0),
      0,
    ),
    pickups,
  });
}

function notFound(pickupId) {
  return problem("pickup_not_found", `No pickup is recorded under ${pickupId}`, {
    pickupId,
  });
}

/* ------------------------------------------------------------------- writes */

/**
 * One load in, one routed destination out.
 *
 * The order matters and is the design: the catalogue is read, the candidates are read,
 * the route is decided, and only then is an id minted. A request that cannot be routed
 * leaves no trace at all, so "why is there a pickup with no recycler" is not a question
 * this table can be asked.
 */
async function createPickup(event, who) {
  const body = parseBody(event);
  if (body === null) {
    return problem("invalid_request", "The request body must be a JSON object");
  }

  const checked = validate({
    itemCode: readString(body, "itemCode", { max: 64 }),
    collectorId: readString(body, "collectorId", { max: 80 }),
    city: readString(body, "city", { max: 80 }),
    stream: readString(body, "stream", { max: 40 }),
    declaredMassG: readInteger(body, "declaredMassG", { min: 1, max: 500000 }),
    wardCode: readString(body, "wardCode", { max: 40, required: false }),
    hazardNotes: readStringList(body, "hazardNotes"),
  });
  if (!checked.ok) return checked.response;

  const { itemCode, collectorId, city, stream, declaredMassG, wardCode, hazardNotes } =
    checked.values;

  const catalogueRow = await getStream(stream);
  if (!catalogueRow) {
    return problem("unknown_stream", `No stream is registered under "${stream}"`, {
      knownStreams: (await listStreams()).map((row) => row.code),
    });
  }

  const authorizations = await authorizationsForStream(stream);
  const day = currentDay();
  const assignedPairs = await Promise.all(
    authorizations.map(async (row) => [row.facilityId, await assignedMassToday(row.facilityId, day)]),
  );
  const assignedMassGByFacility = new Map(assignedPairs);

  const decision = routeLoad({
    stream: catalogueRow,
    city,
    declaredMassG,
    itemCode,
    authorizations,
    assignedMassGByFacility,
  });

  if (!decision.chosen) {
    // A valid request with no licensed destination, refused with every candidate and
    // the rule that removed it. This is the response the feature is really about: the
    // platform would rather refuse a hazardous load than route it somewhere unlicensed.
    return problem(
      "no_authorized_recycler",
      `No licensed recycler can take ${catalogueRow.label} from ${city} today`,
      {
        stream: catalogueRow.code,
        hazardous: Boolean(catalogueRow.hazardous),
        candidatesConsidered: decision.candidatesConsidered,
        refused: decision.refused,
        notes: decision.notes,
      },
    );
  }

  const requestedAt = new Date().toISOString();
  const year = new Date(requestedAt).getUTCFullYear();
  const { pickupId } = await nextPickupId(year);
  const chosen = decision.chosen;

  const pickup = {
    pickupId,
    type: "pickup",
    code: pickupId,
    status: "assigned",
    itemCode,
    collectorId,
    stream: catalogueRow.code,
    streamLabel: catalogueRow.label,
    hazardous: Boolean(catalogueRow.hazardous),
    hazardNotes,
    city,
    wardCode,
    declaredMassG,
    facilityId: chosen.facilityId,
    facilityName: chosen.facilityName,
    cpcbLicense: chosen.cpcbLicense,
    facilityCity: chosen.city,
    interCity: chosen.interCity,
    slaHours: chosen.slaHours,
    distanceKm: chosen.distanceKm,
    distanceIsEstimate: true,
    etaMinutes: chosen.etaMinutes,
    routeLabel: chosen.routeLabel,
    routing: {
      candidatesConsidered: decision.candidatesConsidered,
      rule: "R-7",
      hazardousRule: catalogueRow.hazardous ? "R-3 enforced" : "R-3 not applicable",
      refused: decision.refused,
      notes: decision.notes,
    },
    requestedAt,
    assignedAt: requestedAt,
    // Who asked, from the token rather than from the body: an operator's id in the
    // request payload would be a claim about identity, and this one is not.
    requestedBySub: who.sub,
    requestedByRole: who.role,
    collectorKey: `COLLECTOR#${collectorId}`,
    facilityKey: `FACILITY#${chosen.facilityId}`,
    facilityDay: `${day}#${pickupId}`,
  };

  // The PIN is minted with the load and stored as a hash; the plain value goes back in
  // this response, to the phone that asked for it, and nowhere else.
  const handoff = issuePin(pickupId, new Date(requestedAt));
  Object.assign(pickup, handoff.attributes);

  await putPickup(pickup, [
    pickupEvent(
      pickupId,
      "routed",
      {
        at: requestedAt,
        actor: who,
        details: {
          facilityId: chosen.facilityId,
          stream: catalogueRow.code,
          hazardous: pickup.hazardous,
          declaredMassG,
        },
      },
      0,
    ),
    pickupEvent(
      pickupId,
      "pin_issued",
      { at: requestedAt, actor: who, details: { expiresAt: handoff.attributes.pinExpiresAt } },
      1,
    ),
  ]);

  console.log(
    JSON.stringify({
      level: "info",
      service: SERVICE,
      event: "pickup_routed",
      pickupId,
      stream: catalogueRow.code,
      hazardous: pickup.hazardous,
      facilityId: chosen.facilityId,
      interCity: chosen.interCity,
      refusedCount: decision.refused.length,
    }),
  );

  return json(201, {
    pickup: withPinState(pickup),
    creditNote: null,
    handoff: handoffResponse(handoff),
    next: `POST /pickups/${pickupId}/settle with the weighed mass and the collector's PIN to issue the credit note`,
  });
}

function handoffResponse(handoff) {
  return {
    pin: handoff.pin,
    expiresAt: handoff.attributes.pinExpiresAt,
    ttlSeconds: PIN_TTL_MS / 1000,
    maxAttempts: PIN_MAX_ATTEMPTS,
  };
}

/**
 * A fresh PIN for a load still waiting at the gate — after the first one expired, or
 * after five wrong guesses locked it. Operator-only, like routing, because whoever can
 * call this can put a new PIN on a phone.
 */
async function newPin(pickupId, who) {
  const pickup = await getPickup(pickupId);
  if (!pickup) return notFound(pickupId);
  if (pickup.creditNoteId) {
    return problem("pickup_not_settleable", "This load already settled, so it has no PIN to replace", {
      pickupId,
      status: pickup.status,
    });
  }

  const now = new Date();
  const handoff = issuePin(pickupId, now);
  try {
    await reissuePin({
      pickupId,
      attributes: handoff.attributes,
      events: [
        pickupEvent(pickupId, "pin_reissued", {
          at: now.toISOString(),
          actor: who,
          details: {
            expiresAt: handoff.attributes.pinExpiresAt,
            previousAttempts: Number(pickup.pinAttempts ?? 0),
          },
        }),
      ],
    });
  } catch (error) {
    if (error?.name !== "TransactionCanceledException") throw error;
    // Settled between the read and the write: the load no longer needs a PIN.
    return problem("pickup_not_settleable", "This load settled while the new PIN was being issued", {
      pickupId,
    });
  }

  const updated = await getPickup(pickupId);
  return json(200, { pickup: withPinState(updated ?? pickup), handoff: handoffResponse(handoff) });
}

/**
 * Settlement: the gate weighs the load, and the collector leaves with a note.
 *
 * Two behaviours worth knowing before reading the code:
 *
 * **It is idempotent by id, not by request.** Settling a load that already settled
 * answers 200 with `idempotent: true` and the note that exists, even if the body
 * carries a different mass. Re-pricing on a retry would mean a lost response could
 * change what a collector is owed, which is the one thing a credit note cannot do. A
 * genuinely wrong weigh is a new instrument (an adjustment), not an overwrite.
 *
 * **A refusal is still instantaneous.** Settlement never returns "pending"; it either
 * settles or explains why it cannot, because "the collector gets a receipt at the
 * gate" is the promise, and a queue in the middle of it is a promise deferred.
 */
async function settlePickup(event, pickupId, who) {
  const body = parseBody(event);
  if (body === null) {
    return problem("invalid_request", "The request body must be a JSON object");
  }

  const checked = validate({
    weighedMassG: readInteger(body, "weighedMassG", { min: 1, max: 500000 }),
    pin: readPin(body),
    settledVia: readString(body, "settledVia", { max: 40, required: false }),
    issuedBy: readString(body, "issuedBy", { max: 80, required: false }),
  });
  if (!checked.ok) return checked.response;

  const { weighedMassG, pin, settledVia, issuedBy } = checked.values;

  const pickup = await getPickup(pickupId);
  if (!pickup) return notFound(pickupId);

  if (pickup.creditNoteId) {
    const existing = await getCreditNoteByPickup(pickupId);
    if (existing) {
      return json(200, {
        pickup: view(pickup),
        creditNote: view(existing),
        idempotent: true,
        note: "This load already settled; the note that exists is returned unchanged",
      });
    }
  }

  // The handoff PIN, checked in the order that tells the gate the most: a locked or
  // expired PIN is refused *before* the digits are compared, so a guess against a dead
  // PIN neither counts nor confirms anything.
  const state = pinState(pickup);
  if (!state.issued) {
    return problem("pin_not_issued", "This load was routed before handoff PINs existed and cannot be settled by PIN", {
      pickupId,
      hint: `POST /pickups/${pickupId}/pin to issue one`,
    });
  }
  if (state.locked) {
    return problem("pin_locked", `Too many wrong PINs — ${PIN_MAX_ATTEMPTS} attempts used. Issue a new PIN from the collector's phone`, {
      pickupId,
      attemptsRemaining: 0,
    });
  }
  if (state.expired) {
    return problem("pin_expired", "This PIN has expired. Issue a new one from the collector's phone", {
      pickupId,
      expiresAt: state.expiresAt,
    });
  }
  if (!pinMatches(pickupId, pin, pickup.pinHash)) {
    return await wrongPin(pickup, who);
  }

  const catalogueRow = await getStream(pickup.stream);
  if (!catalogueRow) {
    return problem(
      "pickup_not_settleable",
      `The load names stream "${pickup.stream}", which is no longer in the catalogue`,
      { pickupId },
    );
  }

  const issuedAt = new Date().toISOString();
  const note = buildNote({
    pickupId,
    collectorId: pickup.collectorId,
    itemCode: pickup.itemCode,
    stream: catalogueRow,
    facilityId: pickup.facilityId,
    facilityName: pickup.facilityName,
    cpcbLicense: pickup.cpcbLicense,
    declaredMassG: Number(pickup.declaredMassG),
    weighedMassG,
    settledVia: settledVia ?? "upi",
    issuedAt,
    issuedBy: issuedBy ?? null,
    issuedBySub: who.sub,
  });

  try {
    await settle({
      pickupId,
      weighedMassG,
      settledVia: settledVia ?? "upi",
      note,
      pinHash: pickup.pinHash,
      events: [
        pickupEvent(
          pickupId,
          "pin_verified",
          { at: issuedAt, actor: who, details: { attemptsUsed: state.attempts + 1 } },
          0,
        ),
        pickupEvent(
          pickupId,
          "settled",
          {
            at: issuedAt,
            actor: who,
            details: {
              noteId: note.noteId,
              amountPaise: note.amountPaise,
              declaredMassG: note.declaredMassG,
              weighedMassG,
              massVariancePct: note.massVariancePct,
              flags: note.flags,
            },
          },
          1,
        ),
      ],
    });
  } catch (error) {
    if (error?.name !== "TransactionCanceledException") throw error;
    // The expected loser of a race: someone else settled this load between the read
    // above and the transaction. Resolve it by reading state rather than by retrying,
    // because a second attempt would ask the same question and get the same answer.
    const settledRow = await getPickup(pickupId);
    const existing = await getCreditNoteByPickup(pickupId);
    if (existing) {
      return json(200, {
        pickup: view(settledRow ?? pickup),
        creditNote: view(existing),
        idempotent: true,
        note: "This load settled concurrently; the note that exists is returned unchanged",
      });
    }
    // Not settled, so the PIN moved under us: locked by a guess on another terminal,
    // reissued from the phone, or expired in the gap. Say which.
    const now = settledRow ? pinState(settledRow) : null;
    if (now?.locked) {
      return problem("pin_locked", "The PIN was locked by wrong guesses while this settlement was in flight", {
        pickupId,
        attemptsRemaining: 0,
      });
    }
    if (now?.expired) {
      return problem("pin_expired", "The PIN expired while this settlement was in flight", { pickupId });
    }
    if (settledRow && settledRow.pinHash !== pickup.pinHash) {
      return problem("pin_mismatch", "A new PIN was issued while this settlement was in flight; use the one on the phone now", {
        pickupId,
        attemptsRemaining: now?.attemptsRemaining ?? null,
      });
    }
    return problem("pickup_not_settleable", "This load cannot be settled as it stands", {
      pickupId,
      status: settledRow?.status ?? null,
    });
  }

  console.log(
    JSON.stringify({
      level: "info",
      service: SERVICE,
      event: "credit_note_issued",
      pickupId,
      noteId: creditNoteId(pickupId),
      amountPaise: note.amountPaise,
      massG: note.massG,
      flags: note.flags,
    }),
  );

  const settledRow = await getPickup(pickupId);
  return json(200, {
    pickup: view(settledRow ?? pickup),
    creditNote: view(note),
    idempotent: false,
    payout: "pending — the UPI credit is sent by the payout function off this table's stream",
  });
}

/**
 * A wrong PIN: counted, logged, and answered with how many tries are left. The fifth
 * wrong guess also writes `pin_locked`, so the trail shows the moment the load stopped
 * accepting PINs rather than leaving it to be inferred from a counter.
 */
async function wrongPin(pickup, who) {
  const { pickupId } = pickup;
  const at = new Date().toISOString();
  const attemptNumber = Number(pickup.pinAttempts ?? 0) + 1;
  const events = [
    pickupEvent(pickupId, "pin_failed", { at, actor: who, details: { attempt: attemptNumber } }, 0),
  ];
  if (attemptNumber >= PIN_MAX_ATTEMPTS) {
    events.push(pickupEvent(pickupId, "pin_locked", { at, actor: who, details: { attempts: attemptNumber } }, 1));
  }

  let attempts;
  try {
    attempts = await recordPinFailure({ pickupId, pinHash: pickup.pinHash, events });
  } catch (error) {
    if (error?.name !== "TransactionCanceledException") throw error;
    // The PIN changed, locked or settled between the read and the count. Re-read, and
    // report what is true now rather than a count that did not happen.
    const current = await getPickup(pickupId);
    if (current?.creditNoteId) {
      return problem("pickup_not_settleable", "This load settled on another terminal a moment ago", { pickupId });
    }
    const state = current ? pinState(current) : null;
    if (state?.locked) {
      return problem("pin_locked", `Too many wrong PINs — ${PIN_MAX_ATTEMPTS} attempts used. Issue a new PIN from the collector's phone`, {
        pickupId,
        attemptsRemaining: 0,
      });
    }
    return problem("pin_mismatch", "That PIN does not match the collector's phone", {
      pickupId,
      attemptsRemaining: state?.attemptsRemaining ?? null,
    });
  }

  console.log(
    JSON.stringify({ level: "warn", service: SERVICE, event: "pin_failed", pickupId, attempts }),
  );

  const attemptsRemaining = Math.max(0, PIN_MAX_ATTEMPTS - attempts);
  if (attemptsRemaining === 0) {
    return problem("pin_locked", `Too many wrong PINs — ${PIN_MAX_ATTEMPTS} attempts used. Issue a new PIN from the collector's phone`, {
      pickupId,
      attemptsRemaining: 0,
    });
  }
  return problem("pin_mismatch", "That PIN does not match the collector's phone", {
    pickupId,
    attemptsRemaining,
  });
}

function readPin(body) {
  const value = body?.pin;
  if (value === undefined || value === null || value === "") {
    return { ok: false, message: "pin is required — the 4 digits on the collector's phone" };
  }
  if (!isWellFormedPin(value)) {
    return { ok: false, message: "pin must be exactly 4 digits, as a string" };
  }
  return { ok: true, value };
}

function currentDay() {
  return new Date().toISOString().slice(0, 10);
}
