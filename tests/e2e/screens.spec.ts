import { expect, test, type Page } from "@playwright/test";

import { SCREENS, stateFile } from "./accounts";

/**
 * Every product screen renders for the admin without a server error or a browser
 * console error. The data on the read-only screens (dashboard, map, collectors,
 * recyclers, pickups) is fixture and database data; these checks prove the page
 * assembles, not what the numbers are.
 */

test.use({ storageState: stateFile("admin") });

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

for (const screen of SCREENS) {
  test(`${screen.path} renders cleanly`, async ({ page }) => {
    const errors = watchErrors(page);
    const response = await page.goto(screen.path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: screen.title })).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(errors, errors.join("\n")).toEqual([]);
  });
}

test("the dashboard links through to the working screens", async ({ page }) => {
  await page.goto("/dashboard");
  const nav = page.getByRole("navigation").first();
  await nav.getByRole("link", { name: "Pickups" }).click();
  await expect(page).toHaveURL("/pickups");
  await expect(page.getByRole("link", { name: "Destinations", exact: true })).toBeVisible();
});

test("the hotspot map lists wards", async ({ page }) => {
  await page.goto("/map");
  await expect(page.locator("table, svg").first()).toBeVisible();
});
