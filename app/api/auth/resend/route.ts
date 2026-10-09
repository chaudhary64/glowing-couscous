import { AuthError, resendConfirmationCode } from "@/lib/auth/cognito";
import {
  backToForm,
  isSameOriginPost,
  redirectTo,
} from "@/lib/auth/form";
import { pendingEmail } from "@/lib/auth/session";

/**
 * Send the confirmation code again.
 *
 * A separate endpoint from `confirm` rather than a second button on the same form:
 * resending and confirming are different operations with different failure modes, and
 * a code that expired needs the resend without a code to submit.
 *
 * Like `confirm`, the address is the cookie's — never a posted value. Without it this
 * endpoint would be an open relay for Cognito's confirmation email.
 */

export async function POST(request: Request) {
  if (!isSameOriginPost(request)) {
    return redirectTo("/confirm?error=csrf");
  }

  const email = await pendingEmail();
  if (!email) {
    return redirectTo("/confirm?error=expired");
  }

  try {
    await resendConfirmationCode(email);
  } catch (error) {
    const failure = error instanceof AuthError ? error.code : "server";
    return backToForm("/confirm", { error: failure });
  }

  return backToForm("/confirm", { notice: "resent" });
}
