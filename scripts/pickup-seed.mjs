/**
 * Write the smart-pickup catalogue into DynamoDB.
 *
 * `aws/pickup/catalogue.mjs` is the source of truth for two tables' worth of data:
 * the material streams with their rates and hazard classes, the licensed facilities,
 * and — the part that decides every route — which stream each facility is actually
 * authorised for.
 *
 * The seeder **converges** the table rather than adding to it: every item it expects is
 * written, and every item that is not expected is deleted. Re-running it after a licence
 * lapses is then the way to revoke a route, and there is no state where the table is
 * half the catalogue because a previous run was interrupted. Deleting is safe here in a
 * way it is not for pickups: this table is configuration, and nothing references its
 * rows.
 *
 * Usage:
 *   node --env-file=.env.local scripts/pickup-seed.mjs
 *
 * It reads `PICKUP_TABLE_RECYCLERS`, which `scripts/pickup-setup.sh` writes into
 * `.env.local`. It never touches `PICKUP_TABLE_PICKUPS` or `PICKUP_TABLE_CREDIT_NOTES`.
 */
import { FACILITIES, RATE_BASIS, STREAMS } from "../aws/pickup/catalogue.mjs";
import { deleteItem, putItem, scan } from "../aws/pickup/dynamo.mjs";

const table = process.env.PICKUP_TABLE_RECYCLERS?.trim();
if (!table) {
  console.error(
    "PICKUP_TABLE_RECYCLERS is not set. Run `bash scripts/pickup-setup.sh` first, " +
      "which writes it into .env.local, or export it in the shell.",
  );
  process.exit(1);
}

const region = process.env.PICKUP_REGION ?? process.env.AWS_REGION ?? "(default chain)";
console.log(`Seeding ${table} in ${region}`);

const key = (item) => `${item.pk}\u0000${item.sk}`;

/* --------------------------------------------------------------------- plan */

const streamItems = STREAMS.map((stream) => ({
  pk: `STREAM#${stream.code}`,
  sk: "META",
  type: "stream",
  catalogueKey: "STREAM",
  code: stream.code,
  label: stream.label,
  labelHi: stream.labelHi ?? null,
  hazardous: stream.hazardous,
  ratePaisePerKg: stream.ratePaisePerKg,
  handlingPaisePerKg: stream.handlingPaisePerKg,
  rateBasis: RATE_BASIS,
}));

const facilityItems = FACILITIES.map((facility) => ({
  pk: `FACILITY#${facility.id}`,
  sk: "META",
  type: "facility",
  catalogueKey: "FACILITY",
  code: facility.id,
  facilityId: facility.id,
  name: facility.name,
  cpcbLicense: facility.cpcbLicense,
  city: facility.city,
  capacityKgPerDay: facility.capacityKgPerDay,
  slaHours: facility.slaHours,
  reuseOnly: facility.reuseOnly,
  active: facility.active,
}));

const authorizationItems = FACILITIES.flatMap((facility) =>
  facility.streams.map((entry) => ({
    pk: `FACILITY#${facility.id}`,
    sk: `STREAM#${entry.stream}`,
    type: "authorization",
    stream: entry.stream,
    facilityId: facility.id,
    // The authorisation item carries a copy of the facility's facts on purpose: the
    // routing query reads the stream index and nothing else, so one Query answers
    // "who may take this, and can they today" instead of one query plus N reads. The
    // cost is that a facility's name lives in several places, and this seeder is the
    // only writer of all of them.
    facilityName: facility.name,
    cpcbLicense: facility.cpcbLicense,
    city: facility.city,
    slaHours: facility.slaHours,
    reuseOnly: facility.reuseOnly,
    active: facility.active,
    // The site ceiling, unless this stream has a tighter one of its own — one licensed
    // battery bench inside a large site is the normal case, not an exception.
    capacityKgPerDay: entry.capacityKgPerDay ?? facility.capacityKgPerDay,
    capacityIsPerStream: entry.capacityKgPerDay !== undefined,
    accepted: entry.accepted,
    hazardousAuthorized: entry.hazardousAuthorized,
    note: entry.note ?? null,
  })),
);

const planned = [...streamItems, ...facilityItems, ...authorizationItems];
const expected = new Set(planned.map(key));

/* -------------------------------------------------------------------- write */

for (const item of planned) {
  await putItem(table, item);
}
console.log(
  `Wrote ${planned.length} items (${STREAMS.length} streams, ${FACILITIES.length} facilities, ${authorizationItems.length} authorisations)`,
);

/* -------------------------------------------------------------------- prune */

const present = await scan(table);
let pruned = 0;
for (const row of present) {
  const rowKey = key(row);
  if (expected.has(rowKey)) continue;
  await deleteItem(table, { pk: row.pk, sk: row.sk });
  pruned += 1;
  console.log(`  removed ${row.pk} / ${row.sk} (no longer in the catalogue)`);
}
console.log(
  pruned === 0
    ? "Nothing to prune: the table matches the catalogue"
    : `Pruned ${pruned} item(s)`,
);
console.log("Done.");
