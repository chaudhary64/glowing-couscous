import { expect, test } from "@playwright/test";

import { ACCOUNTS, SCREENS, stateFile, type RoleName } from "./accounts";

/**
 * The dashboard is one screen for every role, but it must never offer a role a link
 * that lands on /no-access. Every link in the page body is checked against the same
 * matrix access.spec.ts walks, and the header's two actions against the role's seats.
 */

for (const role of Object.keys(ACCOUNTS) as RoleName[]) {
  test.describe(`${role}`, () => {
    test.use({ storageState: stateFile(role) });

    test("the dashboard offers no link the role cannot open", async ({ page }) => {
      await page.goto("/dashboard");
      const main = page.getByRole("main");
      await expect(main.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();

      const paths = await main
        .locator("a[href]")
        .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).pathname));
      for (const path of new Set(paths)) {
        const screen = SCREENS.find((s) => path === s.path || path.startsWith(`${s.path}/`));
        if (!screen) continue;
        expect(screen.roles.includes(role), `${role} is offered ${path}`).toBe(true);
      }

      const mayOpen = (path: string) =>
        (SCREENS.find((s) => s.path === path)?.roles ?? []).includes(role);
      await expect(main.getByRole("link", { name: "New intake", exact: true })).toHaveCount(
        mayOpen("/intake") ? 1 : 0,
      );
      await expect(main.getByRole("link", { name: "Clear validation queue" })).toHaveCount(
        mayOpen("/validation") ? 1 : 0,
      );
      // The district panel is the one thing every role can follow.
      await expect(main.getByRole("link", { name: "Full map →" })).toBeVisible();
    });
  });
}
