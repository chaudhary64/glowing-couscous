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

/**
 * The `NEXT_PUBLIC_*` copies of the pool settings, read **by literal name**.
 *
 * The difference between `process.env.NEXT_PUBLIC_COGNITO_REGION` here and
 * `process.env[name]` in `fromEnv` is the whole reason this app could sign in on a
 * laptop and not on Amplify Hosting. Next.js substitutes a static
 * `process.env.NEXT_PUBLIC_…` with the value it had **at build time**; a computed key
 * cannot be substituted, so it stays a runtime lookup and finds nothing.
 *
 * That matters because Amplify Hosting does not give its running SSR compute the
 * environment variables from the app settings — deliberately, so build secrets are not
 * readable by the serving code. The build does receive them. Referencing the public
 * names statically is therefore the only copy that survives to request time, and it is
 * why these three lines must stay static: rewriting them as `fromEnv("NEXT_PUBLIC_…")`
 * silently restores the outage.
 *
 * Nothing secret is entrusted to this: the pool id, client id and region are already
 * browser-visible values.
 */
const BUILT_IN = {
  region: process.env.NEXT_PUBLIC_COGNITO_REGION,
  userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID,
  clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID,
};

/**
 * The live environment first, then the value baked in at build time.
 *
 * Order matters. A server that really has the variables (a laptop, `next start` with
 * an env file, any host that injects them) stays fully configurable at runtime; the
 * build-time copy is only the last resort. On Amplify the first lookup is empty, which
 * is exactly when the second one answers.
 */
const resolveConfig = (name: string, builtIn: string | undefined): string =>
  fromEnv(name, `NEXT_PUBLIC_${name}`) || builtIn || "";

export const authConfig = {
  region: resolveConfig("COGNITO_REGION", BUILT_IN.region),
  userPoolId: resolveConfig("COGNITO_USER_POOL_ID", BUILT_IN.userPoolId),
  clientId: resolveConfig("COGNITO_CLIENT_ID", BUILT_IN.clientId),

  /** Derived from the pool when not set explicitly; both must agree or tokens are rejected. */
  issuer:
    fromEnv("COGNITO_ISSUER") ||
    (() => {
      const region = resolveConfig("COGNITO_REGION", BUILT_IN.region);
      const pool = resolveConfig("COGNITO_USER_POOL_ID", BUILT_IN.userPoolId);
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
    const message = `Cognito is not configured: missing ${missing.join(", ")}. See .env.example.`;
    // Logged before it is thrown. The auth route handlers turn anything that is not an
    // `AuthError` into the generic "something went wrong on our side" notice, so without
    // this line the one fact worth having — which variable is missing — reaches the user
    // as a shrug and reaches CloudWatch as nothing at all. That is how a deployment
    // served this message for hours with an empty log beside it.
    console.error(`[auth] ${message}`);
    throw new Error(message);
  }
}
