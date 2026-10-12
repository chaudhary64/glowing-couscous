import { and, asc, eq } from "drizzle-orm";

import { database, databaseConfigured } from "@/db/client";
import { FACILITIES } from "@/aws/pickup/catalogue.mjs";
import { collectors, facilities, organizationMembers, organizations, users } from "@/db/schema";
import { scopeFor, type Scope, type ScopeIdentity } from "@/lib/auth/scope";
import type { AuthUser } from "@/lib/auth/token";

/**
 * The read layer's half of `lib/auth/scope.ts`: the joins `scopeFor` deliberately does
 * not make.
 *
 * The token names a role and a subject. Which recycler facility an Officer works at, and
 * which brand a Viewer audits, are rows in `organization_members`, so they are resolved
 * here and handed to `scopeFor` as its `ScopeIdentity`. Every page and route that reads a
 * scoped row starts from `scopeForUser(user)`.
 *
 * Fails closed. No database, a failed read, or no membership on file all leave the
 * binding absent, and `scopeFor` turns an absent binding into `unresolved` — a sentence
 * on the screen, never a wider read.
 */

/** Only the two roles whose scope is a join need a query; the rest come off the token. */
async function scopeIdentity(user: AuthUser): Promise<ScopeIdentity> {
  if (user.role !== "eco-officer" && user.role !== "eco-viewer") return {};
  if (!databaseConfigured()) return {};
  const connection = database();
  if (!connection) return {};

  try {
    const { db } = connection;
    if (user.role === "eco-viewer") {
      const [row] = await db
        .select({ organizationId: organizationMembers.organizationId })
        .from(organizationMembers)
        .innerJoin(users, eq(users.id, organizationMembers.userId))
        .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
        .where(
          and(
            eq(users.cognitoSub, user.sub),
            eq(organizationMembers.role, "viewer"),
            eq(organizations.kind, "brand"),
          ),
        )
        .orderBy(asc(organizationMembers.createdAt))
        .limit(1);
      return { organizationId: row?.organizationId ?? null };
    }

    // An Officer is bound to the recycler that employs them, and through it to one site.
    // A recycler with several sites needs the site on the membership itself; until then
    // the oldest active site stands for it.
    //
    // The scope carries the pickup service's id for that site (`RX-03`), not the row's
    // uuid: the only reads a facility scope cuts are the load board and the recycler
    // directory, and both key a site by the service's id. The two records share the
    // site's CPCB licence, so that is the join; a site whose licence the service does
    // not list resolves to nothing, and the scope stays unresolved.
    const [row] = await db
      .select({ licenseNo: facilities.licenseNo })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .innerJoin(facilities, eq(facilities.organizationId, organizations.id))
      .where(
        and(
          eq(users.cognitoSub, user.sub),
          eq(organizationMembers.role, "officer"),
          eq(organizations.kind, "recycler"),
          eq(facilities.active, true),
        ),
      )
      .orderBy(asc(facilities.createdAt))
      .limit(1);
    const site = row?.licenseNo ? FACILITIES.find((facility) => facility.cpcbLicense === row.licenseNo) : undefined;
    return { facilityId: site?.id ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[db] resolving the scope identity failed", message.replace(/\s+/g, " ").slice(0, 200));
    return {};
  }
}

/** The scope a signed-in user reads with, bindings resolved. */
export async function scopeForUser(user: AuthUser): Promise<Scope> {
  return scopeFor(user, await scopeIdentity(user));
}

/** What a reader says when a Collector's account has no collector record behind it. */
export const COLLECTOR_NOT_LINKED =
  "This account is not linked to a collector record yet, so no submission or load is attributed to it. Once a submission carries the collector who made it, it appears here.";

/**
 * The `collectors.id` a Collector's account stands for, or null when none is on file.
 *
 * `collectors.user_id` is the link: a collector is onboarded without an account, and the
 * row gains one when that person signs in for themselves. It is the same id a load
 * carries as `collectorId`, because the handoff routes a load with `items.collector_id`.
 */
export async function collectorIdFor(
  cognitoSub: string,
): Promise<{ configured: boolean; id: string | null; error: string | null }> {
  if (!databaseConfigured()) return { configured: false, id: null, error: null };
  const connection = database();
  if (!connection) return { configured: false, id: null, error: null };
  try {
    const [row] = await connection.db
      .select({ id: collectors.id })
      .from(collectors)
      .innerJoin(users, eq(users.id, collectors.userId))
      .where(eq(users.cognitoSub, cognitoSub))
      .limit(1);
    return { configured: true, id: row?.id ?? null, error: null };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim();
    console.error("[db] resolving the collector record failed", message);
    return { configured: true, id: null, error: message.slice(0, 200) };
  }
}
