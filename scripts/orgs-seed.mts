/**
 * Link the demo Officer and Viewer to the organisations their scope is read through.
 *
 * `lib/records/scope.ts` resolves an Officer's facility and a Viewer's brand from
 * `organization_members`, and fails closed when no membership is on file — which is every
 * demo account until this runs, so both seats read "not linked" on every scoped screen.
 * This writes the smallest set of rows that gives each seat something real to read:
 *
 *   - a recycler organisation and one active facility standing for the pickup service's
 *     RX-03, with demo.officer as its officer;
 *   - a brand organisation, with demo.viewer as its viewer, and one EPR credit note
 *     claiming a verified item already on file, so the Viewer's evidence and dashboard
 *     have a claim to read.
 *
 * Every name here is invented, and every row says so: organisation names end in
 * "(seed)", `legal_name` and `notes` name this script, and the credit note's code starts
 * EPR-SEED. Anyone reading the shared database later can find and remove them by that.
 *
 * It **converges**, like `rates-seed.mts`: each row is found by its natural key first and
 * written only when missing, so re-running it changes nothing. Without `--apply` it only
 * prints what it would write.
 *
 * Usage:
 *   npm run orgs:seed               show the plan, write nothing
 *   npm run orgs:seed -- --apply    write it
 */
import { and, eq } from "drizzle-orm";

import { FACILITIES } from "@/aws/pickup/catalogue.mjs";
import { closeDatabase, database } from "@/db/client";
import {
  eprCreditNotes,
  facilities,
  items,
  organizationMembers,
  organizations,
  users,
  valuations,
} from "@/db/schema";

const APPLY = process.argv.includes("--apply");

const RECYCLER_SITE = "RX-03";
const OFFICER_EMAIL = "demo.officer@example.com";
const BRAND_NAME = "Example Electronics (seed)";
const RECYCLER_NAME = "Example Recyclers Pune (seed)";
const SEED_MARK = "Seed data from scripts/orgs-seed.mts. Not a real company.";
const NOTE_CODE = "EPR-SEED-0001";
const VIEWER_EMAIL = "demo.viewer@example.com";
/** A gatekeeper-verified item with its photo archived, priced on 11 Oct 2026. */
const CLAIMED_ITEM = "LIVE-2026-43803982";
const COMPLIANCE_PERIOD = "2026-10-01";

const connection = database();
if (!connection) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in, or export it in the shell.");
  process.exit(1);
}
const { db } = connection;
const site = FACILITIES.find((facility) => facility.id === RECYCLER_SITE);
if (!site) throw new Error(`${RECYCLER_SITE} is not in aws/pickup/catalogue.mjs`);

const userId = async (email: string) => {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!row) throw new Error(`${email} has no users row yet; sign in with it once first`);
  return row.id;
};

const plan: string[] = [];
const say = (line: string) => {
  plan.push(line);
  console.log(`${APPLY ? "write" : "would write"}  ${line}`);
};
const exists = (line: string) => console.log(`exists       ${line}`);

/* ------------------------------------------------------------------ officer */

const officerId = await userId(OFFICER_EMAIL);
let [recycler] = await db
  .select({ id: organizations.id })
  .from(organizations)
  .where(eq(organizations.cpcbRegistrationNo, site.cpcbLicense))
  .limit(1);
const recyclerRow = {
  kind: "recycler" as const,
  name: RECYCLER_NAME,
  legalName: SEED_MARK,
  cpcbRegistrationNo: site.cpcbLicense,
  city: site.city,
};
if (recycler) exists(`organizations  recycler "${RECYCLER_NAME}" (${site.cpcbLicense})`);
else {
  say(`organizations  ${JSON.stringify(recyclerRow)}`);
  if (APPLY) [recycler] = await db.insert(organizations).values(recyclerRow).returning({ id: organizations.id });
}

const [facility] = recycler
  ? await db
      .select({ id: facilities.id })
      .from(facilities)
      .where(and(eq(facilities.organizationId, recycler.id), eq(facilities.licenseNo, site.cpcbLicense)))
      .limit(1)
  : [];
