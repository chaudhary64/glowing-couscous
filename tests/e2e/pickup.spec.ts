import { expect, test, type Page } from "@playwright/test";

import { stateFile } from "./accounts";
import { sameOrigin } from "./fixtures";

/**
 * Feature 4 — smart pickup & digital credit — through the split-screen demo, as the
 * video shows it: the collector's phone routes the load and shows a PIN, the recycler's
 * gate weighs it and types the PIN, the DynamoDB Stream pays the collector and the phone
 * turns green. Runs against DynamoDB Local (`npm run pickup:local`, started by the config).
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: stateFile("operator") });

const phone = (page: Page) => page.getByRole("region", { name: "Collector's phone" });
const gate = (page: Page) => page.getByRole("region", { name: "Recycler's gate terminal" });

async function handOver(page: Page): Promise<string> {
  await phone(page).getByRole("button", { name: "Hand over e-waste" }).click();
  const pin = phone(page).locator('[aria-label^="Handoff PIN"]');
  await expect(pin).toHaveText(/^\d{4}$/);
  return (await pin.textContent())!.trim();
}

async function typePin(page: Page, pin: string) {
  for (let i = 0; i < 4; i += 1) {
    await gate(page).getByLabel(`PIN digit ${i + 1}`).fill(pin[i]);
  }
  await gate(page).getByRole("button", { name: "Verify & issue credit" }).click();
}

const wrong = (pin: string) => String((Number(pin) + 1) % 10000).padStart(4, "0");

test("hand over → PIN → weigh and verify → ₹450.00 UPI payment on the phone", async ({ page }) => {
  await page.goto("/demo");
  const pin = await handOver(page);

  // The gate opens the load the phone just routed, routed past the unlicensed site.
  await expect(gate(page).getByRole("heading", { name: "Weigh and verify" })).toBeVisible();
  await expect(gate(page).getByText("GreenLoop Battery Line")).toBeVisible();
  await expect(gate(page).getByText("Hazardous").first()).toBeVisible();
  await expect(gate(page).getByLabel("Weighbridge reading (kg)")).toHaveValue("37.5");
  await expect(gate(page).getByText("₹450.00").first()).toBeVisible();

  // A wrong PIN is refused and costs a try.
  await typePin(page, wrong(pin));
  await expect(gate(page).getByRole("alert")).toContainText("4 tries left");

  // The right one settles.
  await typePin(page, pin);
  const toast = page.getByRole("status").filter({ hasText: "Handoff verified" });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("₹450.00");

  // The payout arrives via the stream and the phone turns green.
  const upi = phone(page).getByRole("status").filter({ hasText: "UPI payment" });
  await expect(upi).toBeVisible({ timeout: 20_000 });
  await expect(upi).toContainText("₹450.00");
  await expect(upi).toContainText("Successful");
  await expect(upi).toContainText("c-1042@ecoepr");

  // And the gate's audit trail tells the whole story.
  for (const line of ["Routed to RX-02", "Handoff PIN issued", "Wrong PIN entered", "PIN verified at the gate", "Settled · ₹450.00", "UPI payout sent"]) {
    await expect(gate(page).getByText(line)).toBeVisible({ timeout: 10_000 });
  }
});

test("five wrong PINs lock the load; the phone gets a new PIN and it settles", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "New handoff" }).click();
  const pin = await handOver(page);
  await expect(gate(page).getByRole("heading", { name: "Weigh and verify" })).toBeVisible();

  // Each refusal is awaited before the next try, as a person at the gate would.
  for (let i = 1; i <= 4; i += 1) {
    await typePin(page, wrong(pin));
    await expect(gate(page).getByRole("alert")).toContainText(`${5 - i} ${5 - i === 1 ? "try" : "tries"} left`);
  }
  await typePin(page, wrong(pin));
  await expect(gate(page).getByRole("alert")).toContainText(/Too many wrong PINs/);

  // The phone sees the lock on its next poll and offers a new PIN.
  await expect(phone(page).getByText("This PIN is locked")).toBeVisible({ timeout: 10_000 });
  await phone(page).getByRole("button", { name: "Get a new PIN" }).click();
  const pinLocator = phone(page).locator('[aria-label^="Handoff PIN"]');
  await expect(phone(page).getByText(/5 tries left/)).toBeVisible();
  const fresh = (await pinLocator.textContent())!.trim();

  await typePin(page, fresh);
  await expect(page.getByRole("status").filter({ hasText: "Handoff verified" })).toBeVisible();
  await expect(phone(page).getByRole("status").filter({ hasText: "UPI payment" })).toBeVisible({ timeout: 20_000 });
});

test("the gate warns when the weighbridge disagrees with the declared mass", async ({ page }) => {
  await page.goto("/demo");
  await page.getByRole("button", { name: "New handoff" }).click();
  const pin = await handOver(page);
  const mass = gate(page).getByLabel("Weighbridge reading (kg)");
  await mass.fill("25");
  await expect(gate(page).getByText(/-33\.3% against the declared/)).toBeVisible();
  await typePin(page, pin);
  await expect(gate(page).getByText("Mass variance · review")).toBeVisible();
});

test("the phone and the gate also work as separate screens", async ({ page, request, baseURL }) => {
  const routed = await request.post("/api/pickup/handoff", { headers: sameOrigin(baseURL) });
  expect(routed.status()).toBe(201);
  const { pickup } = await routed.json();

  await page.goto(`/gate?pickup=${pickup.pickupId}`);
  await expect(page.getByLabel("Pickup id")).toHaveValue(pickup.pickupId);
  await expect(page.getByRole("heading", { name: "Weigh and verify" })).toBeVisible();
  await expect(page.getByText("5 of 5 tries left")).toBeVisible();

  await page.goto("/handoff");
  await expect(page.getByRole("button", { name: "Hand over e-waste" })).toBeVisible();
});

test.describe("a viewer", () => {
  test.use({ storageState: stateFile("viewer") });
  test("cannot route or settle a load", async ({ request, baseURL }) => {
    const routed = await request.post("/api/pickup/handoff", { headers: sameOrigin(baseURL) });
    expect(routed.status()).toBe(403);
    const settled = await request.post("/api/pickup/PU-2026-0001/settle", {
      headers: sameOrigin(baseURL),
      data: { pin: "1234", weighedMassG: 1000 },
    });
    expect(settled.status()).toBe(403);
  });
});
