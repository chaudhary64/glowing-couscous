import { expect, test } from "@playwright/test";

import { LEGACY_OWNER, password, stateFile } from "./accounts";
import { sameOrigin } from "./fixtures";

/**
 * /team, an admin-only screen, and the role-change route behind it.
 *
 * Whether the server can read the user pool depends on COGNITO_ADMIN_* being set, so the
 * checks follow that: with the keys a role is shown and changeable, without them the
 * screen says so and the route refuses instead of pretending. No test here changes a
 * real account's role.
 */

const rolesReadable = Boolean(
  process.env.COGNITO_ADMIN_ACCESS_KEY_ID?.trim() && process.env.COGNITO_ADMIN_SECRET_ACCESS_KEY?.trim(),
);

test.describe("an admin", () => {
  test.use({ storageState: stateFile("admin") });

  test("the team screen lists who has signed in", async ({ page }) => {
    await page.goto("/team");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();
    await expect(
      main.getByText(rolesReadable ? "Roles read from the user pool" : "Roles not readable here"),
    ).toBeVisible();
    // Global setup signed every demo account in, so each has a row.
    await expect(main.getByText("demo.viewer@example.com")).toBeVisible();
  });

  test("a role must be one of the four, and the old owner role cannot be granted", async ({ request, baseURL }) => {
    const response = await request.post("/api/team/role", {
      headers: sameOrigin(baseURL),
      data: { username: "anyone", role: "eco-owner" },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).message).toContain("eco-admin, eco-officer, eco-operator, eco-viewer");
  });

  test("without pool credentials a role change is refused, not faked", async ({ request, baseURL }) => {
    test.skip(rolesReadable, "The pool is configured; this checks the unconfigured server.");
    const response = await request.post("/api/team/role", {
      headers: sameOrigin(baseURL),
      data: { username: "anyone", role: "eco-viewer" },
    });
    expect(response.status()).toBe(503);
    expect((await response.json()).message).toContain("COGNITO_ADMIN_ACCESS_KEY_ID");
  });
});

test.describe("an officer", () => {
  test.use({ storageState: stateFile("officer") });

  test("cannot change a role (admin only)", async ({ request, baseURL }) => {
    const response = await request.post("/api/team/role", {
      headers: sameOrigin(baseURL),
      data: { username: "anyone", role: "eco-viewer" },
    });
    expect(response.status()).toBe(403);
  });
});

test("an account still in the old owner group signs in as an admin", async ({ page }) => {
  await page.goto("/team");
  await expect(page).toHaveURL(/\/login\?next=%2Fteam/);
  await page.locator('input[name="email"]').fill(LEGACY_OWNER);
  await page.locator('input[name="password"]').fill(password());
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/team");
  await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();
});
