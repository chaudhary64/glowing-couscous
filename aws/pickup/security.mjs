/**
 * Who is calling, and whether their role may use the route.
 *
 * The API is behind a Cognito JWT authorizer, so API Gateway has already proved the
 * token is signed by this pool, unexpired, and issued to this app client. What it
 * cannot know is *authority*: that is `lib/auth/roles.ts` in the app, and this module is
 * the same role set for the serverless half — same group names, one table, so a role
 * that opens `/pickups` in the product also opens `POST /pickups` here.
 *
 *   a route names the roles that may call it; a caller must hold one of them
 *
 * **A role set, not a rank.** This used to be a numeric ladder (`ROLE_RANK`,
 * `requireRole(event, minimum)`) — the same shape the app has just dropped. A ladder
 * cannot describe five roles: a Collector reads the map while an Operator writes the
 * board, so neither is "above" the other, and no ordering puts a Viewer on `/evidence`
 * without putting every Operator there too. A ladder on one side and a matrix on the
 * other is how you get a screen that renders a button the API then refuses, so this
 * half moved in the same release.
 *
 * `eco-owner` was folded into Admin in the app; its members read as Admin here too.
 *
 * **An absent token is refused, not assumed.** Invoking the function directly with
 * `aws lambda invoke` produces an event with no authorizer claims, and a handler that
 * treated "no claims" as "trusted internal caller" would be a handler that anyone with
 * `lambda:InvokeFunction` can drive without a token. It answers 401 instead.
 */

/**
 * The five role groups.
 *
 * The order is the app's display order and the tie-break: a user in several groups is
 * named by the first one here that they hold. It is not a ladder — nothing compares
 * positions, and `requireRole` is a membership test.
 */
export const ROLE_ORDER = [
  "eco-admin",
  "eco-officer",
  "eco-operator",
  "eco-collector",
  "eco-viewer",
];

/** Groups that no longer have a role of their own, and the role they now read as. */
const LEGACY_GROUPS = { "eco-owner": "eco-admin" };

/** Every role: what the reads the whole tenant shares need. */
export const ALL_ROLES = ROLE_ORDER;

/**
 * Field capture and transport — routing a load, and issuing its handoff PIN.
 *
 * The two writes that stay wider than the product's matrix are deliberate and are the
 * *additive* half of the deploy: an Operator may still settle a load here until the
 * release that stops showing an Operator the recycler gate ships, so no live caller is
 * locked out by a half-deploy. That release narrows `/settle` to Officer and Admin, and
 * the sets move with it.
 */
export const OPERATOR_ROLES = ["eco-admin", "eco-officer", "eco-operator"];

export function caller(event) {
  const claims = event?.requestContext?.authorizer?.jwt?.claims;
  if (!claims || typeof claims !== "object") {
    return {
      authenticated: false,
      sub: null,
      email: null,
      groups: [],
      roles: [],
      role: null,
    };
  }
  const groups = parseGroups(claims["cognito:groups"]);
  const held = new Set(groups.map(canonical));
  const roles = ROLE_ORDER.filter((role) => held.has(role));
  return {
    authenticated: true,
    sub: claims.sub ?? null,
    email: claims.email ?? claims["cognito:username"] ?? null,
    groups,
    roles,
    role: roles.length > 0 ? roles[0] : null,
  };
}

const canonical = (group) =>
  Object.prototype.hasOwnProperty.call(LEGACY_GROUPS, group) ? LEGACY_GROUPS[group] : group;

/**
 * HTTP API flattens custom claims to strings, and a group list arrives either as a JSON
 * array, a bracketed list or a comma-separated list depending on how it was produced.
 * All three are accepted rather than one being assumed, because a role check that reads
 * `[]` from a claim it did not expect fails closed in the wrong direction — it looks
 * like "no authority" when the token was fine.
 */
function parseGroups(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.map(String);
  const text = String(value).trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      // Not JSON. `[eco-operator]` is what a single-element claim looks like after
      // API Gateway flattens it, and it is not parseable as JSON at all — falling
      // through to the split below is the difference between a working role check and
      // a token that validates at the edge and is then refused by our own code.
    }
  }
  return text
    .split(",")
    .map((entry) => entry.trim().replace(/^\[|\]$/g, "").replace(/^"|"$/g, ""))
    .filter(Boolean);
}

/**
 * @param {unknown} event
 * @param {readonly string[]} allowed the roles this route may be called by
 * @returns `{ ok: true, caller }` or `{ ok: false, response }`, so the handler never has
 *   to remember which of "no token" and "no authority" is which.
 */
export function requireRole(event, allowed) {
  const who = caller(event);
  if (!who.authenticated) {
    return {
      ok: false,
      response: {
        statusCode: 401,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
        body: JSON.stringify({
          error: {
            code: "unauthenticated",
            message: "A Cognito token is required on every route of this API",
          },
        }),
      },
    };
  }
  // A caller holding a role the route does not name is refused, and so is a caller
  // holding none at all: "no group" is not a weaker role, it is no authority. An empty
  // `allowed` set therefore refuses everyone rather than admitting everyone, which is
  // the failure direction worth having.
  const permitted = who.roles.some((role) => allowed.includes(role));
  if (!permitted) {
    return {
      ok: false,
      response: {
        statusCode: 403,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
        body: JSON.stringify({
          error: {
            code: "forbidden",
            message: `This route needs one of: ${allowed.join(", ")}`,
            yourRole: who.role,
            yourRoles: who.roles,
            yourGroups: who.groups,
          },
        }),
      },
    };
  }
  return { ok: true, caller: who };
}
