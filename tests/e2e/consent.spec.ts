import { expect, test } from "@playwright/test";

/** The cookie & location prompt, from a browser that has never answered it. */

test.use({ storageState: { cookies: [], origins: [] } });

test("a first visit asks once, and the answer is remembered", async ({ page, context }) => {
  await page.goto("/");
  const prompt = page.getByText("Cookies & location", { exact: false }).first();
  await expect(prompt).toBeVisible();

  await page.getByRole("button", { name: "Essential cookies only" }).click();
  await expect(prompt).toBeHidden();

  const consent = (await context.cookies()).find((cookie) => cookie.name === "ecoepr.consent");
  expect(consent, "the choice is stored in a first-party cookie").toBeTruthy();
  expect(JSON.parse(decodeURIComponent(consent!.value)).location).toBe(false);

  await page.reload();
  await expect(page.getByRole("button", { name: "Essential cookies only" })).toHaveCount(0);
});

test("accepting location is stored as consent to locate intakes", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Accept cookies & location" }).click();
  const consent = (await context.cookies()).find((cookie) => cookie.name === "ecoepr.consent");
  expect(JSON.parse(decodeURIComponent(consent!.value)).location).toBe(true);
});
