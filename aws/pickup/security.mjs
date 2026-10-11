/**
 * Who is calling, and whether they outrank the route.
 *
 * The API is behind a Cognito JWT authorizer, so API Gateway has already proved the
 * token is signed by this pool, unexpired, and issued to this app client. What it
 * cannot know is *authority*: that is `lib/auth/roles.ts` in the app, and this module is
 * the same ladder for the serverless half — same group names, same order, one table, so
 * a role that opens `/pickups` in the product also opens `POST /pickups` here.
 *
 *   eco-admin ≤ eco-officer ≤ eco-operator ≤ eco-viewer
 *
 * `eco-owner` was folded into Admin in the app; its members read as Admin here too.
 *
 * Lower is more powerful, exactly as in the app: a user may do something when their
 * rank is ≤ the route's minimum.
 *
 * **An absent token is refused, not assumed.** Invoking the function directly with
 * `aws lambda invoke` produces an event with no authorizer claims, and a handler that
 * treated "no claims" as "trusted internal caller" would be a handler that anyone with
 * `lambda:InvokeFunction` can drive without a token. It answers 401 instead.
 */
export const ROLE_RANK = {
  "eco-owner": 2,
  "eco-admin": 2,
  "eco-officer": 3,
  "eco-operator": 4,
  "eco-viewer": 5,
};

/** Rank an operator-or-above route needs; the fixtures' `/pickups` minimum. */
export const OPERATOR = 4;
/** Rank any signed-in member of the tenant needs; the dashboard's minimum. */
export const ANY_ROLE = 5;

export function caller(event) {
  const claims = event?.requestContext?.authorizer?.jwt?.claims;
  if (!claims || typeof claims !== "object") {
    return {
      authenticated: false,
      sub: null,
      email: null,
      groups: [],
      rank: null,
      role: null,
    };
  }
  const groups = parseGroups(claims["cognito:groups"]);
  let role = null;
  let rank = null;
  for (const group of groups) {
    const candidate = ROLE_RANK[group];
    if (candidate === undefined) continue;
    if (rank === null || candidate < rank) {
      rank = candidate;
      role = group;
    }
  }
  return {
    authenticated: true,
    sub: claims.sub ?? null,
    email: claims.email ?? claims["cognito:username"] ?? null,
    groups,
    rank,
    role,
  };
}

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
 * @returns `{ ok: true, caller }` or `{ ok: false, response }`, so the handler never
 * has to remember which of "no token" and "no authority" is which.
 */
export function requireRole(event, minimum) {
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
  if (who.rank === null || who.rank > minimum) {
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
            message: `This route needs ${roleName(minimum)} or above`,
            yourRole: who.role,
            yourGroups: who.groups,
          },
        }),
      },
    };
  }
  return { ok: true, caller: who };
}

export function roleName(rank) {
  const found = Object.entries(ROLE_RANK).find(([, value]) => value === rank);
  return found ? found[0] : `rank ${rank}`;
}
