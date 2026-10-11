/**
 * Build India's district boundaries for filing and for the map.
 *
 *   npm run geo:districts -- .tmp-geo/in/adm2.geojson .tmp-geo/in/adm1.geojson
 *
 * Inputs are geoBoundaries' India releases (gbOpen, release 9469f09):
 *   - ADM2, 735 districts (2021) from the Local Government Directory via Pathways
 *     Data; Open Data Commons Open Database License 1.0.
 *   - ADM1, 36 states and union territories; CC BY 2.5 India. Used only to name each
 *     district's state (by the state containing the district's centroid).
 *
 * Outputs, both regenerated together so they can never disagree:
 *   - lib/geo/data/india-districts.json — server-side, for filing a point.
 *   - public/geo/india-districts.geojson — fetched by the map as a static file, so the
 *     outlines never enter a JavaScript bundle.
 *
 * Every ring is simplified (Douglas–Peucker, ~1 km) and rounded to 4 decimals (~11 m);
 * area and centroid are computed from the *source* geometry, before simplifying.
 * Codes are `IND-` plus the tail of geoBoundaries' shapeID: opaque, but stable for
 * this release, and checked unique here.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  boundsOf,
  multiPolygonAreaKm2,
  multiPolygonCentroid,
  multiPolygonContains,
  simplifyRing,
  type MultiPolygon,
} from "../lib/geo/polygon";

const [adm2Path, adm1Path] = process.argv.slice(2);
if (!adm2Path || !adm1Path) {
  console.error("usage: npm run geo:districts -- <ADM2 geojson> <ADM1 geojson>");
  process.exit(1);
}

const TOLERANCE_DEG = 0.01;
const round = (n: number) => Math.round(n * 1e4) / 1e4;

interface Feature {
  properties: { shapeName: string; shapeID: string };
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
}

const asMulti = (g: Feature["geometry"]): MultiPolygon =>
  (g.type === "Polygon" ? [g.coordinates] : g.coordinates) as MultiPolygon;

const read = (p: string) => (JSON.parse(readFileSync(p, "utf8")) as { features: Feature[] }).features;
const districts = read(adm2Path);
const states = read(adm1Path).map((f) => {
  const shape = asMulti(f.geometry);
  return { name: f.properties.shapeName, shape, box: boundsOf(shape) };
});

function stateOf(latitude: number, longitude: number): string | null {
  for (const s of states) {
    if (latitude < s.box.south || latitude > s.box.north || longitude < s.box.west || longitude > s.box.east) continue;
    if (multiPolygonContains(s.shape, latitude, longitude)) return s.name;
  }
  return null;
}

function majorityState(shape: MultiPolygon): string | null {
  const votes = new Map<string, number>();
  for (const [lng, lat] of shape.flat(2)) {
    const s = stateOf(lat, lng);
    if (s) votes.set(s, (votes.get(s) ?? 0) + 1);
  }
  return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

const out = districts.map((f) => {
  const source = asMulti(f.geometry);
  const centroid = multiPolygonCentroid(source);
  const boundary = source
    .map((polygon) =>
      polygon
        .map((ring) => simplifyRing(ring, TOLERANCE_DEG).map(([lng, lat]) => [round(lng), round(lat)] as [number, number]))
        .filter((ring) => ring.length >= 4),
    )
    .filter((polygon) => polygon.length > 0);
  return {
    code: `IND-${f.properties.shapeID.slice(-10)}`,
    name: f.properties.shapeName,
    // The centroid of an island group or a crescent-shaped district can sit outside
    // every state; then the state most of its own boundary points fall in. (Not the
    // first one: a district's first vertex is often on the border with a neighbour.)
    state: stateOf(centroid.latitude, centroid.longitude) ?? majorityState(source),
    areaKm2: Math.round(multiPolygonAreaKm2(source) * 10) / 10,
    centroid: { latitude: round(centroid.latitude), longitude: round(centroid.longitude) },
    boundary,
  };
});

const codes = new Set(out.map((d) => d.code));
if (codes.size !== out.length) throw new Error(`district codes collide: ${out.length - codes.size} duplicates`);
const empty = out.filter((d) => d.boundary.length === 0);
if (empty.length) throw new Error(`simplified away entirely: ${empty.map((d) => d.name).join(", ")}`);

const meta = {
  source: "geoBoundaries gbOpen IND ADM2 (release 9469f09); states from IND ADM1",
  attribution: "Districts © geoBoundaries / Pathways Data, LGD (ODbL 1.0)",
  license: "ODbL-1.0 (districts); CC-BY-2.5-IN (states)",
  country: "India",
};

const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const serverFile = path.join(root, "lib", "geo", "data", "india-districts.json");
const mapFile = path.join(root, "public", "geo", "india-districts.geojson");
mkdirSync(path.dirname(serverFile), { recursive: true });
mkdirSync(path.dirname(mapFile), { recursive: true });

writeFileSync(serverFile, JSON.stringify({ ...meta, districts: out }) + "\n");
writeFileSync(
  mapFile,
  JSON.stringify({
    type: "FeatureCollection",
    attribution: meta.attribution,
    features: out.map((d) => ({
      type: "Feature",
      properties: { code: d.code, name: d.name, state: d.state },
      geometry: { type: "MultiPolygon", coordinates: d.boundary },
    })),
  }) + "\n",
);

const noState = out.filter((d) => !d.state);
console.log(`${out.length} districts, ${states.length} states; ${noState.length} without a state${noState.length ? `: ${noState.map((d) => d.name).join(", ")}` : ""}`);
console.log(`server ${(readFileSync(serverFile).length / 1e6).toFixed(2)} MB, map ${(readFileSync(mapFile).length / 1e6).toFixed(2)} MB`);
