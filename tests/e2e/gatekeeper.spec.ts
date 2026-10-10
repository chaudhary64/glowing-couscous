import { expect, test } from "@playwright/test";

import { stateFile } from "./accounts";
import { BANANA, FILES, MOTHERBOARD, sameOrigin , uploadable } from "./fixtures";

/**
 * Feature 3 — the fraud-prevention vision gatekeeper — LIVE. A motherboard must not be
 * rejected; a bunch of bananas must be rejected as not e-waste (rule R-01), and the
 * credit withheld.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: stateFile("officer") });

test("UI: a photo that is not e-waste is rejected under R-01", async ({ page }) => {
  await page.goto("/validation");
  await page.locator('input[type="file"][accept^="image"]').setInputFiles(uploadable(FILES.banana, "banana.jpg"));
  await page.getByRole("button", { name: "Run the gatekeeper" }).click();

  await expect(page.getByText("Result · Gatekeeper · R-01")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Not creditable").first()).toBeVisible();
});

test("API: a motherboard passes the gatekeeper", async ({ request, baseURL }) => {
  const response = await request.post("/api/ai/gatekeeper", {
    headers: sameOrigin(baseURL),
    data: { photo: MOTHERBOARD() },
    timeout: 110_000,
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json();
  expect(["verified", "review"]).toContain(body.verdict);
  expect(body.ruleCode ?? "none").not.toBe("R-01");
  expect(body.confidence).toBeGreaterThan(0);
  expect(body.confidence).toBeLessThanOrEqual(1);
});

test("API: bananas are refused as not e-waste, with the credit withheld", async ({ request, baseURL }) => {
  const response = await request.post("/api/ai/gatekeeper", {
    headers: sameOrigin(baseURL),
    data: { photo: BANANA() },
    timeout: 110_000,
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json();
  expect(body.verdict).toBe("rejected");
  expect(body.ruleCode).toBe("R-01");
  expect(body.creditable).toBe(false);
});

test.describe("an operator", () => {
  test.use({ storageState: stateFile("operator") });
  test("cannot run the gatekeeper (officer or above)", async ({ request, baseURL }) => {
    const response = await request.post("/api/ai/gatekeeper", { headers: sameOrigin(baseURL), data: { note: "x" } });
    expect(response.status()).toBe(403);
  });
});
