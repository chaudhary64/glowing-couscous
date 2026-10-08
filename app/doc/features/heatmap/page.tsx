import Link from "next/link";
import { HotspotTable } from "@/components/features/heatmap/hotspot-table";
import { WardDensity } from "@/components/features/heatmap/ward-density";
import { WardMap } from "@/components/features/heatmap/ward-map";
import { Badge } from "@/components/ui/badge";
import { Panel, Surface } from "@/components/ui/card";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { getFeature } from "@/lib/data/features";
import { heatmapStats, hotspots, wards } from "@/lib/data/wards";

export default function HeatmapPage() {
  const feature = getFeature("heatmap");
  const topWard = wards.reduce(
    (worst, ward) => (ward.density > worst.density ? ward : worst),
    wards[0],
  );

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        feature={feature}
        lede="Every pickup is geotagged. Cluster those points and a ward officer can see where the next collection van should stand."
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone="lead">Supporting · rank 05</Badge>
            <Badge tone="ink">{heatmapStats.clustering}</Badge>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              Pilot ward · {heatmapStats.topWard}
            </span>
          </div>
        }
      />

      <Panel
        tone="inset"
        eyebrow="Who this screen is for"
        title="A second customer, downstream of the loop"
      >
        <div className="flex flex-col gap-3">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
            This is the only screen in the prototype that does not touch a
            collector&apos;s payout. It reads the same pickup stream that{" "}
            <Link
              href="/pickups"
              className="underline decoration-rule underline-offset-2 hover:decoration-copper"
            >
              pickup &amp; credit
            </Link>{" "}
            writes, and turns it into a municipal answer: which ward is carrying the
            dumping pressure, and where a van should be sent next.
          </p>
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
            That is why it ranks fifth rather than first. It is strong on stage and
            genuinely useful to a ward officer, but the EPR claim still stands or
            falls on{" "}
            <Link
              href="/valuation"
              className="underline decoration-rule underline-offset-2 hover:decoration-copper"
            >
              valuation
            </Link>{" "}
            and the{" "}
            <Link
              href="/validation"
              className="underline decoration-rule underline-offset-2 hover:decoration-copper"
            >
              gatekeeper
            </Link>
            .
          </p>
        </div>
      </Panel>

      <StatGrid columns={4}>
        <Stat
          label="Geotagged pickups"
          value={heatmapStats.geotaggedPickups.toLocaleString("en-IN")}
          note="Coordinates captured at intake, not typed afterwards."
        />
        <Stat
          label="Wards covered"
          value={String(heatmapStats.wardsCovered)}
          note="Mumbai pilot wards with at least one verified pickup."
        />
        <Stat
          label="Open hotspots"
          value={String(heatmapStats.openHotspots)}
          emphasis
          note="Clusters awaiting a van assignment."
        />
        <Stat
          label="Highest pressure"
          value={String(topWard.density)}
          unit="/100"
          note={`${topWard.name} — ${topWard.pickups} pickups, ${topWard.flaggedSites} flagged sites.`}
        />
      </StatGrid>

      <section className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div>
          <SectionHeader
            eyebrow="Ward map"
            title="Dumping pressure by ward"
            note="Clustering is a geohash grid with a 150 m cell, run on OpenSearch locally to satisfy the open-source requirement."
          />
          <Surface className="mt-4 p-4">
            <WardMap wards={wards} />
          </Surface>
        </div>

        <div>
          <SectionHeader
            eyebrow="Ward density"
            title="The same numbers, sortable"
            note="The picture is for a briefing; this ranking is what a ward officer actually works from."
          />
          <Surface className="mt-4 p-4">
            <WardDensity wards={wards} />
          </Surface>
        </div>
      </section>

      <section>
        <SectionHeader
          eyebrow="Hotspots"
          title="Clustered dumping sites"
          note="Four or more detections inside one geohash group, in a rolling 21-day window."
        />
        <Surface className="mt-4 p-4">
          <HotspotTable hotspots={hotspots} wards={wards} />
        </Surface>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Panel eyebrow="How it is built" title="Coordinates to clusters">
          <ul className="flex flex-col gap-3">
            {[
              "Intake writes latitude and longitude to DynamoDB with every verified pickup.",
              "A Lambda syncs new points into an OpenSearch geohash index at a 150 m cell size.",
              "Cell groups with four or more detections in 21 days are promoted to a cluster.",
              "Clusters render here as a gridded surface — no basemap tiles, no map library.",
            ].map((step) => (
              <li key={step} className="flex gap-3 text-sm leading-relaxed">
                <span aria-hidden className="mt-2 size-2 shrink-0 bg-copper" />
                <span className="text-ink-soft">{step}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel eyebrow="Limits" title="What this screen is not">
          <ul className="flex flex-col gap-3">
            {[
              "Not geography. Positions are normalised pilot coordinates, so it cannot be overlaid on a real street map as drawn.",
              "Not live tracking. It reports where pickups happened, not where vans are now.",
              "Not enforcement. A cluster is a routing suggestion for a municipal officer, never an accusation about a site.",
            ].map((limit) => (
              <li key={limit} className="flex gap-3 text-sm leading-relaxed">
                <span aria-hidden className="mt-2 size-2 shrink-0 bg-lead" />
                <span className="text-ink-soft">{limit}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </section>
    </div>
  );
}
