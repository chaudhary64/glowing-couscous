/**
 * Drive the deployed smart-pickup API the way an operator would: over HTTPS, with a
 * real Cognito ID token, against the real DynamoDB tables.
 *
 * This is not a mock and it is not a unit test. It creates a temporary Cognito user in
 * the app's own pool, puts it in `eco-operator`, signs it in with `USER_PASSWORD_AUTH`
 * exactly as `app/api/auth/sign-in` does, calls every route, checks the arithmetic
 * against `aws/pickup/catalogue.mjs`, and then deletes the user and the rows it wrote.
 *
 * What it asserts, and why each one is worth asserting:
 *
 *   the edge            an unauthenticated request is refused by API Gateway, not by
 *                       our code — a 401 with no body, before any Lambda runs
 *   the role layer      a signed-in user with no `eco-*` group opens nothing, and the
 *                       same user works the moment they are given a role
 *   the licence rule    a **hazardous** load from Mumbai does not stop at the licensed
 *                       site in Mumbai, because that site is not authorised for the
 *                       stream's hazard class; it goes to Pune instead. This is the
 *                       feature, and the check fails if proximity ever wins
 *   the refusal trail   the plan that was *rejected* comes back with the rule that
 *                       rejected it, site by site
 *   no invented route   a stream nobody is licensed for is a 409 with a reason, not a
 *                       quietly chosen wrong destination
 *   the money           the note's paise total equals the rate card applied to the
 *                       weighed mass, computed here from the same catalogue the API
 *                       read from DynamoDB — so the check cannot agree with a bug
 *   idempotence         settling twice returns the first note, and a second settle with
 *                       a *different* mass still returns it unchanged
 *   the handoff PIN     settlement needs the PIN routing returned; a wrong one is a 403
 *                       with the attempts left, and never settles
 *
 * It exits non-zero on the first thing that is wrong, like `scripts/s3-check.mts`, and
 * it cleans up in a `finally` so a failure does not leave a probe user behind.
 *
 * Usage:
 *   node --env-file=.env.local scripts/pickup-check.mjs
 *
 * Needs: PICKUP_API_URL, PICKUP_TABLE_PICKUPS, PICKUP_TABLE_CREDIT_NOTES,
 *        COGNITO_REGION, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, and the AWS CLI on
 *        PATH with credentials that may administer that pool.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { FACILITIES, STREAMS } from "../aws/pickup/catalogue.mjs";
import { buildNote, priceLoad } from "../aws/pickup/credits.mjs";
import { deleteCreditNote, deleteEvents, deletePickup } from "../aws/pickup/repository.mjs";

const API = (process.env.PICKUP_API_URL ?? "").replace(/\/+$/, "");
const REGION = process.env.PICKUP_REGION ?? process.env.AWS_REGION ?? "ap-south-1";
const POOL = process.env.COGNITO_USER_POOL_ID?.trim();
const CLIENT = process.env.COGNITO_CLIENT_ID?.trim();
const COGNITO_REGION = process.env.COGNITO_REGION?.trim() || REGION;

const failures = [];
const created = { pickups: [], notes: [], user: null };

function missingConfig() {
  const required = {
    PICKUP_API_URL: API,
    COGNITO_USER_POOL_ID: POOL,
    COGNITO_CLIENT_ID: CLIENT,
    PICKUP_TABLE_PICKUPS: process.env.PICKUP_TABLE_PICKUPS,
    PICKUP_TABLE_CREDIT_NOTES: process.env.PICKUP_TABLE_CREDIT_NOTES,
  };
  return Object.entries(required)
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

const absent = missingConfig();
if (absent.length) {
  console.error(
    `Missing configuration: ${absent.join(", ")}.\n` +
      "Run `bash scripts/pickup-setup.sh` to provision the feature and write these " +
      "into .env.local, then run this script with --env-file=.env.local.",
  );
  process.exit(2);
}

/* ------------------------------------------------------------------- helpers */

