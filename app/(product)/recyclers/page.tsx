import Link from "next/link";
import { RecyclerTable } from "@/components/features/pickup/recycler-table";
import { LoadAllocation } from "@/components/features/product/recyclers/capacity-panel";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel, Surface } from "@/components/ui/card";
import { Field, FieldList } from "@/components/ui/field-list";
import { ScreenHeader, SectionHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { requireAccess } from "@/lib/auth/dal";
import { scopeForUser } from "@/lib/records/scope";
import { formatTonnes } from "@/lib/format";
import { listDestinations, listLoads } from "@/lib/pickup/directory";

export const instant = false;

/**
 * The directory, read rather than authored.
 *
 * This screen used to render four facilities from `lib/data/operations.ts` — the same
 * four `aws/pickup/catalogue.mjs` names, with the same CPCB numbers, typed out a second
 * time. Two copies of a licence number is one copy too many: the fixture could say a
 * site was registered for a stream the router would refuse. The facilities, their
 * authorisations and the loads below now come from the service that actually routes,
 * through `lib/pickup/directory.ts`.
 *
 * The per-stream authorisation is the part worth reading twice. A facility is not
 * "hazardous: yes" — it is authorised for specific streams, and the router reads the same
 * rows this table does.
 */
export default async function RecyclersPage() {
  const scope = await scopeForUser(await requireAccess("/recyclers"));

  const [directory, board] = await Promise.all([
    listDestinations(scope),
    listLoads(scope, 50),
  ]);
  const destinations = directory.rows;
  const loads = board.rows;

  const licensedForHazards = destinations.filter((destination) =>
    destination.streams.some((stream) => stream.accepted && stream.hazardousAuthorized),
  );
  const reusePartners = destinations.filter((destination) => destination.reuseOnly);
  const registered = destinations.filter((destination) =>
    destination.cpcbLicense.startsWith("CPCB/"),
  );
  const totalCapacityKg = destinations.reduce(
    (total, destination) => total + destination.capacityKgPerDay,
    0,
  );
  const slas = destinations
    .map((destination) => destination.slaHours)
    .filter((hours): hours is number => typeof hours === "number");
  const fastestSla = slas.length > 0 ? Math.min(...slas) : null;
  const acceptedStreams = new Set(
    destinations.flatMap((destination) =>
      destination.streams.filter((stream) => stream.accepted).map((stream) => stream.code),
    ),
  );

  const notice = !directory.configured
    ? "The pickup service is unavailable, so destinations cannot be listed."
    : directory.error
      ? `The directory could not be read: ${directory.error}`
      : null;

  return (
    <div className="flex flex-col gap-10">
      <ScreenHeader
        eyebrow="Network · Destinations"
        title="Recyclers"
        lede="Review registered recycling and reuse destinations, their accepted streams and available capacity."
        actions={
          <ButtonLink href="/pickups" variant="secondary">
            See the load board
          </ButtonLink>
        }
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge tone={notice ? "hazard" : "verified"}>
              {notice ? "Unavailable" : "Live destinations"}
            </Badge>
            {notice ? null : (
              <>
                <Badge tone="review">
                  {licensedForHazards.length} hazardous-capable
                </Badge>
                <Badge tone="lead">{reusePartners.length} reuse partner</Badge>
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                  {formatTonnes(totalCapacityKg / 1000)}/day combined capacity
                  {fastestSla === null ? "" : ` · fastest SLA ${fastestSla} h`}
                </span>
              </>
            )}
          </div>
        }
      />

      {notice ? (
        <Surface tone="inset" className="p-4">
          <p className="max-w-3xl text-sm leading-relaxed text-ink-soft">{notice}</p>
        </Surface>
      ) : null}

      {notice ? null : (
        <>
          <StatGrid columns={4}>
            <Stat
              label="Destinations on file"
              value={String(destinations.length)}
              unit="facilities"
              note={`${registered.length} have a CPCB registration.`}
            />
            <Stat
              label="Combined capacity"
              value={formatTonnes(totalCapacityKg / 1000)}
              unit="per day"
              note="Combined daily capacity."
            />
            <Stat
              label="Licensed for hazards"
              value={String(licensedForHazards.length)}
              note={`${acceptedStreams.size} accepted streams.`}
            />
            <Stat
              label="Fastest SLA"
              value={fastestSla === null ? "—" : String(fastestSla)}
              unit="hours"
              note="Fastest assignment-to-receipt time."
            />
          </StatGrid>

          <section>
            <SectionHeader
              eyebrow="Directory"
              title="Authorised destinations"
              note="Registration, capacity and accepted streams."
            />
            <RecyclerTable destinations={destinations} className="mt-4" />
          </section>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <LoadAllocation destinations={destinations} loads={loads} />

            <Panel eyebrow="Compliance" title="Licence watch">
              <p className="text-sm leading-relaxed text-ink-soft">
                Check registration and stream authorisation before routing a load.
              </p>

              <FieldList columns={1} className="mt-4">
                {destinations.map((destination) => {
                  const hazardous = destination.streams.some(
                    (stream) => stream.accepted && stream.hazardousAuthorized,
                  );
                  return (
                    <Field
                      key={destination.id}
                      label={destination.name}
                      value={
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[12px]">
                            {destination.cpcbLicense}
                          </span>
                          {destination.reuseOnly ? (
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
                      Hazardous loads can go only to destinations authorised for that stream.
                    </span>
                  </li>
                  <li className="flex gap-3 text-[12px] leading-relaxed text-ink-soft">
                    <span aria-hidden className="mt-1.5 size-2 shrink-0 bg-lead" />
                    <span>
                      {reusePartners.length > 0
                        ? `${reusePartners
                            .map((partner) => partner.name)
                            .join(", ")} refurbishes working devices instead of recycling them.`
                        : "No reuse partner is on the directory, so every accepted stream is a recycling destination."}
                    </span>
                  </li>
                  <li className="flex gap-3 text-[12px] leading-relaxed text-ink-soft">
                    <span aria-hidden className="mt-1.5 size-2 shrink-0 bg-copper" />
                    <span>
                      SLA is the expected time from assignment to receipt, not a guarantee.
                    </span>
                  </li>
                </ul>
              </div>
            </Panel>
          </div>
        </>
      )}

      <Surface className="flex flex-wrap items-center justify-between gap-4 p-4">
        <p className="max-w-xl text-[12px] leading-relaxed text-ink-muted">
          Route each load to a destination that accepts its stream. Hazardous loads need
          matching authorisation.
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
