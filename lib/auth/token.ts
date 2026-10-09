import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import { authConfig } from "./config";
import { rankOf, roleFromGroups, type Role } from "./roles";

/**
 * Turning a Cognito id token into the little a page needs to know.
 *
 * No `next/headers`, no React: the proxy and the data access layer both verify, and
 * neither should drag the other's dependencies in.
 *
 * Verification is real verification — signature against the pool's JWKS, plus
 * issuer, audience and expiry. It is not a decode. A cookie is attacker-controlled
 * input, and the only thing separating "officer" from "anyone with a text editor" is
 * this file.
 */

export const SESSION_COOKIE = "ecoepr.session";

export type AuthUser = {
  /** Cognito `sub` — the stable id that joins to `users.cognito_sub` in Postgres. */
  sub: string;
  email: string | null;
  name: string | null;
  /** Raw `cognito:groups`, kept for display so a multi-group user is not flattened. */
  groups: string[];
  role: Role | null;
  rank: number | null;
  /** Unix seconds, straight from the token. */
  expiresAt: number;
};

/**
 * The pool's key set, fetched once per server instance and cached.
 *
 * `cooldownDuration` stops a burst of requests with unknown `kid`s from hammering
 * Cognito's endpoint — the standard JWKS-refetch mistake.
 */
let keySet: ReturnType<typeof createRemoteJWKSet> | null = null;

function jwks(): ReturnType<typeof createRemoteJWKSet> {
  if (!keySet) {
    if (!authConfig.issuer) {
      throw new Error(
        "Cognito issuer is not configured: set COGNITO_ISSUER, or COGNITO_REGION and COGNITO_USER_POOL_ID.",
      );
    }
    keySet = createRemoteJWKSet(new URL(`${authConfig.issuer}/.well-known/jwks.json`), {
      cacheMaxAge: 10 * 60 * 1000,
      cooldownDuration: 30 * 1000,
    });
  }
  return keySet;
}

/** Cognito puts groups in an array; older pools have been seen to send one string. */
const groupsFromClaims = (claims: JWTPayload): string[] => {
  const raw = claims["cognito:groups"] as unknown;
  if (Array.isArray(raw)) return raw.filter((g): g is string => typeof g === "string");
  if (typeof raw === "string") return [raw];
  return [];
};

const stringClaim = (claims: JWTPayload, name: string): string | null => {
  const value = claims[name];
  return typeof value === "string" && value.length > 0 ? value : null;
};

/** Maps verified claims to the app's user shape. Pure, so it is trivially testable. */
export function userFromClaims(claims: JWTPayload): AuthUser {
  const groups = groupsFromClaims(claims);
  const role = roleFromGroups(groups);
  return {
    sub: String(claims.sub ?? ""),
    email: stringClaim(claims, "email"),
    name: stringClaim(claims, "name") ?? stringClaim(claims, "cognito:username"),
    groups,
    role,
    rank: role ? rankOf(role) : null,
    expiresAt: typeof claims.exp === "number" ? claims.exp : 0,
  };
}

/**
 * Verifies an id token against this pool, or returns null.
 *
 * Every failure path is null — expired, wrong audience, forged signature, a token
 * from a different pool, a value that is not a JWT at all. A caller cannot do
 * anything useful with the distinction, and the distinction is exactly what an
 * attacker would use to probe.
 */
export async function verifyIdToken(token: string): Promise<AuthUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, jwks(), {
      issuer: authConfig.issuer,
      audience: authConfig.clientId,
    });
    if (!payload.sub) return null;
    return userFromClaims(payload);
  } catch {
    return null;
  }
}