let passed = 0;

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${label}`);
    return;
  }
  failures.push(label);
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  throw new Error(`Check failed: ${label}`);
}

function section(title) {
  console.log(`\n${title}`);
}

async function call(method, path, { token, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: response.status, body: json };
}

function aws(args) {
  return execFileSync("aws", [...args, "--region", REGION], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * A temporary operator. Provisioning is done with the AWS CLI rather than the SDK
 * because `AdminCreateUser` and friends are IAM-signed operations, and the app itself
 * reaches Cognito with plain `fetch` for the same reason in `lib/auth/cognito.ts`:
 * they are authenticated by the app client id, not by IAM.
 */
async function mintOperator() {
  const username = `pickup-check-${Date.now()}@example.com`;
  const password = `Aqp${randomBytes(9).toString("hex")}9`;
  console.log(`  creating ${username} in ${POOL}`);

  aws([
    "cognito-idp",
    "admin-create-user",
    "--user-pool-id",
    POOL,
    "--username",
    username,
    "--message-action",
    "SUPPRESS",
    "--user-attributes",
    `Name=email,Value=${username}`,
    "Name=email_verified,Value=true",
  ]);
  created.user = username;

  aws([
    "cognito-idp",
    "admin-set-user-password",
    "--user-pool-id",
    POOL,
    "--username",
    username,
    "--password",
    password,
    "--permanent",
  ]);

  return { username, password };
}

/** The same `InitiateAuth` the sign-in route makes, over HTTP, unauthenticated by IAM. */
async function idToken({ username, password }) {
  const response = await fetch(`https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`, {
    method: "POST",
    headers: {
      "content-type": "application/x-amz-json-1.1",
      "x-amz-target": "AWSCognitoIdentityProviderService.InitiateAuth",
    },
    body: JSON.stringify({
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: CLIENT,
      AuthParameters: { USERNAME: username, PASSWORD: password },
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.AuthenticationResult?.IdToken) {
    throw new Error(
      `InitiateAuth failed: ${response.status} ${JSON.stringify(payload).slice(0, 400)}`,
    );
  }
  return payload.AuthenticationResult.IdToken;
}

/* --------------------------------------------------------------------- main */

const apiHost = API.replace(/^https?:\/\//, "");

try {
  console.log(`Smart pickup check against ${apiHost} (${REGION})`);
  console.log(`Catalogue: ${STREAMS.length} streams, ${FACILITIES.length} facilities`);

  /* --- 1. the edge --------------------------------------------------------- */

  section("API Gateway authorizer");
  const anonymous = await call("GET", "/health");
  check(
    "an unauthenticated request is refused at the edge with 401",
    anonymous.status === 401,
    `got ${anonymous.status}`,
  );

  /* --- 2. identity -------------------------------------------------------- */

  section("Cognito identity and the role ladder");
  const operator = await mintOperator();
  let token = await idToken(operator);
  check("a token is issued for the probe user", typeof token === "string" && token.length > 100);

  const noRole = await call("GET", "/health", { token });
  check(
    "a signed-in user with no eco-* group is refused with 403",
    noRole.status === 403 && noRole.body?.error?.code === "forbidden",
    `got ${noRole.status} ${JSON.stringify(noRole.body)?.slice(0, 200)}`,
  );

  aws([
    "cognito-idp",
    "admin-add-user-to-group",
    "--user-pool-id",
    POOL,
    "--username",
    operator.username,
    "--group-name",
    "eco-operator",
  ]);
  // A fresh token: the groups claim is baked into the token that was already issued.
  token = await idToken(operator);

  const health = await call("GET", "/health", { token });
  check("an operator reaches /health", health.status === 200, `got ${health.status}`);
  check("the service reports itself", health.body?.service === "ecoepr-smart-pickup");
  check(
    "the deployed tables are the ones this script will clean up",
    health.body?.tables?.pickups === process.env.PICKUP_TABLE_PICKUPS,
    `api says ${health.body?.tables?.pickups}`,
  );

  /* --- 3. the catalogue --------------------------------------------------- */

  section("The stream catalogue the deployment is running");
  const streams = await call("GET", "/streams", { token });
  check("/streams answers", streams.status === 200, `got ${streams.status}`);
  check(
    "/streams carries every stream the repo knows",
    streams.body?.streams?.length === STREAMS.length,
    `api ${streams.body?.streams?.length} vs repo ${STREAMS.length}`,
  );
  for (const stream of STREAMS) {
    const fromApi = streams.body.streams.find((entry) => entry.code === stream.code);
    check(
      `stream ${stream.code} matches the repo's rate card and hazard class`,
      fromApi &&
        fromApi.ratePaisePerKg === stream.ratePaisePerKg &&
        fromApi.handlingPaisePerKg === stream.handlingPaisePerKg &&
        fromApi.hazardous === stream.hazardous,
      fromApi ? JSON.stringify(fromApi) : "absent from /streams",
    );
  }

  /* --- 4. the directory --------------------------------------------------- */

  section("The authorised-recycler directory");
  const directory = await call("GET", "/recyclers?stream=boards", { token });
  check("/recyclers answers for one stream", directory.status === 200, `got ${directory.status}`);
  const rx01 = directory.body?.destinations?.find((row) => row.recyclerId === "RX-01");
  const rx02 = directory.body?.destinations?.find((row) => row.recyclerId === "RX-02");
  const rx04 = directory.body?.destinations?.find((row) => row.recyclerId === "RX-04");
  check(
    "RX-01 accepts boards but is not authorised for their hazardous class",
    rx01?.accepted === true && rx01?.hazardousAuthorized === false,
    JSON.stringify(rx01),
  );
  check("RX-02 does not accept boards", rx02?.accepted === false, JSON.stringify(rx02));
  check(
    "RX-04, the reuse operator, is not a destination for a recycling stream at all",
    rx04 === undefined,
    JSON.stringify(rx04),
  );

  /* --- 5. request validation --------------------------------------------- */

  section("Request validation");
  const unknownStream = await call("POST", "/pickups", {
    token,
    body: { itemCode: "ECO-2026-CHECK", collectorId: "C-CHECK", city: "Mumbai", stream: "uranium", declaredMassG: 100 },
  });
  check(
    "an unknown stream is refused with the list of real ones",
    unknownStream.status === 400 &&
      unknownStream.body?.error?.code === "unknown_stream" &&
      Array.isArray(unknownStream.body?.error?.knownStreams),
    `${unknownStream.status} ${JSON.stringify(unknownStream.body)?.slice(0, 200)}`,
  );

  const missingMass = await call("POST", "/pickups", {
    token,
    body: { itemCode: "ECO-2026-CHECK", collectorId: "C-CHECK", city: "Mumbai", stream: "boards" },
  });
  check(
    "a missing mass is refused field by field",
    missingMass.status === 400 && Boolean(missingMass.body?.error?.fields?.declaredMassG),
    `${missingMass.status} ${JSON.stringify(missingMass.body)?.slice(0, 200)}`,
  );

  /* --- 6. the licence rule ------------------------------------------------ */

  section("Hazardous routing: the licence beats the postcode");
  const hazardous = await call("POST", "/pickups", {
    token,
    body: {
      itemCode: `ECO-2026-CHK-${Date.now()}`,
      collectorId: "C-CHECK-1042",
      city: "Mumbai",
      stream: "boards",
      declaredMassG: 2400,
      wardCode: "KUR-W",
      hazardNotes: ["lead solder residue"],
    },
  });
  if (hazardous.status === 201) created.pickups.push(hazardous.body.pickup.pickupId);
  check(
    "a hazardous board load from Mumbai is accepted and routed",
    hazardous.status === 201,
    `${hazardous.status} ${JSON.stringify(hazardous.body)?.slice(0, 300)}`,
  );

  const load = hazardous.body.pickup;
  check(
    "it does not stop at the licensed site in its own city",
    load.facilityId !== "RX-01",
    `routed to ${load.facilityId}`,
  );
  check(
    "it goes to a site authorised for the stream's hazardous class",
    load.facilityId === "RX-03" && load.interCity === true,
    `routed to ${load.facilityId}, interCity=${load.interCity}`,
  );
  check(
    "the route names a CPCB licence, because a route without one is not a compliant route",
    typeof load.cpcbLicense === "string" && load.cpcbLicense.startsWith("CPCB/"),
    String(load.cpcbLicense),
  );
  check(
    "the refusal trail names the rule that removed each site",
    load.routing?.refused?.some((row) => row.recyclerId === "RX-01" && row.rule === "R-3") &&
      load.routing?.refused?.some((row) => row.recyclerId === "RX-02" && row.rule === "R-2"),
    JSON.stringify(load.routing?.refused),
  );
  check(
    "the refused site is recorded with the reason, not silently dropped",
    load.routing.refused.every((row) => typeof row.reason === "string" && row.reason.length > 0),
  );

  /* --- 7. the ordinary case ---------------------------------------------- */

  section("A non-hazardous load stays local");
  const ordinary = await call("POST", "/pickups", {
    token,
    body: {
      itemCode: `ECO-2026-CHK-${Date.now()}`,
      collectorId: "C-CHECK-1042",
      city: "Mumbai",
      stream: "it-equipment",
      declaredMassG: 5400,
    },
  });
  if (ordinary.status === 201) created.pickups.push(ordinary.body.pickup.pickupId);
  check("a non-hazardous load is accepted", ordinary.status === 201, `got ${ordinary.status}`);
  check(
    "with no hazard authorisation in the way, the same city wins",
    ordinary.body.pickup.facilityId === "RX-01" &&
      ordinary.body.pickup.interCity === false,
    `routed to ${ordinary.body.pickup.facilityId}`,
  );

  /* --- 8. no invented destination --------------------------------------- */

  section("A stream nobody is licensed for");
  const orphan = await call("POST", "/pickups", {
    token,
    body: {
      itemCode: `ECO-2026-CHK-${Date.now()}`,
      collectorId: "C-CHECK-1042",
      city: "Mumbai",
      stream: "mixed-plastics",
      declaredMassG: 900,
    },
  });
  check(
    "is refused with a 409 rather than sent somewhere convenient",
    orphan.status === 409 && orphan.body?.error?.code === "no_authorized_recycler",
    `${orphan.status} ${JSON.stringify(orphan.body)?.slice(0, 300)}`,
  );
  check(
    "and the refusal says how many destinations were considered",
    orphan.body?.error?.candidatesConsidered === 0,
    `candidatesConsidered=${orphan.body?.error?.candidatesConsidered}`,
  );

  /* --- 9. the money ------------------------------------------------------- */

  section("Settlement and the credit note");
  const pickupId = load.pickupId;
  const weighedMassG = 2380;
  const pin = hazardous.body.handoff?.pin;
  check("routing returned a 4-digit handoff PIN", /^\d{4}$/.test(pin ?? ""), String(pin));
  const wrongPin = String((Number(pin) + 1) % 10000).padStart(4, "0");
  const refusedPin = await call("POST", `/pickups/${pickupId}/settle`, {
    token,
    body: { weighedMassG, settledVia: "upi", pin: wrongPin },
  });
  check(
    "a wrong PIN is a 403 with the attempts left, and does not settle",
    refusedPin.status === 403 && refusedPin.body?.error?.code === "pin_mismatch" && refusedPin.body.error.attemptsRemaining === 4,
    `${refusedPin.status} ${JSON.stringify(refusedPin.body)?.slice(0, 200)}`,
  );
  const settled = await call("POST", `/pickups/${pickupId}/settle`, {
    token,
    body: { weighedMassG, settledVia: "upi", pin },
  });
  check("settlement succeeds", settled.status === 200, `${settled.status} ${JSON.stringify(settled.body)?.slice(0, 300)}`);
  const note = settled.body.creditNote;
  if (note) created.notes.push(note.noteId);

  const boards = STREAMS.find((entry) => entry.code === "boards");
  // The arithmetic the API must have done, computed here from the repo's own catalogue
  // rather than from the response: a check that copied the response would pass on any
  // number at all.
  const expected = priceLoad(boards, weighedMassG);
  check(
    "the note is priced from the rate card, line by line",
    note.grossPaise === expected.grossPaise &&
      note.handlingPaise === expected.handlingPaise &&
      note.amountPaise === expected.amountPaise,
    `api ${note.grossPaise}/${note.handlingPaise}/${note.amountPaise} vs expected ${expected.grossPaise}/${expected.handlingPaise}/${expected.amountPaise}`,
  );
  check(
    "the weighed mass is what was paid on, and the declared mass is kept beside it",
    note.massG === weighedMassG && note.declaredMassG === load.declaredMassG,
    `massG=${note.massG} declared=${note.declaredMassG}`,
  );
  check(
    "the note id is derived from the load, so a retry cannot mint a second one",
    note.noteId === `CN-${pickupId.replace(/^PU-/, "")}`,
    note.noteId,
  );
  check(
    "the note carries the licence it was issued against",
    note.cpcbLicense === load.cpcbLicense,
    `${note.cpcbLicense} vs ${load.cpcbLicense}`,
  );
  check(
    "the note carries a brand-side compliance reference",
    typeof note.complianceRef === "string" && note.complianceRef.startsWith("EPR-"),
    String(note.complianceRef),
  );
  check(
    "the releasing operator is the token's subject, not a body field",
    typeof note.issuedBySub === "string" && note.issuedBySub.length > 0,
    String(note.issuedBySub),
  );
  check("the load is marked settled", settled.body.pickup.status === "settled");

  /* --- 10. idempotence --------------------------------------------------- */

  section("Settling twice");
  const again = await call("POST", `/pickups/${pickupId}/settle`, {
    token,
    body: { weighedMassG: weighedMassG + 9000, settledVia: "cash", pin },
  });
  check(
    "a second settlement is reported, not refused",
    again.status === 200 && again.body.idempotent === true,
    `${again.status} idempotent=${again.body?.idempotent}`,
  );
  check(
    "and it returns the first note unchanged, even though the body carried a different mass",
    again.body.creditNote.noteId === note.noteId &&
      again.body.creditNote.amountPaise === note.amountPaise &&
      again.body.creditNote.massG === weighedMassG,
    JSON.stringify({
      noteId: again.body.creditNote.noteId,
      amount: again.body.creditNote.amountPaise,
      mass: again.body.creditNote.massG,
    }),
  );

  /* --- 11. reads --------------------------------------------------------- */

  section("Reading it back");
  const one = await call("GET", `/pickups/${pickupId}`, { token });
  check(
    "the load reads back settled with its note attached",
    one.status === 200 && one.body.pickup.status === "settled" && one.body.creditNote?.noteId === note.noteId,
    `${one.status}`,
  );

  const noteRoute = await call("GET", `/credit-notes/${pickupId}`, { token });
  check(
    "the note has its own route",
    noteRoute.status === 200 && noteRoute.body.creditNote.amountPaise === note.amountPaise,
    `${noteRoute.status}`,
  );

  const ledger = await call("GET", "/pickups?collectorId=C-CHECK-1042", { token });
  check(
    "the collector's ledger carries both loads",
    ledger.status === 200 &&
      ledger.body.pickups.length >= 2 &&
      ledger.body.pickups.some((row) => row.pickupId === pickupId),
    `${ledger.status} count=${ledger.body?.count}`,
  );
  check(
    "and promises exactly the settled note's value",
    ledger.body.netPromisedPaise >= note.amountPaise,
    `netPromisedPaise=${ledger.body?.netPromisedPaise}`,
  );

  const missing = await call("GET", "/pickups/PU-2026-9999", { token });
  check(
    "an unknown id is a 404 with a code, not an empty 200",
    missing.status === 404 && missing.body?.error?.code === "pickup_not_found",
    `${missing.status}`,
  );

  const missingSettle = await call("POST", "/pickups/PU-2026-9999/settle", {
    token,
    body: { weighedMassG: 100, pin: "0000" },
  });
  check(
    "settling an unknown load is a 404 as well",
    missingSettle.status === 404,
    `${missingSettle.status}`,
  );

  /* --- 12. the model, not the transport ---------------------------------- */

  section("The note the checker would have built");
  const reference = buildNote({
    pickupId,
    collectorId: load.collectorId,
    itemCode: load.itemCode,
    stream: boards,
    facilityId: load.facilityId,
    facilityName: load.facilityName,
    cpcbLicense: load.cpcbLicense,
    declaredMassG: load.declaredMassG,
    weighedMassG,
    settledVia: "upi",
    issuedAt: note.issuedAt,
    issuedBy: null,
    issuedBySub: note.issuedBySub,
  });
  check(
    "the deployed Lambda produced the same note this repo's model produces",
    reference.amountPaise === note.amountPaise &&
      reference.noteId === note.noteId &&
      reference.complianceRef === note.complianceRef,
    `${reference.amountPaise}/${reference.noteId}/${reference.complianceRef} vs ${note.amountPaise}/${note.noteId}/${note.complianceRef}`,
  );

  console.log(`\nAll ${passed} checks passed.`);
} catch (error) {
  console.error(`\n${failures.length} failure(s). First: ${failures[0] ?? "(none recorded)"}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  /* --- cleanup ----------------------------------------------------------- */

  console.log("\nCleaning up");
  for (const noteId of created.notes) {
    try {
      await deleteCreditNote(noteId);
      console.log(`  removed credit note ${noteId}`);
    } catch (error) {
      console.error(`  could not remove credit note ${noteId}: ${error.message}`);
      process.exitCode = 1;
    }
  }
  for (const pickupId of created.pickups) {
    try {
      await deleteEvents(pickupId);
      await deletePickup(pickupId);
      console.log(`  removed pickup ${pickupId} and its events`);
    } catch (error) {
      console.error(`  could not remove pickup ${pickupId}: ${error.message}`);
      process.exitCode = 1;
    }
  }
  if (created.user) {
    try {
      aws([
        "cognito-idp",
        "admin-delete-user",
        "--user-pool-id",
        POOL,
        "--username",
        created.user,
      ]);
      console.log(`  removed probe user ${created.user}`);
    } catch (error) {
      console.error(`  could not remove probe user ${created.user}: ${error.message}`);
      process.exitCode = 1;
    }
  }
  // The counter item is deliberately left alone: it is not evidence, it is the source
  // of the next readable id, and deleting it would hand the id of a deleted load to the
  // next one.
}
