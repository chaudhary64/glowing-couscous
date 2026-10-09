import { assertAuthConfigured, authConfig, cognitoEndpoint } from "./config";

/**
 * The four Cognito operations this app needs, over the public JSON API.
 *
 * Deliberately not the AWS SDK: these are unauthenticated-by-IAM operations, so
 * signing them buys nothing and requires credentials the SSR runtime may not have.
 * `fetch` also keeps the whole auth surface readable in one file.
 */

export type SignInResult = {
  idToken: string;
  accessToken: string;
  /** Seconds, straight from Cognito. */
  expiresIn: number;
};

/**
 * Errors a form can act on. Anything unrecognised becomes `server`, because showing
 * a raw AWS error string to a collector helps nobody and tells an attacker plenty.
 */
export type AuthErrorCode =
  | "bad-credentials"
  | "unconfirmed"
  | "already-exists"
  | "weak-password"
  | "invalid-email"
  | "bad-code"
  | "expired-code"
  | "too-many"
  | "server";

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AuthError";
  }
}

type CognitoOperation =
  | "SignUp"
  | "ConfirmSignUp"
  | "ResendConfirmationCode"
  | "InitiateAuth";

const CODE_MAP: Record<string, AuthErrorCode> = {
  NotAuthorizedException: "bad-credentials",
  UserNotFoundException: "bad-credentials",
  UserNotConfirmedException: "unconfirmed",
  UsernameExistsException: "already-exists",
  AliasExistsException: "already-exists",
  InvalidPasswordException: "weak-password",
  InvalidParameterException: "invalid-email",
  CodeMismatchException: "bad-code",
  ExpiredCodeException: "expired-code",
  TooManyRequestsException: "too-many",
  TooManyFailedAttemptsException: "too-many",
  LimitExceededException: "too-many",
};

/** Calls one operation and turns Cognito's error envelope into an `AuthError`. */
async function call<T>(operation: CognitoOperation, body: Record<string, unknown>): Promise<T> {
  assertAuthConfigured();

  const response = await fetch(cognitoEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${operation}`,
    },
    body: JSON.stringify({ ClientId: authConfig.clientId, ...body }),
    // Never cached: these are credential-bearing requests.
    cache: "no-store",
  });

  const text = await response.text();
  let payload: unknown = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = {};
    }
  }

  if (!response.ok) {
    const type = String(
      (payload as { __type?: string }).__type ??
        response.headers.get("x-amzn-errortype") ??
        "",
    ).split(":")[0];
    const message = (payload as { message?: string }).message;
    throw new AuthError(CODE_MAP[type] ?? "server", message);
  }

  return payload as T;
}

/** Creates an account. Cognito emails a confirmation code; nothing is signed in yet. */
export async function signUp(input: {
  email: string;
  password: string;
  name: string;
}): Promise<void> {
  await call("SignUp", {
    Username: input.email,
    Password: input.password,
    // `name` is a writable attribute on the pool; email is the sign-in identifier.
    UserAttributes: [
      { Name: "email", Value: input.email },
      { Name: "name", Value: input.name },
    ],
  });
}

export async function confirmSignUp(email: string, code: string): Promise<void> {
  await call("ConfirmSignUp", {
    Username: email,
    ConfirmationCode: code.trim(),
  });
}

export async function resendConfirmationCode(email: string): Promise<void> {
  await call("ResendConfirmationCode", { Username: email });
}

/**
 * Signs in with `USER_PASSWORD_AUTH`, which the app client allows.
 *
 * The password travels from the browser to this server over TLS and then to Cognito
 * over TLS, and is never stored, logged or echoed back.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const result = await call<{
    AuthenticationResult?: {
      IdToken?: string;
      AccessToken?: string;
      ExpiresIn?: number;
    };
  }>("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    AuthParameters: { USERNAME: email, PASSWORD: password },
  });

  const auth = result.AuthenticationResult;
  if (!auth?.IdToken || !auth.AccessToken) {
    // A challenge (MFA, new password) with no result means the flow needs a step this
    // app does not implement. Failing loudly beats signing someone in half-way.
    throw new AuthError("server", "Cognito returned a challenge this app cannot complete.");
  }

  return {
    idToken: auth.IdToken,
    accessToken: auth.AccessToken,
    expiresIn: auth.ExpiresIn ?? 3600,
  };
}

/** The pool's own minimum: 8 characters, upper, lower and a digit is what it enforces. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (!/[a-z]/.test(password)) return "Add a lowercase letter.";
  if (!/[A-Z]/.test(password)) return "Add an uppercase letter.";
  if (!/[0-9]/.test(password)) return "Add a number.";
  return null;
}
