import { NextResponse, type NextRequest } from "next/server";

import { canOpen, isAuthPage, isPublicPath } from "@/lib/auth/roles";
import { SESSION_COOKIE, verifyIdToken } from "@/lib/auth/token";

/**
 * Proxy (Next.js 16's name for middleware), running before any route renders.
 *
 * Two jobs, both optimistic:
 *   1. Someone with no valid session never sees a product shell — they go to sign in,
 *      and the path they wanted comes back with them.
 *   2. Someone signed in without the authority for a page is sent to `/no-access`
 *      with the requirement spelled out, instead of reaching a screen that then
 *      refuses to render.
 *
 * This is **not** the authorization boundary. Anything that does not pass through the
 * proxy — a prefetch, a direct RSC request, a future job — would skip it, so every
 * protected page re-checks through `requireAccess()` in the data access layer. The
 * token is verified here as well as there, because a redirect decision made on an
 * unverified cookie would be guesswork.
 */

const NO_ACCESS = "/no-access";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Sign-in and sign-up are pointless once you hold a session, and `/confirm` is only
  // ever reached before one exists. Note that this bounces a signed-in user who holds
  // *no* role as well: leaving them on the form would offer a second session for the
  // same identity, and a form they can never complete. Sending them to `/dashboard`
  // hands them to the guard, which explains the missing role on `/no-access` and offers
  // a way out. It is deliberately not `/` any more: the root is the public landing page
  // and would not run the guard at all.
  if (isAuthPage(pathname)) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const user = token ? await verifyIdToken(token) : null;
    if (user) return NextResponse.redirect(new URL("/dashboard", request.url));
    return NextResponse.next();
  }

  // `/`, `/doc` and the feature write-ups are public on purpose.
  if (isPublicPath(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const user = token ? await verifyIdToken(token) : null;

  if (!user) {
    const signIn = new URL("/login", request.url);
    signIn.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(signIn);
  }

  // `/no-access` is reachable by any signed-in user, role or not — it is the page
  // that explains why they were stopped, so it must not stop them itself.
  if (pathname === NO_ACCESS) return NextResponse.next();

  const verdict = canOpen(pathname, user.role);
  if (!verdict.ok) {
    const refused = new URL(NO_ACCESS, request.url);
    refused.searchParams.set("from", pathname);
    refused.searchParams.set("need", verdict.guard.requirement);
    refused.searchParams.set("why", verdict.reason);
    return NextResponse.redirect(refused);
  }

  return NextResponse.next();
}

export const config = {
  // API routes authorize themselves; static assets never need a session. `vendor/` is
  // MapLibre's web worker (scripts/vendor-maplibre.mjs): the browser fetches it from a
  // worker without the page's navigation, and a redirect to /login breaks the map.
  // `models/` is the landing page's 3D board, which a signed-out visitor must load.
  // `geo/` is public boundary data (India's districts) the map fetches from its worker.
  matcher: ["/((?!api|_next|vendor/|models/|geo/|favicon.ico).*)"],
};
