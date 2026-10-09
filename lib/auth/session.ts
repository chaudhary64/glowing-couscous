import { cookies } from "next/headers";

import { SESSION_COOKIE, verifyIdToken, type AuthUser } from "./token";

/**
 * The session is the id token, in an httpOnly cookie.
 *
 * Only the **id** token is kept, not the access or refresh token. The id token is
 * what carries `sub`, `email` and `cognito:groups`, and it expires in an hour. A
 * refresh token would buy longer sessions at the cost of a 30-day credential sitting
 * in the browser, and nothing here refreshes it — the honest version is a one-hour
 * session whose cookie is cleared on sign-out, with refresh (and `RevokeToken` on the
 * way out) as the next step. See docs/auth.md.
 *
 * `httpOnly` is the whole point: no script can read the token, so an XSS bug in a
 * screen cannot walk off with the user's identity.
 */

const FIFTEEN_MINUTES = 15 * 60;

/**
 * The address a confirmation code was just sent to.
 *
 * Held in an httpOnly cookie rather than in the query string: an email address in a
 * URL is written to every proxy log between here and the browser, and travels on in
 * the `Referer` header. Nothing secret is in it — the code still has to be typed — but
 * it does not need to be public either.
 */
const PENDING_COOKIE = "ecoepr.pending";

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge,
});

/**
 * Writes the session cookie. Only legal in a Route Handler or Server Function —
 * Server Components cannot set cookies, which is why sign-in goes through an API
 * route rather than a form embedded in a page.
 */
export async function startSession(idToken: string, expiresInSeconds: number): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, idToken, cookieOptions(Math.max(60, expiresInSeconds)));
}

export async function endSession(): Promise<void> {
  const store = await cookies();
  // `delete` is what emits the expired cookie; a `set` with maxAge 0 alongside it is
  // dropped, so it would only look like it did something.
  store.delete(SESSION_COOKIE);
  store.delete(PENDING_COOKIE);
}

/** Remembers the address awaiting a confirmation code, for `/confirm` to read. */
export async function rememberPendingEmail(email: string): Promise<void> {
  const store = await cookies();
  store.set(PENDING_COOKIE, email, cookieOptions(FIFTEEN_MINUTES));
}

/**
 * The pending address, or null.
 *
 * Deliberately **not** validated as an email here: it is only ever compared against
 * what Cognito already knows, so a forged value buys nothing and an unrecognised one
 * fails at the confirmation call with the same message as a wrong code.
 */
export async function pendingEmail(): Promise<string | null> {
  const store = await cookies();
  return store.get(PENDING_COOKIE)?.value || null;
}

export async function forgetPendingEmail(): Promise<void> {
  const store = await cookies();
  store.delete(PENDING_COOKIE);
}

/**
 * The signed-in user, or null.
 *
 * Reads the cookie and verifies the token on every call. There is no in-memory
 * cache: with `cacheComponents` a verified user is exactly the kind of value that
 * must not leak between requests.
 */
export async function getSession(): Promise<AuthUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyIdToken(token);
}
