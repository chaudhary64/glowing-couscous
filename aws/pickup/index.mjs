/**
 * `ecoepr-smart-pickup` — the whole of feature 4 behind one HTTP API.
 *
 * Feature 4 makes two promises, and there is one route for each:
 *
 *   `POST /pickups`                 route this load to a licensed recycler, and say why
 *   `POST /pickups/{id}/settle`     weigh it and hand the collector a credit note
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
  assignedMassToday,
  authorizationsForStream,
  getCreditNoteByPickup,
  getPickup,
  getStream,
  listFacilities,
  listPickupsByCollector,
  listStreams,
  nextPickupId,
  putPickup,
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
    if (method === "GET") return await collectorLedger(event);
    return methodNotAllowed("POST, GET");
  }
  if (segments.length === 2 && segments[0] === "pickups" && method === "GET") {
    return await onePickup(segments[1]);
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
    hint: "POST /pickups, POST /pickups/{id}/settle, GET /pickups, GET /pickups/{id}, GET /credit-notes/{pickupId}, GET /streams, GET /recyclers, GET /health",
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
  return json(200, { pickup: view(pickup), creditNote: view(note) });
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

  await putPickup(pickup);

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
    pickup: view(pickup),
    creditNote: null,
    next: `POST /pickups/${pickupId}/settle with the weighed mass to issue the credit note`,
  });
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
    settledVia: readString(body, "settledVia", { max: 40, required: false }),
    issuedBy: readString(body, "issuedBy", { max: 80, required: false }),
  });
  if (!checked.ok) return checked.response;

  const { weighedMassG, settledVia, issuedBy } = checked.values;

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
    await settle({ pickupId, weighedMassG, settledVia: settledVia ?? "upi", note });
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
  });
}

function currentDay() {
  return new Date().toISOString().slice(0, 10);
}
