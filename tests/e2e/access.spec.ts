import { expect, test } from "@playwright/test";

import { ACCOUNTS, SCREENS, stateFile, type RoleName } from "./accounts";

/**
 * The access matrix in lib/auth/roles.ts, checked from the outside: for each of the five
 * roles, every screen either opens or lands on /no-access with the requirement named,
 * and the navigation shows exactly the screens the role may open.
 */

for (const role of Object.keys(ACCOUNTS) as RoleName[]) {
  test.describe(`${role}`, () => {
    test.use({ storageState: stateFile(role) });

    test("opens exactly the screens its roles allow", async ({ page }) => {
      for (const screen of SCREENS) {
        await page.goto(screen.path);
        const allowed = screen.roles.includes(role);
        if (allowed) {
          await expect(page, `${role} should open ${screen.path}`).toHaveURL(screen.path);
          await expect(page.getByRole("heading", { level: 1, name: screen.title })).toBeVisible();
        } else {
          await expect(page, `${role} should be refused ${screen.path}`).toHaveURL(/\/no-access\?/);
          expect(new URL(page.url()).searchParams.get("from")).toBe(screen.path);
        }
      }
    });

    test("sees only the nav links it can open", async ({ page }) => {
      await page.goto("/dashboard");
      const nav = page.getByRole("navigation").first();
      for (const screen of SCREENS) {
        const link = nav.locator(`a[href="${screen.path}"]`);
        // `>= 1`, not `1`: the logo links to /dashboard as well as the nav item.
        if (screen.roles.includes(role)) await expect(link.first(), `${screen.nav} for ${role}`).toBeVisible();
        else await expect(link, `${screen.nav} hidden for ${role}`).toHaveCount(0);
      }
    });
  });
}

test.describe("no-access page", () => {
  test.use({ storageState: stateFile("viewer") });

  test("names the requirement instead of pretending the page is missing", async ({ page }) => {
    await page.goto("/valuation");
    await expect(page).toHaveURL(/\/no-access\?/);
    await expect(page.getByText(/Admin only/i).first()).toBeVisible();
  });
});
