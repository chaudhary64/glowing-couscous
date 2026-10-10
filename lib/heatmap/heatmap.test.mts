/**
 * Heatmap tests — run with `npm run test:heatmap`.
 *
 * Node's built-in runner, no framework: the project has none, and the code under test
 * is pure functions that need nothing but `assert`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  distanceMetres,
  encodeGeohash,
  geohashBounds,
  geohashCenter,
  geohashNeighbours,
} from "@/lib/geo/geohash";
import { multiPolygonAreaKm2, multiPolygonContains, simplifyRing, type MultiPolygon } from "@/lib/geo/polygon";
import { fileLocation } from "@/lib/geo/areas";
import { DISTRICTS, districtForPoint } from "@/lib/geo/districts";
import { WARDS, wardForPoint } from "@/lib/geo/wards";

import { HOTSPOT_RULE, detectHotspots, wardPressure, withinWindow, type DetectionPoint } from "./cluster";

const NOW = new Date("2026-10-10T12:00:00Z");
const day = 86_400_000;

function point(id: string, latitude: number, longitude: number, daysAgo = 1, extra: Partial<DetectionPoint> = {}): DetectionPoint {
  return {
    id,
    latitude,
    longitude,
    recordedAt: new Date(NOW.getTime() - daysAgo * day),
    wardCode: "MCGM-L",
    category: "base",
    massG: 1000,
    itemId: null,
    label: null,
    ...extra,
  };
}

describe("geohash", () => {
  it("encodes the textbook example", () => {
    // Wikipedia's example point: 57.64911, 10.40744 → u4pruydqqvj
    assert.equal(encodeGeohash(57.64911, 10.40744, 11), "u4pruydqqvj");
  });

  it("round-trips through the cell centre", () => {
    const hash = encodeGeohash(19.0728, 72.8834, 7);
    const c = geohashCenter(hash);
    assert.equal(encodeGeohash(c.latitude, c.longitude, 7), hash);
    assert.ok(distanceMetres(c, { latitude: 19.0728, longitude: 72.8834 }) < 110);
  });

  it("gives a precision-7 cell of roughly 150 m in Mumbai", () => {
    const b = geohashBounds(encodeGeohash(19.07, 72.88, 7));
    const height = distanceMetres({ latitude: b.south, longitude: b.west }, { latitude: b.north, longitude: b.west });
    const width = distanceMetres({ latitude: b.south, longitude: b.west }, { latitude: b.south, longitude: b.east });
    assert.ok(height > 140 && height < 160, `height ${height}`);
    assert.ok(width > 135 && width < 160, `width ${width}`);
  });

  it("has eight distinct neighbours, all adjacent", () => {
    const hash = encodeGeohash(19.07, 72.88, 7);
    const n = geohashNeighbours(hash);
    assert.equal(new Set(n).size, 8);
    assert.ok(!n.includes(hash));
    for (const h of n) assert.ok(distanceMetres(geohashCenter(h), geohashCenter(hash)) < 230);
  });
});

describe("polygon", () => {
  // A 0.01° square with a 0.004° hole in the middle.
  const square: MultiPolygon = [[
    [[72.0, 19.0], [72.01, 19.0], [72.01, 19.01], [72.0, 19.01], [72.0, 19.0]],
    [[72.003, 19.003], [72.007, 19.003], [72.007, 19.007], [72.003, 19.007], [72.003, 19.003]],
  ]];

  it("respects holes", () => {
    assert.equal(multiPolygonContains(square, 19.001, 72.001), true);
    assert.equal(multiPolygonContains(square, 19.005, 72.005), false);
    assert.equal(multiPolygonContains(square, 19.02, 72.005), false);
  });

  it("computes area net of holes", () => {
    // ~1.052 km × ~1.113 km = 1.171 km², minus the hole (0.16 of it)
    const km2 = multiPolygonAreaKm2(square);
    assert.ok(Math.abs(km2 - 1.171 * 0.84) < 0.02, `area ${km2}`);
  });

  it("simplifies a straight ring down to its corners", () => {
    const ring: [number, number][] = [[0, 0], [0.5, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    assert.deepEqual(simplifyRing(ring, 0.01), [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
  });
});

describe("wards", () => {
  it("has all 24 BMC wards, each with a positive area", () => {
    assert.equal(WARDS.length, 24);
    for (const w of WARDS) assert.ok(w.areaKm2 > 1, w.code);
  });

  it("files known landmarks into the right ward", () => {
    assert.equal(wardForPoint(19.0718, 72.9236)?.code, "MCGM-ME"); // Deonar
    assert.equal(wardForPoint(19.0728, 72.8834)?.code, "MCGM-L"); // Kurla, LBS Marg
    assert.equal(wardForPoint(18.9067, 72.8147)?.code, "MCGM-A"); // Colaba
    assert.equal(wardForPoint(19.1726, 72.9565)?.code, "MCGM-T"); // Mulund station
  });

  it("refuses a point far outside the city", () => {
    assert.equal(wardForPoint(18.5204, 73.8567), null); // Pune
  });
});

describe("districts (all India)", () => {
  it("has India's 735 districts, each with a state, a code and a positive area", () => {
    assert.equal(DISTRICTS.length, 735);
    assert.equal(new Set(DISTRICTS.map((d) => d.code)).size, 735);
    for (const d of DISTRICTS) {
      assert.ok(d.state, `${d.name} has a state`);
      assert.ok(d.areaKm2 > 0, `${d.name} has an area`);
    }
  });

  it("files cities across India to the right district and state", () => {
    const cases: [number, number, string, RegExp][] = [
      [18.5286, 73.8743, "Pune", /^Mah/],
      [28.6315, 77.2167, "New Delhi", /^Delhi$/],
      [22.5646, 88.351, "Kolkata", /^West Bengal$/],
      [13.0827, 80.2707, "Chennai", /^Tamil/],
      [12.9757, 77.6061, "Bangalore", /^Karn/],
    ];
    for (const [lat, lng, name, state] of cases) {
      const d = districtForPoint(lat, lng);
      assert.equal(d?.name, name);
      assert.match(d?.state ?? "", state);
    }
  });

  it("files a Mumbai point to its BMC ward, and knows its district", () => {
    const f = fileLocation(19.0728, 72.8834); // Kurla
    assert.equal(f.area?.kind, "ward");
    assert.equal(f.area?.code, "MCGM-L");
    assert.equal(f.district?.name, "Mumbai Suburban");
  });

  it("keeps Thane out of Mumbai's wards", () => {
    const f = fileLocation(19.186, 72.975);
    assert.equal(f.area?.kind, "district");
    assert.equal(f.area?.name, "Thane");
  });

  it("files nothing at sea or abroad", () => {
    assert.equal(fileLocation(18.5, 71.0).area, null); // Arabian Sea
    assert.equal(fileLocation(27.7172, 85.324).area, null); // Kathmandu
  });
});

describe("hotspot detection", () => {
  const base = { latitude: 19.0728, longitude: 72.8834 };

  it(`needs ${HOTSPOT_RULE.minDetections} detections in a cell`, () => {
    const three = [1, 2, 3].map((i) => point(`p${i}`, base.latitude, base.longitude));
    assert.equal(detectHotspots(three, NOW).length, 0);
    const four = [...three, point("p4", base.latitude, base.longitude)];
    const found = detectHotspots(four, NOW);
    assert.equal(found.length, 1);
    assert.equal(found[0].detections.length, 4);
    assert.equal(found[0].code, `HS-${encodeGeohash(base.latitude, base.longitude, 7)}`);
  });

  it("ignores detections older than the window", () => {
    const points = [1, 2, 3, 4].map((i) => point(`p${i}`, base.latitude, base.longitude, i === 4 ? 22 : 2));
    assert.equal(withinWindow(points, NOW).length, 3);
    assert.equal(detectHotspots(points, NOW).length, 0);
  });

  it("joins groups within the radius into one site and keeps separate ones apart", () => {
    // 100 m east: within the radius, so one site. ~220 m east: its own site. 2 km north: its own.
    const metresEast = (m: number) => base.longitude + m / (111_320 * Math.cos((base.latitude * Math.PI) / 180));
    const near = { latitude: base.latitude, longitude: metresEast(100) };
    const apart = { latitude: base.latitude, longitude: metresEast(320) };
    const far = { latitude: base.latitude + 0.02, longitude: base.longitude };
    const pts = [
      ...[1, 2, 3, 4].map((i) => point(`a${i}`, base.latitude, base.longitude)),
      ...[1, 2, 3, 4].map((i) => point(`b${i}`, near.latitude, near.longitude)),
      ...[1, 2, 3, 4].map((i) => point(`d${i}`, apart.latitude, apart.longitude)),
      ...[1, 2, 3, 4, 5].map((i) => point(`c${i}`, far.latitude, far.longitude)),
    ];
    const found = detectHotspots(pts, NOW);
    assert.deepEqual(
      found.map((c) => c.detections.length),
      [8, 5, 4], // busiest first
    );
    assert.deepEqual(found[0].detections.map((p) => p.id[0]).sort().join(""), "aaaabbbb");
  });

  it("finds a site that straddles a cell edge (the grid-line bug)", () => {
    // Two detections a few metres west of a cell's east edge, two a few metres east of
    // it: 2 + 2 per cell, which the old per-cell count never called a site.
    const cell = geohashBounds(encodeGeohash(base.latitude, base.longitude, 7));
    const mid = (cell.south + cell.north) / 2;
    const step = 0.00005; // ~5 m
    const pts = [
      point("w1", mid, cell.east - step),
      point("w2", mid + step, cell.east - step),
      point("e1", mid, cell.east + step),
      point("e2", mid + step, cell.east + step),
    ];
    const found = detectHotspots(pts, NOW);
    assert.equal(found.length, 1);
    assert.equal(found[0].detections.length, 4);
    assert.equal(found[0].cells.length, 2);
  });

  it("does not call four scattered detections a site", () => {
    // Each ~300 m from the next: never four within the radius of any one of them.
    const pts = [0, 1, 2, 3].map((i) => point(`s${i}`, base.latitude + i * 0.0027, base.longitude));
    assert.equal(detectHotspots(pts, NOW).length, 0);
  });

  it(`joins detections within ${HOTSPOT_RULE.radiusM} m and leaves one further out alone`, () => {
    const metre = 1 / 111_320;
    const pts = [
      ...[0, 1, 2, 3].map((i) => point(`n${i}`, base.latitude + i * 30 * metre, base.longitude)), // 0–90 m
      point("edge", base.latitude + 200 * metre, base.longitude), // 110 m past the last: a border point
      point("out", base.latitude + 600 * metre, base.longitude), // far: not part of it
    ];
    const [site, ...rest] = detectHotspots(pts, NOW);
    assert.equal(rest.length, 0);
    assert.deepEqual(site.detections.map((p) => p.id).sort(), ["edge", "n0", "n1", "n2", "n3"]);
  });

  it("reports hazard share, dominant category and first/last sighting", () => {
    const pts = [
      point("h1", base.latitude, base.longitude, 10, { category: "hazardous" }),
      point("h2", base.latitude, base.longitude, 5, { category: "hazardous" }),
      point("h3", base.latitude, base.longitude, 3, { category: "hazardous" }),
      point("b1", base.latitude, base.longitude, 1, { category: "base" }),
    ];
    const [site] = detectHotspots(pts, NOW);
    assert.equal(site.topCategory, "hazardous");
    assert.equal(site.hazardShare, 0.75);
    assert.equal(site.firstSeenAt.getTime(), NOW.getTime() - 10 * day);
    assert.equal(site.lastSeenAt.getTime(), NOW.getTime() - 1 * day);
    assert.equal(site.totalMassG, 4000);
  });

  it("is deterministic regardless of input order", () => {
    const pts = [
      ...[1, 2, 3, 4, 5].map((i) => point(`a${i}`, base.latitude, base.longitude, i)),
      ...[1, 2, 3, 4].map((i) => point(`b${i}`, base.latitude + 0.01, base.longitude, i)),
    ];
    const summary = (list: DetectionPoint[]) => detectHotspots(list, NOW).map((c) => [c.code, c.detections.length]);
    assert.deepEqual(summary(pts), summary([...pts].reverse()));
  });
});

describe("ward pressure", () => {
  it("scales the busiest ward to 100 by detections per km²", () => {
    const pts = [
      ...[1, 2, 3, 4].map((i) => point(`l${i}`, 19.07, 72.88, 1, { wardCode: "A" })),
      ...[1, 2].map((i) => point(`m${i}`, 19.07, 72.88, 1, { wardCode: "B" })),
    ];
    const rows = wardPressure(pts, [], [
      { code: "A", areaKm2: 2 },
      { code: "B", areaKm2: 0.5 },
      { code: "C", areaKm2: 1 },
    ]);
    assert.deepEqual(rows.map((r) => [r.wardCode, r.pressure]), [["B", 100], ["A", 50], ["C", 0]]);
  });
});
