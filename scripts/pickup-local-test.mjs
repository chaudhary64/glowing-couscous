/**
 * The handoff flow against DynamoDB Local, through the Lambda's own handler.
 *
 *   npm run pickup:local     # in one terminal: DynamoDB Local + the payout stream relay
 *   npm run pickup:test      # in another
 *
 * `scripts/pickup-check.mjs` drives the *deployed* API over HTTPS with a real Cognito
 * token. This drives the same `handler` in-process with synthetic API Gateway events, so
 * every rule the PIN adds can be exercised in seconds without an AWS account:
 *
 *   the PIN          routing returns a 4-digit PIN once; no read path ever returns it
 *                    or its hash
 *   wrong PIN        refused with the attempts left, and the refusal is in the trail
 *   lockout          the fifth wrong PIN locks the load — even the right PIN is then
 *                    refused — and a reissued PIN unlocks it
 *   expiry           a PIN past its 15 minutes is refused before the digits are compared
 *   the money        37.5 kg of lead-acid settles to exactly ₹450.00 off the rate card
 *   the stream       settlement leaves the payout pending; the stream-triggered payout
 *                    marks it paid with a 12-digit UPI reference, once
 *   the trail        routed → pin_issued → pin_failed → pin_verified → settled →
 *                    payout_sent, in order, and none of it in the collector's ledger
 *   roles            a viewer can read a load but not settle it
 *
 * Exits non-zero on the first failure. Loads it creates are left in the local table —
 * it is a demo database, and they show up in the gate's history like any other.
 */
import { STREAMS } from "../aws/pickup/catalogue.mjs";
import { priceLoad } from "../aws/pickup/credits.mjs";

Object.assign(process.env, {
  PICKUP_DYNAMODB_ENDPOINT: process.env.PICKUP_DYNAMODB_ENDPOINT || "http://127.0.0.1:8000",
  PICKUP_REGION: process.env.PICKUP_REGION || "ap-south-1",
  PICKUP_TABLE_RECYCLERS: process.env.PICKUP_TABLE_RECYCLERS || "ecoepr-recyclers",
  PICKUP_TABLE_PICKUPS: process.env.PICKUP_TABLE_PICKUPS || "ecoepr-pickups",
  PICKUP_TABLE_CREDIT_NOTES: process.env.PICKUP_TABLE_CREDIT_NOTES || "ecoepr-credit-notes",
});

const { handler } = await import("../aws/pickup/index.mjs");
const { updateItem } = await import("../aws/pickup/dynamo.mjs");

let passed = 0;
function check(label, condition, detail = "") {
  if (!condition) {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`  ok    ${label}`);
}
const section = (title) => console.log(`\n${title}`);
const show = (response) => `${response.status} ${JSON.stringify(response.body).slice(0, 240)}`;

const OPERATOR = { sub: "local-operator", email: "operator@local", groups: "[eco-operator]" };
const VIEWER = { sub: "local-viewer", email: "viewer@local", groups: "[eco-viewer]" };

async function call(method, path, { body, as = OPERATOR, query } = {}) {
  const response = await handler({
    rawPath: path,
    queryStringParameters: query,
    body: body ? JSON.stringify(body) : undefined,
    requestContext: {
      requestId: `test-${Date.now()}`,
      http: { method },
      authorizer: { jwt: { claims: { sub: as.sub, email: as.email, "cognito:groups": as.groups } } },
    },
  });
  return { status: response.statusCode, body: response.body ? JSON.parse(response.body) : null };
}

