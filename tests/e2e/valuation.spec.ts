import { expect, test } from "@playwright/test";

import { stateFile } from "./accounts";
import { FILES, MOTHERBOARD, sameOrigin, uploadable } from "./fixtures";

/**
 * Feature 1 — AI metal & EPR valuation — and the records it leaves behind, LIVE:
 * a real Azure Foundry call, the photo archived to S3, and the priced item written to
 * RDS. The item this creates is then used for the validation-decision and evidence
 * tests below, so the file runs in order.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: stateFile("officer") });

let itemCode = "";
let archivedKey = "";

test("UI: a photo of a motherboard is valued, priced and gatekept", async ({ page }) => {
  await page.goto("/valuation");
  await page.locator('input[type="file"][accept^="image"]').setInputFiles(uploadable(FILES.motherboard, "motherboard.jpg"));
  await expect(page.getByText("Attached").first()).toBeVisible();
  await page.getByPlaceholder(/पुराना लैपटॉप/).fill("Old laptop motherboard, does not power on.");
  await page.getByPlaceholder("412").fill("600");
  await page.getByRole("button", { name: "Value this item" }).click();

  await expect(page.getByRole("heading", { name: "What the collector is offered" })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("heading", { name: "What produced this" })).toBeVisible();
  await expect(page.getByText(/Foundry · /).first()).toBeVisible();
  // The failure panel (a 2px hazard box) must be absent — not the hazard *badges* the
  // result carries for a board with lead solder.
  await expect(page.locator("div.border-2.border-hazard.bg-hazard-tint")).toHaveCount(0);
});

test("API: the valuation is priced on the server and recorded", async ({ request, baseURL }) => {
  const response = await request.post("/api/ai/valuation", {
    headers: sameOrigin(baseURL),
    data: { photo: MOTHERBOARD(), note: "Laptop motherboard, dead.", declaredMassGrams: 600 },
    timeout: 110_000,
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json();

  expect(body.id).toMatch(/\S/);
  expect(body.identified.itemLabel).toMatch(/\S/);
  expect(body.materials.length).toBeGreaterThan(0);
  expect(body.valuation.netToCollector).toBeGreaterThanOrEqual(0);
  expect(body.valuation.grossValue).toBeGreaterThanOrEqual(body.valuation.netToCollector);
  expect(["verified", "review", "rejected"]).toContain(body.gatekeeper.verdict);
  expect(body.gatekeeper.verdict, "a motherboard is e-waste").not.toBe("rejected");
  expect(body.source.inputs).toContain("photo");

  // S3: the photo is archived under its content hash.
  expect(body.storage?.objects?.length, JSON.stringify(body.storage)).toBeGreaterThan(0);
  archivedKey = body.storage.objects[0].key;
  expect(archivedKey).toMatch(/^media\/[0-9a-f]{2}\/[0-9a-f]{64}\.jpg$/);

  // RDS: the priced item exists under the analysis id.
  expect(body.priced?.error ?? null, JSON.stringify(body.priced)).toBeNull();
  expect(body.priced.code).toBe(body.id);
  itemCode = body.id;
});

test("API: the same photo sent twice is never priced as a second item", async ({ request, baseURL }) => {
  const photo = MOTHERBOARD();
  const send = () =>
    request.post("/api/ai/valuation", {
      headers: sameOrigin(baseURL),
      data: { photo, note: "Laptop motherboard, dead." },
      timeout: 110_000,
    });
  const first = await (await send()).json();
  const second = await send();
  expect(second.status()).toBe(200);
  const again = await second.json();

  // The id comes from the photograph, not the model's words (lib/ai/analyse.ts), so the
  // second send resolves to the same submission however the model describes it, and a
  // fresh photograph is recorded even when an earlier item was described the same way.
  expect(again.id).toBe(first.id);
  expect(first.priced.created, JSON.stringify(first.submission)).toBe(true);
  expect(again.priced.created, JSON.stringify(again.priced)).toBe(false);
});

test("API: bad requests are refused before the model is called", async ({ request, baseURL }) => {
  const headers = sameOrigin(baseURL);
  const empty = await request.post("/api/ai/valuation", { headers, data: {} });
  expect(empty.status()).toBe(400);
  expect((await empty.json()).error).toBe("empty_request");

  const wrongType = await request.post("/api/ai/valuation", {
    headers,
    data: { photo: { mimeType: "image/gif", dataBase64: "R0lGODlh" } },
  });
  expect(wrongType.status()).toBe(415);

  const tooHeavy = await request.post("/api/ai/valuation", { headers, data: { note: "a fridge", declaredMassGrams: 250_000 } });
  expect(tooHeavy.status()).toBe(400);

  const crossSite = await request.post("/api/ai/valuation", {
    headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
    data: { note: "x" },
  });
  expect(crossSite.status()).toBe(403);
});

test.describe("an operator", () => {
  test.use({ storageState: stateFile("operator") });
  test("cannot run a valuation (officer or above)", async ({ request, baseURL }) => {
    const response = await request.post("/api/ai/valuation", { headers: sameOrigin(baseURL), data: { note: "x" } });
    expect(response.status()).toBe(403);
  });
});

/* -------------------------------------------- validation decisions (RDS writes) */

