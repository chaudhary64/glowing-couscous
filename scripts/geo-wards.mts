/**
 * Build `lib/geo/data/bmc-wards.json` from DataMeet's BMC ward boundaries.
 *
 *   curl -sO https://raw.githubusercontent.com/datameet/Municipal_Spatial_Data/master/Mumbai/BMC_Wards.geojson
 *   node --import ./scripts/ts-paths.mjs scripts/geo-wards.mts BMC_Wards.geojson
 *
 * The source is ~1 MB of survey-grade outline. The map needs a shape a ward officer
 * recognises, not a cadastral survey, so each ring is simplified to ~10 m and every
 * coordinate rounded to 5 decimals (~1 m). Area and centroid are computed from the
 * *unsimplified* source, so the density figures do not drift with the drawing.
 *
 * Licence: the boundaries are © DataMeet Trust (Pune chapter), CC BY-SA 2.5 India.
 * The generated file is a derivative and carries the same licence and attribution in
 * its own header, which `/map` repeats on screen.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import {
  multiPolygonAreaKm2,
  multiPolygonCentroid,
  simplifyRing,
  type MultiPolygon,
} from "@/lib/geo/polygon";

/** BMC administrative ward letters → the neighbourhoods people actually call them. */
const NAMES: Record<string, string> = {
  A: "Colaba, Fort",
  B: "Sandhurst Road, Dongri",
  C: "Marine Lines, Kalbadevi",
  D: "Grant Road, Malabar Hill",
  E: "Byculla",
  "F/S": "Parel, Sewri",
  "F/N": "Matunga, Sion",
  "G/S": "Worli, Lower Parel",
  "G/N": "Dadar, Dharavi",
  "H/E": "Bandra East, Santacruz East",
  "H/W": "Bandra West, Khar",
  "K/E": "Andheri East",
  "K/W": "Andheri West",
  L: "Kurla",
  "M/E": "Deonar, Govandi",
  "M/W": "Chembur",
  N: "Ghatkopar",
  "P/S": "Goregaon",
  "P/N": "Malad",
  "R/S": "Kandivali",
  "R/C": "Borivali",
  "R/N": "Dahisar",
  S: "Bhandup",
  T: "Mulund",
};

const TOLERANCE_DEG = 0.0001; // ~10 m
const round = (n: number) => Math.round(n * 1e5) / 1e5;

const input = process.argv[2];
if (!input) {
  console.error("usage: geo-wards.mts <BMC_Wards.geojson>");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(input, "utf8")) as {
  features: { properties: { name: string }; geometry: { type: string; coordinates: MultiPolygon } }[];
};

const wards = raw.features
  .map((feature) => {
    const letter = feature.properties.name.trim();
    if (feature.geometry.type !== "MultiPolygon") throw new Error(`${letter}: ${feature.geometry.type}`);
    const source = feature.geometry.coordinates;
    const name = NAMES[letter];
    if (!name) throw new Error(`No neighbourhood name for ward ${letter}`);
    const centroid = multiPolygonCentroid(source);
    const boundary: MultiPolygon = source
      .map((polygon) =>
        polygon.map((ring) =>
          simplifyRing(ring, TOLERANCE_DEG).map(([lng, lat]) => [round(lng), round(lat)] as [number, number]),
        ),
      )
      // Slivers that simplify to a triangle carry nothing a viewer can see.
      .filter((polygon) => polygon[0].length >= 4);
    return {
      code: `MCGM-${letter.replace("/", "")}`,
      letter,
      name: `${letter} Ward (${name})`,
      areaKm2: Math.round(multiPolygonAreaKm2(source) * 100) / 100,
      centroid: { latitude: round(centroid.latitude), longitude: round(centroid.longitude) },
      boundary,
    };
  })
  .sort((a, b) => a.code.localeCompare(b.code));

const out = {
  source: "https://github.com/datameet/Municipal_Spatial_Data/tree/master/Mumbai",
  attribution: "Ward boundaries © DataMeet Trust (Pune chapter), CC BY-SA 2.5 India",
  license: "CC-BY-SA-2.5-IN",
  city: "Mumbai",
  simplifiedToleranceDeg: TOLERANCE_DEG,
  wards,
};

const target = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "lib", "geo", "data", "bmc-wards.json");
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(out) + "\n");
const points = wards.reduce((n, w) => n + w.boundary.flat(2).length, 0);
console.log(`wrote ${wards.length} wards, ${points} vertices → ${target}`);
for (const w of wards) console.log(`${w.code.padEnd(10)} ${String(w.areaKm2).padStart(6)} km²  ${w.name}`);
