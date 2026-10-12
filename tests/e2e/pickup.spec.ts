import { expect, test, type Page } from "@playwright/test";

import { stateFile } from "./accounts";
import { sameOrigin } from "./fixtures";

/**
 * Feature 4 — smart pickup & digital credit — through the split-screen demo, as the
 * video shows it: the collector's phone routes the load and shows a PIN, the recycler's
 * gate weighs it and types the PIN, the DynamoDB Stream pays the collector and the phone
 * turns green. Runs against the deployed API, like every other test in this suite.
 *
 * Admin, and only Admin can be the session here. `/demo` puts the phone and the gate on
 * one page, and after the split they are two different seats: the phone's calls are
 * guarded against `/handoff` (Operator) and the gate's against `/gate` (Officer). A
 * session that holds both is an Admin, so an Operator driving this page reaches the
 * weighbridge and then has no price to quote — the gate's own pricing is refused to
 * them. That is the migration working as intended, not a fault in the flow: what the
 * page demonstrates is the handoff, and the seats themselves are checked where they
 * belong, by `access.spec.ts` for the screens and by the viewer case below for the API.
 *
 * The faithful version of this test is two sessions — an Operator on the phone and an
 * Officer at the gate — which is the runbook's §4.2 option (a) and needs the three
 * pickup *reads* opened to the union of the seats that read them (a load's row, its
 * events and the stream catalogue are each read by both ends of a handoff). That is
 * Track C's step 20/22, and this file is the one it rewrites.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: stateFile("admin") });

// The cookie and location notice is answered up front (intake.spec.ts walks through it
// from a fresh browser); left open, it sits over the phone's "Hand over e-waste" button.
test.beforeEach(async ({ context, baseURL }) => {
  const consent = { v: 1, location: false, at: new Date().toISOString() };
  await context.addCookies([
    { name: "ecoepr.consent", value: encodeURIComponent(JSON.stringify(consent)), url: baseURL! },
  ]);
});

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

test("hand over → PIN → weigh and verify → UPI payment on the phone", async ({ page }) => {
  await page.goto("/demo");
  const pin = await handOver(page);

  /*
    The gate opens the load the phone just routed. Nothing here is a fixed demo load —
    the item is the newest cleared, located one this database holds — so the assertions
    read the load's own figures rather than a constant: the weighbridge is prefilled with
    its declared mass, and the price the gate quotes is the figure the note must carry.
  */
  await expect(gate(page).getByRole("heading", { name: "Weigh and verify" })).toBeVisible();
  const mass = gate(page).getByLabel("Weighbridge reading (kg)");
  expect(Number(await mass.inputValue())).toBeGreaterThan(0);

  // The preview beside the weight quotes what the weighed load will pay.
  const preview = gate(page).locator("p", { hasText: "Pays" }).first();
  await expect(preview).toBeVisible();
  const figure = ((await preview.textContent()) ?? "").match(/₹[\d,]+\.\d{2}/)?.[0];
  expect(figure, "the gate quotes a price for the weighed mass").toBeTruthy();

  // A wrong PIN is refused and costs a try.
  await typePin(page, wrong(pin));
  await expect(gate(page).getByRole("alert")).toContainText("4 tries left");

  // The right one settles, for the figure the preview quoted.
  await typePin(page, pin);
  const toast = page.getByRole("status").filter({ hasText: "Handoff verified" });
  await expect(toast).toBeVisible();
  await expect(toast).toContainText(figure!);

  // The payout arrives via the stream and the phone turns green.
  const upi = phone(page).getByRole("status").filter({ hasText: "UPI payment" });
  await expect(upi).toBeVisible({ timeout: 20_000 });
  await expect(upi).toContainText(figure!);
  await expect(upi).toContainText("Successful");
  await expect(upi).toContainText("@ecoepr");

  // And the gate's audit trail tells the whole story.
  for (const line of ["Routed to", "Handoff PIN issued", "Wrong PIN entered", "PIN verified at the gate", "Settled ·", "UPI payout sent"]) {
    await expect(gate(page).getByText(line, { exact: false }).first()).toBeVisible({ timeout: 10_000 });
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
  const declared = Number(await mass.inputValue());
  // Double the declared mass: a variance the screen must flag whatever the load weighs.
  await mass.fill(String(declared * 2));
  await expect(gate(page).getByText(/% against the declared/)).toBeVisible();
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
