import { expect, test } from "@playwright/test";

import { stateFile } from "./accounts";
import { DEVANAGARI, FILES, HINDI_NOTE, MOTHERBOARD, sameOrigin , uploadable } from "./fixtures";

/**
 * Feature 2 — multi-modal intake — LIVE: a photo and a Hindi voice note. Azure Speech
 * transcribes the note (hi-IN), the transcript goes to Foundry with the photo, and the
 * fields come back with the same price the valuation would give.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: stateFile("operator") });

test("UI: photo + Hindi voice note → transcript, extracted fields and a price", async ({ page }) => {
  await page.goto("/intake");

  /*
    Two steps the console asks for before it will send anything, both of them the app's
    real flow and neither of them optional:

    1. the cookie and location notice — a fresh browser has made no choice, and the screen
       only goes looking for a position once one exists;
    2. the inline location question — with location declined there is no fix, so the first
       submit asks whether to add one instead of sending. "Submit without" is the answer a
       collector who does not want to share a position gives, and the intake is recorded
       and paid either way.

    Skipping either leaves the request unsent and this test waiting for panels that can
    never arrive.
  */
  await page.getByRole("button", { name: "Essential cookies only" }).click();

  await page.locator('input[type="file"][accept^="image"]').setInputFiles(uploadable(FILES.motherboard, "motherboard.jpg"));
  await page.locator('input[type="file"][accept^="audio"]').setInputFiles(FILES.hindiNote);
  await expect(page.getByText("Attached")).toHaveCount(2);
  await page.getByRole("button", { name: "Process intake" }).click();
  await page.getByRole("button", { name: "Submit without" }).click();

  await expect(page.getByRole("heading", { name: "What was pulled out" })).toBeVisible({ timeout: 110_000 });
  await expect(page.getByText(DEVANAGARI).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "What the collector is offered" })).toBeVisible();
});

test("API: the voice note is transcribed in Hindi and the fields are extracted", async ({ request, baseURL }) => {
  const response = await request.post("/api/ai/intake", {
    headers: sameOrigin(baseURL),
    data: { photo: MOTHERBOARD(), audio: HINDI_NOTE(), durationSeconds: 5 },
    timeout: 115_000,
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json();

  expect(body.voiceNote, "voice note result").not.toBeNull();
  expect(body.voiceNote.transcript).toMatch(DEVANAGARI);
  expect(body.voiceNote.translation).toMatch(/\S/);
  expect(body.fields.length).toBeGreaterThan(0);
  expect(body.analysis?.valuation?.netToCollector).toBeGreaterThanOrEqual(0);
  expect(body.source.inputs).toEqual(expect.arrayContaining(["photo"]));
  expect(body.storage?.objects?.length ?? 0, "photo and audio archived").toBeGreaterThanOrEqual(2);
});

test("API: only WAV audio is accepted", async ({ request, baseURL }) => {
  const response = await request.post("/api/ai/intake", {
    headers: sameOrigin(baseURL),
    data: { audio: { mimeType: "audio/mpeg", dataBase64: "AAAA" } },
  });
  expect(response.status()).toBe(415);
});

test.describe("a viewer", () => {
  test.use({ storageState: stateFile("viewer") });
  test("cannot submit an intake (operator or above)", async ({ request, baseURL }) => {
    const response = await request.post("/api/ai/intake", { headers: sameOrigin(baseURL), data: { note: "x" } });
    expect(response.status()).toBe(403);
  });
});