const facilityRow = {
  name: RECYCLER_NAME,
  kind: "recycling" as const,
  licenseNo: site.cpcbLicense,
  city: site.city,
  capacityGPerDay: String(site.capacityKgPerDay * 1000),
  slaHours: site.slaHours,
  active: true,
  notes: `${SEED_MARK} Stands for the pickup service's ${site.id}; the officer's scope joins the two on the licence.`,
};
if (facility) exists(`facilities     "${RECYCLER_NAME}" (${site.cpcbLicense})`);
else {
  say(`facilities     ${JSON.stringify({ organizationId: "<recycler>", ...facilityRow })}`);
  if (APPLY && recycler) await db.insert(facilities).values({ organizationId: recycler.id, ...facilityRow });
}

const membership = async (organizationId: string | undefined, memberId: string, role: "officer" | "viewer", label: string) => {
  const [row] = organizationId
    ? await db
        .select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, memberId)))
        .limit(1)
    : [];
  if (row) return exists(`organization_members  ${label} as ${row.role}`);
  say(`organization_members  ${JSON.stringify({ organizationId: "<org>", userId: memberId, role, joinedAt: "now" })}  (${label})`);
  if (APPLY && organizationId)
    await db.insert(organizationMembers).values({ organizationId, userId: memberId, role, joinedAt: new Date() }).onConflictDoNothing();
};
await membership(recycler?.id, officerId, "officer", `${OFFICER_EMAIL} → ${RECYCLER_NAME}`);

/* ------------------------------------------------------------------- viewer */

const viewerId = await userId(VIEWER_EMAIL);
let [brand] = await db
  .select({ id: organizations.id })
  .from(organizations)
  .where(and(eq(organizations.kind, "brand"), eq(organizations.name, BRAND_NAME)))
  .limit(1);
const brandRow = { kind: "brand" as const, name: BRAND_NAME, legalName: SEED_MARK };
if (brand) exists(`organizations  brand "${BRAND_NAME}"`);
else {
  say(`organizations  ${JSON.stringify(brandRow)}`);
  if (APPLY) [brand] = await db.insert(organizations).values(brandRow).returning({ id: organizations.id });
}
await membership(brand?.id, viewerId, "viewer", `${VIEWER_EMAIL} → ${BRAND_NAME}`);

const [item] = await db
  .select({ id: items.id, brand: items.brand, massG: items.massG, credit: valuations.eprCreditPaise })
  .from(items)
  .innerJoin(valuations, eq(valuations.itemId, items.id))
  .where(eq(items.code, CLAIMED_ITEM))
  .limit(1);
if (!item) throw new Error(`${CLAIMED_ITEM} is not on file`);
const [note] = await db
  .select({ code: eprCreditNotes.code })
  .from(eprCreditNotes)
  .where(eq(eprCreditNotes.itemId, item.id))
  .limit(1);
const noteRow = {
  code: NOTE_CODE,
  itemId: item.id,
  category: "precious" as const,
  massG: item.massG,
  creditedPaise: item.credit,
  status: "created" as const,
  compliancePeriod: COMPLIANCE_PERIOD,
  notes: `${SEED_MARK} Gives the demo Viewer one claim to read; the item's own valuation set the amount.`,
};
if (note) exists(`epr_credit_notes  ${note.code} on ${CLAIMED_ITEM}`);
else {
  say(`epr_credit_notes  ${JSON.stringify({ ...noteRow, brandOrganizationId: "<brand>" })}  (${CLAIMED_ITEM}, brand read "${item.brand}")`);
  if (APPLY && brand) await db.insert(eprCreditNotes).values({ ...noteRow, brandOrganizationId: brand.id }).onConflictDoNothing();
}

console.log(plan.length === 0 ? "\nNothing to write: every row is already on file." : APPLY ? `\nWrote ${plan.length} rows.` : `\n${plan.length} rows to write. Re-run with --apply to write them.`);
await closeDatabase();
