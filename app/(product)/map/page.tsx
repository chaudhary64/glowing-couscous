import Link from "next/link";

import { DispatchButtons, HeatmapExplorer } from "@/components/features/heatmap/heatmap-explorer";
import { HotspotTable } from "@/components/features/heatmap/hotspot-table";
import { WardDensity } from "@/components/features/heatmap/ward-density";
import { VanRound } from "@/components/features/product/map/van-round";
import { Badge } from "@/components/ui/badge";
import { Panel, Surface } from "@/components/ui/card";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { requireAccess } from "@/lib/auth/dal";
import { canOpen } from "@/lib/auth/roles";
import { cn } from "@/lib/cn";
import { DISTRICTS, DISTRICT_SOURCE } from "@/lib/geo/districts";
import { WARD_SOURCE } from "@/lib/geo/wards";
import { getHeatmap } from "@/lib/heatmap/store";
import { toDistricts, toHotspot, toWards } from "@/lib/heatmap/view";

export const instant = false;

type Search = { hazardous?: string };

/**
 * The hotspot map, on real geography.
 *
 * Every screen element below renders from one `getHeatmap()` call, so the map, the
 * stats, the ward ranking and the van round can never disagree. The one switch — all items
 * or hazardous only — is a URL parameter for the same reason: the server renders one
 * consistent answer and a link reproduces it.
 *
 * Every number is computed from real geotagged intakes. There is no sample and no fixture:
 * with no data the map is empty, and the page says what would fill it.
 */
