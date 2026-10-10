import { mkdirSync } from "node:fs";
import { request, type FullConfig } from "@playwright/test";

import { ACCOUNTS, password, stateFile, type RoleName } from "./accounts";

/**
 * Signs each demo account in once, through the app's own `/api/auth/sign-in` (the route
 * the login form posts to), and saves the session cookie as a storage state. Specs then
 * start already signed in as whichever role they need, without five Cognito sign-ins per
 * test. Sign-in itself is tested through the real form in auth.spec.ts.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL as string;
  mkdirSync("tests/e2e/.auth", { recursive: true });

  for (const [role, email] of Object.entries(ACCOUNTS) as [RoleName, string][]) {
    const context = await request.newContext({ baseURL });
    const response = await context.post("/api/auth/sign-in", {
      form: { email, password: password() },
      headers: { origin: baseURL },
      maxRedirects: 0,
    });
    const location = response.headers()["location"] ?? "";
    const cookies = (await context.storageState()).cookies;
    if (!cookies.some((cookie) => cookie.name === "ecoepr.session")) {
      throw new Error(`Sign-in failed for ${role} (${email}): ${response.status()} -> ${location}`);
    }
    await context.storageState({ path: stateFile(role) });
    await context.dispose();
  }
}
