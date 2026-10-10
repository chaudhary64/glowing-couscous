/**
 * Copy MapLibre's web worker into `public/` so the browser can load it.
 *
 * MapLibre 6 is ESM-only and locates its worker relative to its own module URL
 * (`new URL("./maplibre-gl-worker.mjs", import.meta.url)`). Once Turbopack bundles the
 * library into an app chunk, that sibling file does not exist, and the map fails to
 * start with a 404 on the worker. The fix MapLibre provides is `setWorkerUrl()`; this
 * script puts the two files that URL needs — the worker and the shared chunk it imports —
 * at a versioned path under `public/vendor/`, which `components/features/heatmap/
 * hotspot-map.tsx` points at.
 *
 * Runs as `predev` and `prebuild`, so the copy always matches the installed version and
 * is never committed (`public/vendor/` is gitignored).
 */
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = path.join(root, "node_modules", "maplibre-gl");
const { version } = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const target = path.join(root, "public", "vendor", `maplibre-gl-${version}`);

mkdirSync(target, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(path.join(pkgDir, "dist", file), path.join(target, file));
}
console.log(`[vendor] maplibre-gl ${version} worker → public/vendor/maplibre-gl-${version}/`);
