import { AuthError, passwordProblem, signUp } from "@/lib/auth/cognito";
import {
  backToForm,
  emailField,
  field,
  isSameOriginPost,
  rawField,
  redirectTo,
} from "@/lib/auth/form";
import { rememberPendingEmail } from "@/lib/auth/session";

/**
 * Create an account.
 *
 * Sign-up deliberately ends at the confirmation screen and does not sign anybody in.
 * Cognito will not issue a token for an unconfirmed user, and the alternative —
 * holding the password in a cookie so the user can be signed in after confirming —
 * would mean putting a plaintext credential in a cookie to save one form.
 *
 * The password rules are checked here as well as by the pool. Cognito answers a weak
 * password with `InvalidPasswordException` and no explanation, which is a dead end on
 * a form; the local check exists to reject early, and the copy explains the rule.
 */

export async function POST(request: Request) {
  if (!isSameOriginPost(request)) {
    return redirectTo("/signup?error=csrf");
  }

  const form = await request.formData();
  const name = field(form, "name");
  const email = emailField(form);
  const password = rawField(form, "password");
  const confirm = rawField(form, "confirm");

  if (!name || !email || !password || !confirm) {
    return backToForm("/signup", { error: "missing" });
  }

  if (password !== confirm) {
    return backToForm("/signup", { error: "mismatch" });
  }

  if (passwordProblem(password)) {
    return backToForm("/signup", { error: "weak-password" });
  }

  try {
    await signUp({ email, password, name });
  } catch (error) {
    const code = error instanceof AuthError ? error.code : "server";
    return backToForm("/signup", { error: code });
  }

  // The address is remembered so `/confirm` can resend to it without putting an email
  // address in the URL, and so the code cannot be confirmed against a different one.
  await rememberPendingEmail(email);
  return backToForm("/confirm", { notice: "code-sent" });
}