export default async function HotspotMapPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireAccess("/map");
  const params = await searchParams;
  const canDispatch = canOpen("/map/dispatch", user.role).ok;

  const hazardousOnly = params.hazardous === "1";
  const data = await getHeatmap({ filter: { hazardousOnly } });

  const wards = toWards(data);
  const districts = toDistricts(data);
  const hotspots = data.clusters.map(toHotspot);
  const byCode = new Map(data.clusters.map((c) => [c.code, c]));
  const inWindow = data.points.filter((p) => p.ageDays <= data.rule.windowDays);
  const districtsWithPoints = data.districts.length;
  const open = data.clusters.filter((c) => c.status === "open").length;
  const top = data.districts[0];
  const empty = data.livePointCount === 0;
  const href = (hazardous: boolean) => (hazardous ? "/map?hazardous=1" : "/map");

  const toggle = (active: boolean) =>
    cn(
      "border-[3px] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]",
      active ? "border-ink bg-ink text-paper" : "border-rule bg-paper-raised text-ink hover:border-ink",
    );

  const limits = [
    `Every point is a real intake: ${data.livePointCount} geotagged in the last ${data.rule.windowDays} days. Submissions the gatekeeper rejected are not counted — a photo of a bottle is not e-waste pressure.`,
    "Only intakes made with \"Use this device\u2019s location\" appear. An intake without a fix is still recorded and paid; it just adds no point here.",
    "Points are snapped to a ~38 m cell before they leave the server. The map shows where pickups cluster, never the doorway a collector stood at.",
    "Pressure is relative: detections per km², scaled so the busiest district (or, inside Mumbai, ward) reads 100. It ranks areas against each other; it is not an absolute measure of dumping.",
    "District outlines are the 2021 Local Government Directory set, simplified to about 1 km. A fix within 5 km of an outline (a shoreline, a border river) is filed to the nearest district; one further out, at sea or abroad, is recorded but not filed.",
    "It reports where pickups happened, not where vans are now — nothing here is live vehicle tracking. The van round is a priority order, not a driving route.",
    "A site is a routing suggestion for a ward officer, never an accusation about a place or a person.",
  ];

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Network · Municipal"
        title="Hotspot map"
        lede="Every geotagged intake anywhere in India is filed to its district (and, in Mumbai, to its BMC ward). Where four or more land within 150 m of each other within three weeks, that spot is a site, and an operator can see where the next collection van should stand."
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone={data.configured ? "verified" : "hazard"}>
              {data.configured ? "Live intakes" : "No database"}
            </Badge>
            <Badge tone="ink">4 within {data.rule.radiusM} m · {data.rule.windowDays}-day window</Badge>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              {DISTRICTS.length} districts · {data.livePointCount} geotagged intake{data.livePointCount === 1 ? "" : "s"} in window
            </span>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">Items</span>
          <Link href={href(false)} className={toggle(!hazardousOnly)}>
            All
          </Link>
          <Link href={href(true)} className={toggle(hazardousOnly)}>
            Hazardous only
          </Link>
        </div>
        {data.error ? <Badge tone="hazard">Database error: {data.error}</Badge> : null}
      </div>

      <StatGrid columns={4}>
        <Stat
          label="Detections in window"
          value={inWindow.length.toLocaleString("en-IN")}
          note="Geotagged at intake, gatekeeper-accepted."
        />
        <Stat
          label="Districts with pickups"
          value={`${districtsWithPoints}`}
          unit={`/ ${DISTRICTS.length}`}
          note="India's districts, filed by boundary; Mumbai also by BMC ward."
        />
        <Stat
          label="Open sites"
          value={String(open)}
          emphasis
          note={`Cells with ${data.rule.minDetections}+ detections in ${data.rule.windowDays} days, no van yet.`}
        />
        <Stat
          label="Highest pressure"
          value={top && top.detections > 0 ? `${top.perKm2}` : "—"}
          unit={top && top.detections > 0 ? "/km²" : undefined}
          note={top && top.detections > 0 ? `${top.name} — ${top.detections} detections.` : "No detections in the window."}
        />
      </StatGrid>

      {empty ? (
        <Panel tone="inset" eyebrow="No data yet" title="The map fills from real intakes">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
            {data.configured
              ? "No intake with a location has been recorded in the last three weeks, so there is nothing to cluster. "
              : "There is no database connection, so no intakes can be read. "}
            Submit an item from{" "}
            <Link href="/intake" className="underline decoration-rule underline-offset-2 hover:decoration-copper">
              Intake
            </Link>{" "}
            and tap <span className="font-medium">Use this device\u2019s location</span>: the point is filed to its district
            (its BMC ward in Mumbai) and appears here. A site is drawn once four intakes land within ~150 m of each other inside{" "}
            {data.rule.windowDays} days.
          </p>
        </Panel>
      ) : null}

      <section>
        <SectionHeader
          eyebrow="Map"
          title="Where the load is concentrated"
          note="Districts shaded by pressure across India, Mumbai's wards from city zoom, heat by recency, and every detected site at its true radius. Click a site to inspect it."
        />
        <div className="mt-4">
          <HeatmapExplorer data={data} canDispatch={canDispatch} />
        </div>
      </section>

      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <SectionHeader
            eyebrow="District ranking · India"
            title="Pressure by district"
            note="Score is detections per km², relative to the busiest district (= 100). The note under each bar is detections and detected sites."
          />
          <Surface className="mt-4 p-4">
            <WardDensity wards={districts.slice(0, 12)} />
          </Surface>
          {wards.some((w) => w.pickups > 0) ? (
            <>
              <SectionHeader
                className="mt-8"
                eyebrow="Ward ranking · Mumbai"
                title="Pressure by BMC ward"
                note="Inside Mumbai the same score is kept per BMC ward, the unit a van is dispatched to."
              />
              <Surface className="mt-4 p-4">
                <WardDensity wards={wards.filter((w) => w.pickups > 0).slice(0, 12)} />
              </Surface>
            </>
          ) : null}
        </div>
        <div>
          <SectionHeader eyebrow="Action" title="Turn sites into a round" note="Cleared sites drop off; the rest are ordered by detection count." />
          <div className="mt-4">
            <VanRound
              hotspots={hotspots}
              wards={wards}
              actions={(spot) => {
                const cluster = byCode.get(spot.id);
                return cluster ? <DispatchButtons cluster={cluster} canDispatch={canDispatch} /> : null;
              }}
              note={
                <>
                  {hotspots.filter((h) => h.status !== "cleared").length} sites on the round, ordered by detection count — a
                  priority list, not a driving route.
                </>
              }
            />
          </div>
        </div>
      </section>

      <section>
        <SectionHeader
          eyebrow="Sites"
          title="Every site in the window"
          note="Codes are stable: a site keeps its code across recomputes, so a van assignment survives new detections."
        />
        <Surface className="mt-4 p-4">
          <HotspotTable hotspots={hotspots} wards={wards} />
        </Surface>
      </section>

      <section>
        <Panel eyebrow="Limits" title="What this screen is, and is not">
          <ul className="flex flex-col gap-3">
            {limits.map((limit) => (
              <li key={limit} className="flex gap-3 text-sm leading-relaxed">
                <span aria-hidden className="mt-2 size-2 shrink-0 bg-lead" />
                <span className="text-ink-soft">{limit}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 border-t border-rule pt-3 text-[12px] leading-relaxed text-ink-muted">
            {DISTRICT_SOURCE.attribution}. {WARD_SOURCE.attribution}. Basemap © OpenStreetMap contributors, served by OpenFreeMap.
          </p>
        </Panel>
      </section>
    </div>
  );
}
