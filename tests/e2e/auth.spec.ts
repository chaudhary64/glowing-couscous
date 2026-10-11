import { expect, test } from "@playwright/test";

import { ACCOUNTS, password } from "./accounts";

/** The sign-in, sign-out and sign-up forms, driven as a person would. */

test.describe("sign in", () => {
  test("a wrong password is refused with a message", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(ACCOUNTS.operator);
    await page.locator('input[name="password"]').fill("not-the-password-1A!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login\?.*error=bad-credentials/);
    await expect(page.getByText("That email and password do not match")).toBeVisible();
  });

  test("the right password signs in and returns you to the page you wanted", async ({ page }) => {
    await page.goto("/pickups");
    await expect(page).toHaveURL(/\/login\?next=%2Fpickups/);
    await page.locator('input[name="email"]').fill(ACCOUNTS.operator);
    await page.locator('input[name="password"]').fill(password());
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL("/pickups");
    await expect(page.getByRole("heading", { level: 1, name: "Pickups" })).toBeVisible();
  });

  test("sign out ends the session", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[name="email"]').fill(ACCOUNTS.viewer);
    await page.locator('input[name="password"]').fill(password());
    await page.getByRole("button", { name: "Sign in" }).click();
    // Signing in from the plain form, with no `next`, lands on the dashboard — not the
    // public landing page at `/`.
    await expect(page).toHaveURL("/dashboard");
    await page.goto("/dashboard");
    await expect(page).toHaveURL("/dashboard");

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).not.toHaveURL("/dashboard");
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  });

  test("a signed-in user is bounced off the sign-in page", async ({ browser }) => {
    const context = await browser.newContext({ storageState: "tests/e2e/.auth/operator.json" });
    const page = await context.newPage();
    await page.goto("/login");
    await expect(page).toHaveURL("/dashboard");
    await context.close();
  });
});

test.describe("sign up — validation before anything reaches Cognito", () => {
  async function submit(page: import("@playwright/test").Page, fields: Record<string, string>) {
    await page.goto("/signup");
    for (const [name, value] of Object.entries(fields)) {
      await page.locator(`input[name="${name}"]`).fill(value);
    }
    // Bypass the browser's own `required` checks: the server's answer is what is tested.
    await page.locator("form").evaluate((form) => form.setAttribute("novalidate", ""));
    await page.getByRole("button", { name: /create|sign up/i }).click();
  }

  test("empty fields are refused", async ({ page }) => {
    await submit(page, { name: "", email: "", password: "", confirm: "" });
    await expect(page.getByText("Some fields were empty")).toBeVisible();
  });

  test("two different passwords are refused", async ({ page }) => {
    await submit(page, { name: "E2E Probe", email: "e2e-probe@example.com", password: "Ecoepr-Probe-123", confirm: "Ecoepr-Probe-456" });
    await expect(page.getByText("The two passwords are different")).toBeVisible();
  });

  test("a weak password is refused", async ({ page }) => {
    await submit(page, { name: "E2E Probe", email: "e2e-probe@example.com", password: "abc", confirm: "abc" });
    await expect(page.getByText("That password is too easy to guess")).toBeVisible();
  });

  test("a cross-site form post is refused", async ({ request }) => {
    const response = await request.post("/api/auth/sign-up", {
      form: { name: "x", email: "x@example.com", password: "Ecoepr-Probe-123", confirm: "Ecoepr-Probe-123" },
      headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      maxRedirects: 0,
    });
    expect(response.headers()["location"]).toContain("error=csrf");
  });
});
