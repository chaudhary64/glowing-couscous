# Spatial heatmapping

The hotspot map used to be a picture of eight hand-placed ward markers with typed-in
densities, and its captions promised an OpenSearch geohash index fed from DynamoDB. None
of that existed: intake never asked for a location, no `intakes` row was ever written, and
there was nothing real to cluster.

This is the version that works. A collector's submission can now carry a GPS fix, the
intake is filed to a real Mumbai ward, and `/map` clusters those points into collection
sites on an actual street map — with the same rule the screen always printed.

## The loop

```
intake screen ── one tap: GPS fix ──▶ POST /api/ai/intake
                                         │ analyse (Foundry) ─┐
                                         │ archive (S3 + media_assets) ─┤ both settle
                                         ▼                               ▼
                               lib/intake/record.ts — one transaction:
                               intakes → items → material_lines, item_hazards,
                               gatekeeper_verdicts → geopoints (filed to a BMC ward)
                                         │
/map ── getHeatmap() ◀── geopoints (last 30 days, gatekeeper-rejected excluded)
          │  detectHotspots(): ~150 m cells, ≥4 in 21 days, touching cells merged
          │  wardPressure():   detections per km², busiest ward = 100
          ▼
     MapLibre + OpenFreeMap: wards shaded, heat by recency, sites at true radius
          │
          └─ POST /api/heatmap/dispatch (operator+): assign van / clear / reopen
```

## Decisions

**Postgres, not OpenSearch.** The original plan named "OpenSearch (local, open-source
requirement)". Amplify Hosting cannot reach a locally run OpenSearch, and at this volume —
a few thousand points — bucketing into geohash cells in TypeScript takes milliseconds. The
open-source requirement is met by the map stack instead: MapLibre GL (BSD-3), OpenFreeMap,
OpenStreetMap data.

**No PostGIS.** `db/schema/geo.ts` already argued this. Ward boundaries are GeoJSON in
`wards.boundary_geojson` and in `lib/geo/data/bmc-wards.json`; filing a point is
point-in-polygon in `lib/geo/polygon.ts`. When the platform needs spatial joins at scale,
that is the moment to enable the extension.

**Clusters are computed on read, never stored as numbers.** `detectHotspots` is a pure
function of the points and a clock. `hotspot_clusters` stores only what a person decided —
a van was assigned, a site was cleared — keyed by the cluster's code. A stored count is
right until the first deletion; a computed one cannot drift.

**Stable cluster codes.** A site's code is `HS-` + the lowest geohash cell it covers. New
detections do not change it, so a van assignment survives a recompute. A site that grows
into a new cell with a lower hash would get a new code — the rare case, and a fresh status
is the honest outcome.

**Rejected items do not count.** A gatekeeper-rejected submission is a plastic bottle or a
photo of a photo. Counting it would let anyone with a phone draw a hotspot.

**Pressure is relative.** Detections per km², scaled so the busiest ward reads 100. The old
"94/100" read like an absolute measurement and was typed in by hand. A ratio is computable
and still answers the only question asked of it: where is the load concentrated.

**Real data only.** There is no sample, fixture or fallback anywhere in the feature. With
no geotagged intakes `/map` is empty and says what would fill it. A synthetic sample was
built and then removed: an invented hotspot in a real city is a false statement about a
real place, however clearly it is labelled. The dashboard's hotspot figures and the nav no
longer use fixtures either — the dashboard computes them with the same `getHeatmap()` call,
and the fixture count on the nav badge was dropped because a client component cannot read
the database. The public write-up (`/doc/features/heatmap`) shows the real ward geography
and the rule, and no data, because a point is where a collector stood.

**Cleared sites reopen.** A site an operator cleared reads as open again as soon as a
detection lands after the clearance, so an old decision cannot hide a returning dump.

## Privacy

- Location is opt-in per submission: one explicit tap, and a refusal still gets the
  collector paid. A fix with accuracy worse than 2 km is dropped (a cell-tower guess would
  file the pickup in the wrong ward).
- Exact coordinates are stored on the intake, because they are evidence. Points leave the
  server **snapped to a ~38 m geohash cell** (precision 8): the map shows the street, never
  the doorway a collector stood at.
- A site is a routing suggestion for a ward officer, never an accusation about a place or
  a person. The screen says so.

## Ward data

