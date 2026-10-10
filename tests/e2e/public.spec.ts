import { expect, test } from "@playwright/test";

import { SCREENS } from "./accounts";

/** What anyone can read without an account, and what they are stopped from opening. */

test.describe("public pages", () => {
  test("the landing page renders and links to sign in", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1").first()).toBeVisible();
    await expect(page.locator('a[href="/login"]').first()).toBeVisible();
  });

});

test.describe("signed out", () => {
  for (const screen of SCREENS) {
    test(`${screen.path} sends you to sign in, and remembers where you were going`, async ({ page }) => {
      await page.goto(screen.path);
      await expect(page).toHaveURL(`/login?next=${encodeURIComponent(screen.path)}`);
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    });
  }

  test("the APIs refuse a request without a session", async ({ request }) => {
    for (const [method, path] of [
      ["POST", "/api/ai/valuation"],
      ["POST", "/api/ai/intake"],
      ["POST", "/api/ai/gatekeeper"],
      ["POST", "/api/validation/decision"],
      ["GET", "/api/media/read?key=media/00/abc.jpg"],
      ["POST", "/api/pickup/handoff"],
      ["GET", "/api/pickup/PU-2026-0001"],
    ] as const) {
      const response = await request.fetch(path, { method, data: method === "POST" ? {} : undefined });
      expect(response.status(), `${method} ${path}`).toBe(401);
    }
  });
});
