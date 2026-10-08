import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel, Surface } from "@/components/ui/card";
import { Field, FieldList } from "@/components/ui/field-list";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { RecyclerTable } from "@/components/features/pickup/recycler-table";
import { LoadAllocation } from "@/components/features/product/recyclers/capacity-panel";
import { pickups, recyclers } from "@/lib/data/operations";
import { formatTonnes } from "@/lib/format";
import { isRegistered, isReusePartner, takesHazardous } from "@/lib/streams";

export default function RecyclersPage() {
  const licensedForHazards = recyclers.filter(takesHazardous);
  const reusePartners = recyclers.filter(isReusePartner);
  const totalCapacity = recyclers.reduce(
    (total, recycler) => total + recycler.capacityTonnesPerDay,
    0,
  );
  const fastestSla = Math.min(...recyclers.map((recycler) => recycler.slaHours));
  const registered = recyclers.filter(isRegistered);

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Network · Destinations"
        title="Recyclers"
        lede="Every load leaves through a line on this page. The CPCB registration number is the compliance identity: if a destination is not registered for a stream, we cannot route that stream to it."
        actions={
          <ButtonLink href="/pickups" variant="secondary">
            See the load board
          </ButtonLink>
        }
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone="verified">
              {licensedForHazards.length} licensed for hazardous streams
            </Badge>
            <Badge tone="lead">{reusePartners.length} reuse partner</Badge>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              {formatTonnes(totalCapacity)}/day combined capacity · fastest SLA{" "}
              {fastestSla} h
            </span>
          </div>
        }
      />

      <StatGrid columns={4}>
        <Stat
          label="Destinations on file"
          value={String(recyclers.length)}
          unit="facilities"
          note={`${registered.length} hold a CPCB registration number.`}
        />
        <Stat
          label="Combined capacity"
          value={formatTonnes(totalCapacity)}
          unit="per day"
          note="Across Mumbai, Navi Mumbai and Pune. Capacity is a ceiling, not today's intake."
        />
        <Stat
          label="Licensed for hazards"
          value={String(licensedForHazards.length)}
          note="Batteries, leaded glass and capacitor banks can only go to these lines."
        />
        <Stat
          label="Fastest SLA"
          value={String(fastestSla)}
          unit="hours"
          note="Shortest accepted turnaround from assignment to receipt."
        />
      </StatGrid>

      <section>
        <SectionHeader
          eyebrow="Directory"
          title="Authorised destinations"
          note="Registration, capacity and accepted streams, shown in full because a summarised licence number is not evidence of anything."
        />
        <RecyclerTable recyclers={recyclers} className="mt-4" />
      </section>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <LoadAllocation recyclers={recyclers} pickups={pickups} />

        <Panel eyebrow="Compliance" title="Licence watch">
          <p className="text-sm leading-relaxed text-ink-soft">
            The registration number is what a brand points at when CPCB asks where
            its e-waste went. One entry here is not a registration, and the
            difference matters.
          </p>

          <FieldList columns={1} className="mt-4">
            {recyclers.map((recycler) => {
              const reuse = isReusePartner(recycler);
              const hazardous = takesHazardous(recycler);
              return (
                <Field
                  key={recycler.id}
                  label={recycler.name}
                  value={
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[12px]">
                        {recycler.cpcbId}
                      </span>
                      {reuse ? (
                        <Badge tone="lead">Reuse, not recycling</Badge>
                      ) : hazardous ? (
                        <Badge tone="verified">Hazard streams allowed</Badge>
                      ) : (
                        <Badge tone="neutral">Standard line only</Badge>
                      )}
                    </span>
                  }
                />
              );
            })}
          </FieldList>

          <div className="mt-5 border-t border-rule pt-4">
            <ul className="flex flex-col gap-3">
              <li className="flex gap-3 text-[12px] leading-relaxed text-ink-soft">
                <span aria-hidden className="mt-1.5 size-2 shrink-0 bg-hazard" />
                <span>
                  Only a CPCB-registered line may take a hazardous stream, which is
                  why a swollen battery pack is harder to place than a clean board.
                </span>
              </li>
              <li className="flex gap-3 text-[12px] leading-relaxed text-ink-soft">
                <span aria-hidden className="mt-1.5 size-2 shrink-0 bg-lead" />
                <span>
                  {reusePartners.map((partner) => partner.name).join(", ")} carries
                  a dash instead of a registration because it refurbishes working
                  devices rather than recycling them. Working units never enter the
                  shredding stream, so no scrap credit is issued for them.
                </span>
              </li>
              <li className="flex gap-3 text-[12px] leading-relaxed text-ink-soft">
                <span aria-hidden className="mt-1.5 size-2 shrink-0 bg-copper" />
                <span>
                  SLA is the accepted turnaround for a load, not a delivery
                  guarantee: inter-city transfers to Pune take the longest.
                </span>
              </li>
            </ul>
          </div>
        </Panel>
      </div>

      <Surface className="flex flex-wrap items-center justify-between gap-4 p-4">
        <p className="max-w-xl text-[12px] leading-relaxed text-ink-muted">
          Destinations decide what a load is worth: a clean board can take the
          standard line, while anything with a hazard declaration has to go to a
          registered stream, which is why routing is settled before a credit note is
          issued.
        </p>
        <Link
          href="/pickups"
          className="font-mono text-[11px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
        >
          Open the load board →
        </Link>
      </Surface>
    </div>
  );
}
