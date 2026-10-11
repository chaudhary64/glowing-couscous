/**
 * Capture the landing page's screen shots.
 *
 * `04 / The Loop` claims four working screens; this is how the four images under it are
 * made, so they can be regenerated when a screen changes rather than drifting into a
 * mock. It signs in as the demo admin through the app's own API — the same route
 * `tests/e2e/global-setup.ts` uses, and the only way in, because every screen here is
 * behind Cognito — then photographs the top of each screen at desktop width.
 *
 *   npm run shots          (see package.json)
 *
 * Needs a running server and the usual `.env.local` (Cognito, DATABASE_URL, S3, PICKUP_*).
 * Nothing secret is printed: the password is read from `E2E_PASSWORD` and used, not echoed.
 * The screenshots land in `public/shots/`, which is public by design — they are the page's
 * evidence, so nothing sensitive may appear in them.
 */

import { mkdirSync } from "node:fs";

import { chromium, request } from "@playwright/test";

const BASE = (process.env.SHOTS_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const OUT = "public/shots";

/** The core loop, in the order an item travels it (lib/data/features: coreLoopSlugs). */
const SCREENS = [
  { file: "01-intake", path: "/intake", label: "New intake" },
  { file: "02-valuation", path: "/valuation", label: "Valuations" },
  { file: "03-validation", path: "/validation", label: "Validation queue" },
  { file: "04-pickups", path: "/pickups", label: "Pickups" },
];

const password = process.env.E2E_PASSWORD;
if (!password) throw new Error("E2E_PASSWORD is not set. Copy .env.example to .env.local.");

mkdirSync(OUT, { recursive: true });

const api = await request.newContext({ baseURL: BASE });
const signIn = await api.post("/api/auth/sign-in", {
  form: { email: "demo.admin@example.com", password },
  headers: { origin: BASE },
  maxRedirects: 0,
});
const cookies = (await api.storageState()).cookies;
if (!cookies.some((cookie) => cookie.name === "ecoepr.session")) {
  throw new Error(`Sign-in failed: ${signIn.status()} -> ${signIn.headers()["location"] ?? ""}`);
}
await api.dispose();

const browser = await chromium.launch();
const context = await browser.newContext({
  baseURL: BASE,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  // The screens are photographed, not driven, so nothing should animate into the frame.
  reducedMotion: "reduce",
});
await context.addCookies(cookies);
const page = await context.newPage();

for (const [index, screen] of SCREENS.entries()) {
  await page.goto(screen.path, { waitUntil: "networkidle" });
  // The screen header is the one element every screen in the loop has in common.
  await page.locator("h1").first().waitFor({ state: "visible", timeout: 30_000 });

  if (index === 0) {
    // The consent notice is the app's chrome, not the screen's, and it would sit over the
    // foot of every shot: the narrowest answer is taken once, for the whole context.
    const decline = page.getByRole("button", { name: "Essential cookies only" });
    if (await decline.count()) await decline.first().click();
  }

  await page.waitForTimeout(1200); // charts and map tiles settle after the DOM does
  const file = `${OUT}/${screen.file}.jpg`;
  await page.screenshot({ path: file, type: "jpeg", quality: 82 });
  const title = await page.locator("h1").first().innerText();
  console.log(`${file}  ${screen.path}  "${title.replace(/\s+/g, " ").trim()}"`);
}

await browser.close();