const collectorId = `C-LOCAL-${Date.now()}`;
const load = (extra = {}) => ({
  itemCode: `ECO-2026-LOCAL-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
  collectorId,
  city: "Mumbai",
  stream: "lead-acid",
  declaredMassG: 37500,
  hazardNotes: ["Sealed lead-acid, casing intact"],
  ...extra,
});
const wrong = (pin) => String((Number(pin) + 1) % 10000).padStart(4, "0");

/* ---------------------------------------------------------------- happy path */

section("Route a load and mint the PIN");
const health = await call("GET", "/health");
check("DynamoDB Local answers and the catalogue is seeded", health.status === 200 && health.body.streams > 0, show(health));

const routed = await call("POST", "/pickups", { body: load() });
check("routing succeeds", routed.status === 201, show(routed));
const { pickupId } = routed.body.pickup;
const { pin } = routed.body.handoff;
check("a hazardous lead-acid load goes to the licensed battery line", routed.body.pickup.facilityId === "RX-02");
check("the PIN is exactly 4 digits", /^\d{4}$/.test(pin), pin);
check("the response never carries the PIN hash", !JSON.stringify(routed.body).includes("pinHash"));

const read = await call("GET", `/pickups/${pickupId}`);
check("a read shows the PIN state but not the PIN", read.body.pickup.handoff?.attemptsRemaining === 5 && !("pin" in read.body.pickup.handoff) && !("handoff" in read.body && "pin" in read.body.handoff), show(read));
check("and not its hash", !JSON.stringify(read.body).includes("pinHash"));

section("Refuse a wrong PIN, then settle with the right one");
const noPin = await call("POST", `/pickups/${pickupId}/settle`, { body: { weighedMassG: 37500 } });
check("a settlement without a PIN is a 400", noPin.status === 400 && noPin.body.error.fields?.pin, show(noPin));

const miss = await call("POST", `/pickups/${pickupId}/settle`, { body: { weighedMassG: 37500, pin: wrong(pin) } });
check("a wrong PIN is refused with attempts left", miss.status === 403 && miss.body.error.code === "pin_mismatch" && miss.body.error.attemptsRemaining === 4, show(miss));

const viewer = await call("POST", `/pickups/${pickupId}/settle`, { body: { weighedMassG: 37500, pin }, as: VIEWER });
check("a viewer cannot settle, even with the right PIN", viewer.status === 403 && viewer.body.error.code === "forbidden", show(viewer));

const settled = await call("POST", `/pickups/${pickupId}/settle`, { body: { weighedMassG: 37500, pin } });
check("the right PIN settles", settled.status === 200 && settled.body.idempotent === false, show(settled));
const leadAcid = STREAMS.find((stream) => stream.code === "lead-acid");
const expected = priceLoad(leadAcid, 37500).amountPaise;
check("37.5 kg of lead-acid is ₹450.00 off the rate card", settled.body.creditNote.amountPaise === 45000 && expected === 45000, `${settled.body.creditNote.amountPaise}`);
check("settlement leaves the payout pending", settled.body.pickup.payoutStatus === "pending");

const again = await call("POST", `/pickups/${pickupId}/settle`, { body: { weighedMassG: 99999, pin } });
check("a second settlement returns the first note unchanged", again.status === 200 && again.body.idempotent === true && again.body.creditNote.massG === 37500, show(again));

section("The stream pays the collector");
let paid = null;
for (let i = 0; i < 40 && !paid; i += 1) {
  const now = await call("GET", `/pickups/${pickupId}`);
  if (now.body.pickup.payoutStatus === "paid") paid = now.body.pickup;
  else await new Promise((resolve) => setTimeout(resolve, 250));
}
check("payout lands within 10 s (is `npm run pickup:local` running?)", Boolean(paid));
check("with a 12-digit UPI reference", /^\d{12}$/.test(paid.payoutRef), paid.payoutRef);
check("for the note's amount, labelled simulated", paid.payoutAmountPaise === 45000 && paid.payoutSimulated === true);

const trail = await call("GET", `/pickups/${pickupId}/events`);
const kinds = trail.body.events.map((event) => event.kind);
check(
  "the trail reads routed → pin_issued → pin_failed → pin_verified → settled → payout_sent",
  JSON.stringify(kinds) === JSON.stringify(["routed", "pin_issued", "pin_failed", "pin_verified", "settled", "payout_sent"]),
  kinds.join(", "),
);
check("each event names who did it, except the payout function", trail.body.events.slice(0, 5).every((event) => event.actorSub) && !trail.body.events[5].actorSub);

const ledger = await call("GET", "/pickups", { query: { collectorId } });
check("the collector's ledger lists loads, not events", ledger.body.pickups.every((row) => !row.kind) && ledger.body.count >= 1, show(ledger));

/* ------------------------------------------------------------------ lockout */

section("Five wrong PINs lock the load; a new PIN unlocks it");
const second = await call("POST", "/pickups", { body: load() });
const lockId = second.body.pickup.pickupId;
const lockPin = second.body.handoff.pin;
let last = null;
for (let i = 0; i < 5; i += 1) {
  last = await call("POST", `/pickups/${lockId}/settle`, { body: { weighedMassG: 37500, pin: wrong(lockPin) } });
}
check("the fifth wrong PIN is a 423 pin_locked", last.status === 423 && last.body.error.code === "pin_locked", show(last));
const lockedRight = await call("POST", `/pickups/${lockId}/settle`, { body: { weighedMassG: 37500, pin: lockPin } });
check("once locked, even the right PIN is refused", lockedRight.status === 423, show(lockedRight));

const reissued = await call("POST", `/pickups/${lockId}/pin`);
check("a new PIN can be issued", reissued.status === 200 && /^\d{4}$/.test(reissued.body.handoff.pin), show(reissued));
check("and the counter is back to five", reissued.body.pickup.handoff.attemptsRemaining === 5);
if (reissued.body.handoff.pin !== lockPin) {
  const oldPin = await call("POST", `/pickups/${lockId}/settle`, { body: { weighedMassG: 37500, pin: lockPin } });
  check("the old PIN no longer works", oldPin.status === 403, show(oldPin));
}
const unlocked = await call("POST", `/pickups/${lockId}/settle`, { body: { weighedMassG: 36000, pin: reissued.body.handoff.pin } });
check("the new PIN settles", unlocked.status === 200, show(unlocked));
const reissueSettled = await call("POST", `/pickups/${lockId}/pin`);
check("a settled load cannot be given a new PIN", reissueSettled.status === 409, show(reissueSettled));

/* ------------------------------------------------------------------- expiry */

section("An expired PIN is refused");
const third = await call("POST", "/pickups", { body: load() });
const expiredId = third.body.pickup.pickupId;
await updateItem(
  process.env.PICKUP_TABLE_PICKUPS,
  { pickupId: expiredId, sk: "META" },
  { update: "SET pinExpiresAt = :past", values: { ":past": new Date(Date.now() - 1000).toISOString() } },
);
const expired = await call("POST", `/pickups/${expiredId}/settle`, { body: { weighedMassG: 37500, pin: third.body.handoff.pin } });
check("a PIN past its 15 minutes is a 410 pin_expired", expired.status === 410 && expired.body.error.code === "pin_expired", show(expired));
const expiredRead = await call("GET", `/pickups/${expiredId}`);
check("and the read says so", expiredRead.body.pickup.handoff.expired === true);

/* --------------------------------------------------------------- weight check */

section("Weight variance at the gate");
const fourth = await call("POST", "/pickups", { body: load() });
const heavy = await call("POST", `/pickups/${fourth.body.pickup.pickupId}/settle`, {
  body: { weighedMassG: 25000, pin: fourth.body.handoff.pin },
});
check("a load a third lighter than declared still settles, priced on the weighed mass", heavy.status === 200 && heavy.body.creditNote.amountPaise === priceLoad(leadAcid, 25000).amountPaise, show(heavy));
check("and is flagged for review", heavy.body.creditNote.flags.includes("mass_variance"), JSON.stringify(heavy.body.creditNote.flags));

console.log(`\n${passed} checks passed.`);
process.exit(0);