test("a decision on the new item is recorded, shown, and undone from the queue", async ({ page, request, baseURL }) => {
  expect(itemCode, "the valuation test must create the item first").not.toBe("");
  const recorded = await request.post("/api/validation/decision", {
    headers: sameOrigin(baseURL),
    data: { item: itemCode, decision: "recyclable", reason: "e2e: approve then undo" },
  });
  expect(recorded.status(), await recorded.text()).toBe(200);
  const { decision } = await recorded.json();
  expect(decision.decision).toBe("approved_recyclable");

  await page.goto("/validation");
  const row = page.locator("li", { hasText: itemCode }).filter({ has: page.getByRole("button", { name: "Undo" }) });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Approved");

  await row.getByRole("button", { name: "Undo" }).click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await expect(page.locator("li", { hasText: itemCode }).filter({ has: page.getByRole("button", { name: "Undo" }) })).toHaveCount(0);
});

test("decision input is checked", async ({ request, baseURL }) => {
  const headers = sameOrigin(baseURL);
  const noItem = await request.post("/api/validation/decision", { headers, data: { decision: "reject" } });
  expect(noItem.status()).toBe(400);
  const badKind = await request.post("/api/validation/decision", { headers, data: { item: itemCode, decision: "pay-me" } });
  expect(badKind.status()).toBe(400);
  const unknown = await request.post("/api/validation/decision", { headers, data: { item: "ECO-0000-NOPE", decision: "reject" } });
  expect(unknown.status()).toBe(409);
  const noId = await request.delete("/api/validation/decision", { headers });
  expect(noId.status()).toBe(400);
});

test.describe("an operator on the validation API", () => {
  test.use({ storageState: stateFile("operator") });
  test("cannot record a decision (officer or above)", async ({ request, baseURL }) => {
    const response = await request.post("/api/validation/decision", {
      headers: sameOrigin(baseURL),
      data: { item: itemCode || "x", decision: "reject" },
    });
    expect(response.status()).toBe(403);
  });
});

/* ----------------------------------------------------- evidence (S3 signed read) */

test.describe("evidence", () => {
  test.use({ storageState: stateFile("operator") });

  test("the archived photo can be read back through a signed URL", async ({ request, baseURL }) => {
    expect(archivedKey).not.toBe("");
    const signed = await request.get(`/api/media/read?key=${encodeURIComponent(archivedKey)}`, { headers: sameOrigin(baseURL) });
    expect(signed.status(), await signed.text()).toBe(200);
    const { url } = await signed.json();
    expect(url).toMatch(/^https:\/\/.+X-Amz-Signature=/);

    const object = await request.get(url);
    expect(object.status()).toBe(200);
    expect(object.headers()["content-type"]).toMatch(/^image\//);
  });

  test("a key outside the archive's shape is never signed", async ({ request, baseURL }) => {
    for (const key of ["../etc/passwd", "media/zz/abc.jpg", "other/00/" + "a".repeat(64) + ".jpg"]) {
      const response = await request.get(`/api/media/read?key=${encodeURIComponent(key)}`, { headers: sameOrigin(baseURL) });
      expect(response.status(), key).toBe(400);
    }
  });

  test("the evidence page lists the archive", async ({ page }) => {
    await page.goto("/evidence");
    await expect(page.getByRole("heading", { level: 1, name: "Evidence archive" })).toBeVisible();
  });
});

test.describe("a viewer", () => {
  test.use({ storageState: stateFile("viewer") });
  test("cannot read evidence", async ({ request, baseURL }) => {
    const response = await request.get(`/api/media/read?key=${encodeURIComponent(archivedKey || "media/00/x.jpg")}`, { headers: sameOrigin(baseURL) });
    expect(response.status()).toBe(403);
  });
});
