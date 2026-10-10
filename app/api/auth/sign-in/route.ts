import { AuthError, signIn } from "@/lib/auth/cognito";
import {
  backToForm,
  emailField,
  isSameOriginPost,
  rawField,
  redirectTo,
  safeNext,
} from "@/lib/auth/form";
import { rememberPendingEmail, startSession } from "@/lib/auth/session";
import { verifyIdToken } from "@/lib/auth/token";
import { provisionUser } from "@/lib/records/users";

/**
 * Sign in.
 *
 * A plain HTML form POST rather than a Server Action, for one reason that decides it:
 * the seat of the session is a cookie, and only a Route Handler or a Server Function
 * may set one. A route handler also keeps the whole flow drivable from a terminal,
 * which is how it gets tested here.
 *
 * Order matters. The origin check comes first, before the body is even parsed — a
 * cross-site post should not get as far as costing a Cognito call. The session is
 * written only after Cognito has answered, so a failed attempt leaves no cookie
 * behind to be believed by the proxy.
 */

export async function POST(request: Request) {
  if (!isSameOriginPost(request)) {
    return redirectTo("/login?error=csrf");
  }

  const form = await request.formData();
  const email = emailField(form);
  // Not trimmed: a leading or trailing space is a legitimate password character.
  const password = rawField(form, "password");
  const next = safeNext(String(form.get("next") ?? ""));
  const keep = next === "/" ? undefined : next;

  if (!email || !password) {
    return backToForm("/login", { error: "missing", next: keep });
  }

  try {
    const result = await signIn(email, password);
    // The user row is written here and nowhere else, because this is the one moment a
    // freshly verified id token is in hand. Attribution columns across the schema —
    // a decision's decider, a submission's uploader — join through `users.cognito_sub`,
    // and nothing provisioned one before this. Non-fatal by construction: provisioning
    // failing must not turn a successful sign-in into a lockout.
    const session = await verifyIdToken(result.idToken);
    if (session) await provisionUser(session);
    await startSession(result.idToken, result.expiresIn);
  } catch (error) {
    const code = error instanceof AuthError ? error.code : "server";

    // An unconfirmed account is the one failure with a next step, and the password
    // just proved the address belongs to the person typing it — so it is safe, and
    // useful, to carry the address over to the confirmation form.
    if (code === "unconfirmed") {
      await rememberPendingEmail(email);
      return backToForm("/confirm", { error: code });
    }

    return backToForm("/login", { error: code, next: keep });
  }

  return redirectTo(next);
}
