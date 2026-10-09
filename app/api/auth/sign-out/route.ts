import { isSameOriginPost, redirectTo } from "@/lib/auth/form";
import { endSession } from "@/lib/auth/session";

/**
 * Sign out.
 *
 * POST only. A GET sign-out is the classic mistake: any `<img src>` on any page can
 * fire one, so a hostile page could silently log a user out — harmless on its own,
 * and a neat denial-of-service against a flow that expects a session to persist.
 *
 * Clearing the cookie is the whole of it. Cognito's own session — the refresh token on
 * the client — is not used by this app, so there is nothing else to revoke. When
 * refresh tokens are added, this is the hook that must call `RevokeToken`, and the
 * comment is here so that change is not missed.
 */

export async function POST(request: Request) {
  if (!isSameOriginPost(request)) {
    return redirectTo("/");
  }

  await endSession();
  return redirectTo("/login?notice=signed-out");
}
