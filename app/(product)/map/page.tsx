import { HotspotTable } from "@/components/features/heatmap/hotspot-table";
import { WardDensity } from "@/components/features/heatmap/ward-density";
import { WardMap } from "@/components/features/heatmap/ward-map";
import { VanRound } from "@/components/features/product/map/van-round";
import { Badge } from "@/components/ui/badge";
import { Panel, Surface } from "@/components/ui/card";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { requireAccess } from "@/lib/auth/dal";
import { heatmapStats, hotspots, wards } from "@/lib/data/wards";

export const instant = false;

const limits = [
  "Positions are normalised pilot coordinates from the ward grid, not a street basemap — the place names in the table carry the geography.",
  "It reports where pickups happened, not where vans are now; nothing here is live vehicle tracking.",
  "A cluster is a routing suggestion for a ward officer, never an accusation about a site or a person.",
];

export default async function HotspotMapPage() {
  await requireAccess("/map");

  const topWard = wards.reduce(
    (worst, ward) => (ward.density > worst.density ? ward : worst),
    wards[0],
  );

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Network · Municipal"
        title="Hotspot map"
        lede="Every pickup is geotagged at intake. Clustered, those points tell a ward officer where the next collection van should stand."
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone="ink">{heatmapStats.clustering}</Badge>
            <Badge tone="lead">
              Pilot ward · {heatmapStats.topWard}
            </Badge>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              {wards.length} wards indexed
            </span>
          </div>
        }
      />

      <StatGrid columns={4}>
        <Stat
          label="Geotagged pickups"
          value={heatmapStats.geotaggedPickups.toLocaleString("en-IN")}
          note="Coordinates captured at intake, not typed in afterwards."
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
          note="Clusters past the detection threshold and still waiting for a van."
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
            eyebrow="Ward pressure"
            title="Where the load is concentrated"
            note="Marker area scales with density, so a glance gives the ranking before you read a number."
          />
          <Surface className="mt-4 p-4">
            <WardMap wards={wards} />
          </Surface>
        </div>

        <div>
          <SectionHeader
            eyebrow="Ward ranking"
            title="The same numbers, sortable"
            note="The picture briefs a ward officer; this list is what they actually work from."
          />
          <Surface className="mt-4 p-4">
            <WardDensity wards={wards} />
          </Surface>
        </div>
      </section>

      <section>
        <SectionHeader
          eyebrow="Action"
          title="Turn clusters into a round"
          note="Cleared clusters drop off the round; the rest are ordered by detection count."
        />
        <div className="mt-4">
          <VanRound hotspots={hotspots} wards={wards} />
        </div>
      </section>

      <section>
        <SectionHeader
          eyebrow="Clusters"
          title="Every site on record"
          note="Four or more detections inside one geohash group, in a rolling 21-day window."
        />
        <Surface className="mt-4 p-4">
          <HotspotTable hotspots={hotspots} wards={wards} />
        </Surface>
      </section>

      <section>
        <Panel eyebrow="Limits" title="What this screen is not">
          <ul className="flex flex-col gap-3">
            {limits.map((limit) => (
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
