// Renders the picture a phone shows behind each page (public/world/<station>.webp).
//
// Phones get a still of the 3D world instead of the scene itself (see
// components/world/world-backdrop.tsx). This draws each station with the real scene in
// headless Edge or Chrome at a phone's size, hides the page over it, and saves the
// frame. Re-run it after changing the scene, the board or a station:
//
//   npm run dev                                  # in another terminal
//   node scripts/render-world-stills.mjs [http://localhost:3000] [path to browser]
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";

const BASE = process.argv[2] ?? "http://localhost:3000";
const BROWSER =
  process.argv[3] ??
  (process.platform === "win32"
    ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
    : "google-chrome");
// Keep in step with STATIONS in components/world/stations.ts, plus "overview".
const STATIONS = ["/", "/dashboard", "/intake", "/valuation", "/validation", "/evidence", "/pickups", "/handoff",
  "/gate", "/demo", "/map", "/collectors", "/recyclers", "overview"];
// A large phone in portrait at 2x; smaller screens crop it (object-fit: cover).
const WIDTH = 440;
const HEIGHT = 956;
const SCALE = 2;
const OUT = "public/world";

const port = 9500 + Math.floor(Math.random() * 400);
const browser = spawn(
  BROWSER,
  ["--headless=new", "--no-first-run", "--hide-scrollbars", `--user-data-dir=${mkdtempSync(join(tmpdir(), "stills-"))}`,
    `--remote-debugging-port=${port}`, "about:blank"],
  { stdio: "ignore" },
);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
  } catch {}
}
if (!target) throw new Error(`no DevTools target from ${BROWSER}`);

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  pending.get(message.id)?.(message);
  pending.delete(message.id);
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    pending.set(++id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.result.value;

await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true });
await send("Page.enable");
mkdirSync(OUT, { recursive: true });

for (const station of STATIONS) {
  // /login is public; the override moves the camera and keeps the scene (not this
  // picture) on a phone. Any unlisted path, such as "overview", stands at the overview.
  // A dev server compiling or a lost WebGL context can stall a load; try it again.
  let ready = false;
  for (let attempt = 0; attempt < 3 && !ready; attempt++) {
    await send("Page.navigate", { url: `${BASE}/login?world-station=${encodeURIComponent(station)}` });
    ready = await evaluate(`new Promise((resolve) => {
    const started = Date.now();
    const poll = () => {
      if (document.querySelector(".world-backdrop[data-ready] canvas")) resolve(true);
      else if (Date.now() - started > 30000) resolve(false);
      else setTimeout(poll, 250);
    };
    poll();
  })`);
  }
  if (!ready) throw new Error(`the world never became ready for ${station}`);
  // Only the scene: no page, no dev badge, no veil (the veil is drawn over the picture on the site),
  // and no fade-in.
  await evaluate(`(() => {
    const style = document.createElement("style");
    style.textContent = "body > :not(.world-backdrop) { visibility: hidden !important }"
      + " .world-veil { display: none } .world-backdrop { transition: none !important; opacity: 1 !important }";
    document.head.append(style);
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove()); // the dev badge
  })()`);
  await sleep(1500);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const name = station === "/" ? "landing" : station.replace(/^\//, "");
  const webp = await sharp(Buffer.from(shot.result.data, "base64")).webp({ quality: 74, effort: 6 }).toBuffer();
  writeFileSync(join(OUT, `${name}.webp`), webp);
  console.log(`${name}.webp  ${(webp.length / 1024).toFixed(0)} KB`);
}

ws.close();
browser.kill();
process.exit(0);
