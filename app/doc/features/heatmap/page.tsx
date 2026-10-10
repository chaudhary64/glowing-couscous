import Link from "next/link";
import { WardOutline } from "@/components/features/heatmap/ward-outline";
import { Badge } from "@/components/ui/badge";
import { Panel, Surface } from "@/components/ui/card";
import { PageHeader, SectionHeader } from "@/components/ui/page-header";
import { getFeature } from "@/lib/data/features";
import { HOTSPOT_RULE } from "@/lib/heatmap/cluster";

/**
 * The public write-up for spatial heatmapping.
 *
 * Public, so it shows no live data: intake locations are where collectors stood, and they
 * stay behind the sign-in at `/map`. What it shows instead is real and safe to publish —
 * the ward geography every point is filed into, and the exact rule that turns points into
 * sites. No figure on this page is a fixture.
 */
export default function HeatmapPage() {
  const feature = getFeature("heatmap");
  const link = "underline decoration-rule underline-offset-2 hover:decoration-copper";

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        feature={feature}
        lede="Every intake can carry a GPS fix. Filed into Mumbai's real wards and clustered, those points tell a ward officer where the next collection van should stand."
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone="lead">Supporting · rank 05</Badge>
            <Badge tone="ink">4 within {HOTSPOT_RULE.radiusM} m · {HOTSPOT_RULE.windowDays}-day window</Badge>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">24 BMC wards</span>
          </div>
        }
      />

      <Panel tone="inset" eyebrow="Who this screen is for" title="A second customer, downstream of the loop">
        <div className="flex flex-col gap-3">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
            This is the only screen in the app that does not touch a collector&apos;s payout. It reads the
            intakes that{" "}
            <Link href="/intake" className={link}>
              intake
            </Link>{" "}
            records — the ones submitted with a location and accepted by the gatekeeper — and turns them into a
            municipal answer: which ward is carrying the load, and where a van should be sent next.
          </p>
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
            That is why it ranks fifth rather than first. It is genuinely useful to a ward officer, but the EPR
            claim still stands or falls on{" "}
            <Link href="/valuation" className={link}>
              valuation
            </Link>{" "}
            and the{" "}
            <Link href="/validation" className={link}>
              gatekeeper
            </Link>
            .
          </p>
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">
            The live map, with real points and sites, is at{" "}
            <Link href="/map" className={link}>
              /map
            </Link>{" "}
            behind sign-in. This page shows no live data on purpose: a point is where a collector stood.
          </p>
        </div>
      </Panel>

      <section className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <SectionHeader eyebrow="Geography" title="The wards every point is filed into" note="Real boundaries, not a schematic. No data is drawn here." />
          <Surface className="mt-4 p-4">
            <WardOutline />
          </Surface>
        </div>
        <div className="flex flex-col gap-6">
          <Panel eyebrow="The rule" title="When a cluster of points becomes a site">
            <ul className="flex flex-col gap-3">
              {[
                `Points are bucketed into geohash cells at precision ${HOTSPOT_RULE.cellPrecision} — about 150 m × 145 m in Mumbai.`,
                `A cell with ${HOTSPOT_RULE.minDetections} or more detections in the last ${HOTSPOT_RULE.windowDays} days is hot.`,
                "Hot cells that touch, including diagonally, are one site — a dump does not stop at a grid line.",
                "Ward pressure is detections per km², relative to the busiest ward (= 100). It ranks wards; it is not an absolute measure.",
                "Items the gatekeeper rejected are never counted. A cleared site reopens on its own if new detections arrive.",
              ].map((step) => (
                <li key={step} className="flex gap-3 text-sm leading-relaxed">
                  <span aria-hidden className="mt-2 size-2 shrink-0 bg-copper" />
                  <span className="text-ink-soft">{step}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Panel eyebrow="How it is built" title="Coordinates to sites">
          <ul className="flex flex-col gap-3">
            {[
              "Intake asks the handset for a GPS fix with one tap, and writes the intake, the item and a geopoint to Postgres (RDS) in one transaction.",
              "The point is filed to one of the 24 BMC wards by its real boundary — DataMeet open data, point-in-polygon, no PostGIS needed.",
              "Sites are computed from the points on every read, never stored as numbers; only an operator's decision (van assigned, cleared) is stored.",
              "The map is MapLibre GL on an OpenFreeMap basemap — open-source end to end, no API key.",
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
              "Not an address book. Points are snapped to a ~38 m cell before they leave the server, so the map shows the street, never the doorway.",
              "Not live tracking. It reports where intakes happened, not where vans are now, and the van round is a priority order, not a route.",
              "Not complete. Only intakes made with a location appear; pickups are not geotagged yet.",
              "Not enforcement. A site is a routing suggestion for a municipal officer, never an accusation about a place or a person.",
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
