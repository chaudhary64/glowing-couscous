import { AuthError, confirmSignUp } from "@/lib/auth/cognito";
import { backToForm, field, isSameOriginPost, redirectTo } from "@/lib/auth/form";
import { forgetPendingEmail, pendingEmail } from "@/lib/auth/session";

/**
 * Exchange the emailed code for a confirmed account.
 *
 * The address comes from the httpOnly cookie set at sign-up, never from the form. A
 * hidden `email` field is a value the browser chooses, and a confirmation is exactly
 * the call an attacker would want to aim at somebody else's address.
 *
 * Success does not mean signed in: Cognito issues no token for this flow, and the
 * password is not held anywhere to follow up with. The user is sent to sign in, which
 * also proves the password they typed a moment ago is the one they remember.
 */

export async function POST(request: Request) {
  if (!isSameOriginPost(request)) {
    return redirectTo("/confirm?error=csrf");
  }

  const email = await pendingEmail();
  if (!email) {
    return redirectTo("/confirm?error=expired");
  }

  const form = await request.formData();
  const code = field(form, "code");

  if (!code) {
    return backToForm("/confirm", { error: "missing" });
  }

  try {
    await confirmSignUp(email, code);
  } catch (error) {
    const failure = error instanceof AuthError ? error.code : "server";
    return backToForm("/confirm", { error: failure });
  }

  await forgetPendingEmail();
  return backToForm("/login", { notice: "confirmed" });
}
