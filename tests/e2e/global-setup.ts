import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

  // Start the pickup tests on an empty day in DynamoDB Local: each handoff routes 37.5 kg
  // to a line licensed for 4,000 kg a day, so ~15 full runs would otherwise fill it and
  // the router would (rightly) refuse the next load. The script refuses non-local
  // endpoints, so the deployed tables can never be touched from here.
  execFileSync(process.execPath, ["scripts/pickup-local-reset.mjs"], { stdio: "inherit" });

  // Every saved state starts as a returning visitor who has already answered the
  // cookie and location prompt, so the banner does not sit over the screen under test.
  // consent.spec.ts covers the prompt itself from a clean browser.
  const consent = {
    name: "ecoepr.consent",
    value: encodeURIComponent(JSON.stringify({ v: 1, location: true, at: new Date().toISOString() })),
    domain: new URL(baseURL).hostname,
    path: "/",
    expires: Math.floor(Date.now() / 1000) + 3600,
    httpOnly: false,
    secure: false,
    sameSite: "Lax" as const,
  };
  writeFileSync(stateFile("anon"), JSON.stringify({ cookies: [consent], origins: [] }));

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
    const saved = JSON.parse(readFileSync(stateFile(role), "utf8"));
    saved.cookies.push(consent);
    writeFileSync(stateFile(role), JSON.stringify(saved));
    await context.dispose();
  }
}