The 24 BMC administrative wards come from DataMeet's
[Municipal Spatial Data](https://github.com/datameet/Municipal_Spatial_Data/tree/master/Mumbai),
**© DataMeet Trust (Pune chapter), CC BY-SA 2.5 India**. The generated file is a
derivative under the same licence and carries the attribution, which `/map` shows on the
map and in its limits panel.

To regenerate (e.g. after a boundary update):

```bash
mkdir -p .tmp-geo
curl -s -o .tmp-geo/bmc.geojson https://raw.githubusercontent.com/datameet/Municipal_Spatial_Data/master/Mumbai/BMC_Wards.geojson
npm run geo:wards -- .tmp-geo/bmc.geojson
```

Rings are simplified to ~10 m and rounded to 5 decimals (≈56 KB, from ≈1 MB); area and
centroid are computed from the unsimplified source. Ward codes are `MCGM-<letter>`
(`MCGM-ME` is M/East), the value `intakes.ward_code`, `items.ward_code` and `wards.code`
join on. The `wards` table is populated on first use by `ensureWards()`.

## The map stack

- `maplibre-gl` **6.11.2**, pinned exactly. MapLibre 6 is ESM-only and finds its web
  worker next to its own module file, which does not exist once Turbopack bundles it.
  `scripts/vendor-maplibre.mjs` (run as `predev` / `prebuild`) copies the worker into
  `public/vendor/maplibre-gl-<version>/`, and the component calls `setWorkerUrl()`.
  `proxy.ts` exempts `/vendor/` — without that the worker request is redirected to
  `/login` and the map never starts.
- Basemap: `https://tiles.openfreemap.org/styles/positron`. No key, no usage cap. If tiles
  are unreachable the map shows a message and the tables below still carry every number.
- MapLibre's stylesheet sets `position: relative` on the map container, which beats a
  Tailwind `absolute inset-0`; the container is positioned inline for that reason.

## Access

| Action | Path guarded | Rank |
|---|---|---|
| View `/map`, `GET /api/heatmap` | `/map` | any role |
| Assign van, clear, reopen, recompute — `POST /api/heatmap/dispatch` | `/map/dispatch` | operator or above |

`map-dispatch` is listed **before** `map` in `GUARDS`, because `guardFor` takes the first
match; below it, `/map` would cover `/map/dispatch` and any viewer could dispatch.

## API

```
GET  /api/heatmap?category=hazardous&hazardous=1
POST /api/heatmap/dispatch   { "code": "HS-te7ud2h", "status": "van_assigned" | "cleared" | "open" }
POST /api/heatmap/dispatch   { "action": "recompute" }   # rewrites hotspot_detections
```

A dispatch on a code that does not cluster in the current window is refused (404): a stale
screen cannot send a van to a site the data no longer supports.

## Checks

```bash
npm run test:heatmap   # 16 tests: geohash, polygons, ward filing, the hotspot rule, pressure

# 18 integration tests: the real modules against a real, migrated Postgres. Refuses any
# host but localhost, so it can never write test rows into the shared RDS.
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres npx drizzle-kit migrate
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55432/postgres npm run test:heatmap:db
npx tsc --noEmit
npm run lint
npm run build
```

## What is not built

- **No road network.** The van round is a priority order by detection count, not a route.
- **No live vehicle tracking.** The map reports where pickups happened.
- **Pickups are not geotagged yet.** Only intakes carry a geopoint; `geopoints.pickup_id`
  is unused until the pickup board is wired to the database.
- **No scheduled recompute.** Clusters are computed on read, so none is needed for the
  screen; `hotspot_detections` is only rewritten when an operator acts or asks for it.
- **Mumbai only.** Points outside the 24 wards are recorded but not filed to a ward. A
  second city is a second boundary file and a `city` filter, not a redesign.
- **Not yet run with a real signed-in submission.** Every database path — recording an
  intake, ward filing, idempotency, atomic rollback, the heatmap read, the filter, dispatch,
  auto-reopen and recompute — passes against the real migrated schema in a disposable
  Postgres (`test:heatmap:db`), and the read path runs cleanly against RDS. What has not
  happened is a real photo, through Cognito sign-in, the live model and S3, filed to RDS.
- **Database errors shown to operators are the Postgres reason only** (`lib/db-error.ts`):
  Drizzle's "Failed query: … params: …" text, which carries the SQL and submitted values,
  goes to the server log and never to a screen.
