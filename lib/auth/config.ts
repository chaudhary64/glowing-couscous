/**
 * Cognito settings, read once.
 *
 * Both the public and the private variable name for each value is accepted, so the
 * server half works whether it was configured with `COGNITO_*` (as `.env.local` and
 * the Amplify app do) or only with the `NEXT_PUBLIC_*` pair the browser needs.
 *
 * Nothing here throws at import time. A missing value has to fail at the moment a
 * request needs it, not while `next build` is evaluating modules — otherwise a
 * deploy without env vars breaks the build instead of one route.
 */

const fromEnv = (...names: string[]): string => {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return "";
};

export const authConfig = {
  region: fromEnv("COGNITO_REGION", "NEXT_PUBLIC_COGNITO_REGION"),
  userPoolId: fromEnv("COGNITO_USER_POOL_ID", "NEXT_PUBLIC_COGNITO_USER_POOL_ID"),
  clientId: fromEnv("COGNITO_CLIENT_ID", "NEXT_PUBLIC_COGNITO_CLIENT_ID"),

  /** Derived from the pool when not set explicitly; both must agree or tokens are rejected. */
  issuer:
    fromEnv("COGNITO_ISSUER") ||
    (() => {
      const region = fromEnv("COGNITO_REGION", "NEXT_PUBLIC_COGNITO_REGION");
      const pool = fromEnv("COGNITO_USER_POOL_ID", "NEXT_PUBLIC_COGNITO_USER_POOL_ID");
      return region && pool ? `https://cognito-idp.${region}.amazonaws.com/${pool}` : "";
    })(),
};

/**
 * The Cognito JSON endpoint.
 *
 * Called with `fetch` rather than the AWS SDK on purpose: `InitiateAuth`,
 * `SignUp`, `ConfirmSignUp` and `ResendConfirmationCode` are **public** operations
 * authenticated by the app client id, not by IAM. The SDK would try to resolve AWS
 * credentials and sign them, which fails anywhere credentials are absent — including
 * a Next server that has no ambient role — for no security benefit.
 */
export const cognitoEndpoint = (): string =>
  authConfig.region ? `https://cognito-idp.${authConfig.region}.amazonaws.com/` : "";

/** Which values are missing, for an error message that names them. */
export function missingAuthConfig(): string[] {
  const missing: string[] = [];
  if (!authConfig.region) missing.push("COGNITO_REGION");
  if (!authConfig.userPoolId) missing.push("COGNITO_USER_POOL_ID");
  if (!authConfig.clientId) missing.push("COGNITO_CLIENT_ID");
  return missing;
}

export function assertAuthConfigured(): void {
  const missing = missingAuthConfig();
  if (missing.length > 0) {
    throw new Error(
      `Cognito is not configured: missing ${missing.join(", ")}. See .env.example.`,
    );
  }
}
