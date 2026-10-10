import { connection } from "next/server";
import { redirect } from "next/navigation";

import { canOpen } from "./roles";
import { getSession } from "./session";
import type { AuthUser } from "./token";

/**
 * The data access layer — where authorization actually happens.
 *
 * The proxy's redirects are optimistic: they run before a route is rendered, they
 * keep unauthorised users from ever seeing a shell, and they can be bypassed by
 * anything that does not go through the proxy (a prefetch, a direct RSC request, a
 * future background job). So the check that counts lives here, next to the data, and
 * every protected page calls it.
 *
 * See the Next.js authorization guide: "checks performed in Proxy should be
 * optimistic, and the majority of security checks should be performed as close as
 * possible to your data source."
 */

export async function getCurrentUser(): Promise<AuthUser | null> {
  return getSession();
}

/** The signed-in user, or a redirect to sign in that remembers where they were going. */
export async function requireUser(nextPath: string): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) {
    const target = nextPath && nextPath.startsWith("/") ? nextPath : "/";
    redirect(`/login?next=${encodeURIComponent(target)}`);
  }
  return user;
}

/**
 * The signed-in user, and proof they may open this path.
 *
 * A user with no group gets the same treatment as one with too little authority:
 * both land on `/no-access`, which names the requirement rather than pretending the
 * page does not exist. Silence would be worse — a collector who was told to look at
 * the validation queue deserves to be told why they cannot.
 */
export async function requireAccess(pathname: string): Promise<AuthUser> {
  /*
    Rendering stops here, before the session is verified.

    Verifying an id token reads the clock — jose checks `exp` — and under
    `cacheComponents` the framework tries to prerender a shell for every route, so each
    guarded page was reporting `blocking-prerender-current-time` on every authenticated
    render. A page that needs a session cannot be prerendered at all, and this is where
    that belongs: every protected page already calls this function, so the statement is
    made once rather than in sixteen page bodies. `await connection()` is the documented
    way to say it and changes no behaviour — these routes read cookies already, so none
    of them was ever static.
  */
  await connection();
  const user = await requireUser(pathname);
  const verdict = canOpen(pathname, user.role);

  if (!verdict.ok) {
    const params = new URLSearchParams({
      from: pathname,
      need: verdict.guard.requirement,
      why: verdict.reason,
    });
    redirect(`/no-access?${params.toString()}`);
  }

  return user;
}
