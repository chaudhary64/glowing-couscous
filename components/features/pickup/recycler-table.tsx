import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { formatTonnes } from "@/lib/format";
import type { Destination } from "@/lib/pickup/directory";

/**
 * Who is allowed to receive what, read from the authorisation rows the router itself
 * reads — not from a list of stream names matched in the UI, which is how the old
 * fixture-backed table could disagree with the router about a licence.
 *
 * Two things it shows that the fixture could not. Authorisation is **per stream, not per
 * site**: RX-01 takes boards and has a licensed battery bench, which is a normal
 * arrangement and one a site-level "hazardous: yes" would misreport. And a facility the
 * catalogue knows but that has refused a stream is drawn rather than omitted, because
 * "registered, not authorised for this" is the fact a compliance officer is looking for.
 */
export function RecyclerTable({
  destinations,
  className,
}: {
  destinations: Destination[];
  className?: string;
}) {
  return (
    <Surface className={className}>
      <Table caption="Registration, capacity and per-stream authorisation for each destination.">
        <THead>
          <TR>
            <TH>Facility</TH>
            <TH>CPCB registration</TH>
            <TH className="hidden md:table-cell">Streams accepted</TH>
            <TH numeric>Capacity</TH>
            <TH numeric>SLA</TH>
            <TH>Hazardous</TH>
          </TR>
        </THead>
        <TBody>
          {destinations.map((destination) => {
            const accepted = destination.streams.filter((stream) => stream.accepted);
            const refused = destination.streams.filter((stream) => !stream.accepted);
            const licensedForHazard = destination.streams.some(
              (stream) => stream.accepted && stream.hazardousAuthorized,
            );
            const hazardRefused = destination.streams.some(
              (stream) => stream.hazardous && !stream.hazardousAuthorized,
            );

            return (
              <TR key={destination.id}>
                <TD>
                  <span className="font-medium">{destination.name}</span>
                  <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                    {destination.id} · {destination.city}
                    {destination.active ? "" : " · not active"}
                  </p>
                </TD>
                <TD mono>{destination.cpcbLicense}</TD>
                <TD className="hidden md:table-cell">
                  <span className="flex flex-wrap gap-1.5">
                    {accepted.length === 0 ? (
                      <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                        Accepts nothing on the catalogue
                      </span>
                    ) : (
                      accepted.map((stream) => (
                        <Badge
                          key={stream.code}
                          tone={stream.hazardousAuthorized ? "review" : "neutral"}
                        >
                          {stream.label}
                        </Badge>
                      ))
                    )}
                  </span>
                  {refused.length > 0 ? (
                    <p className="mt-1.5 text-[11px] leading-snug text-ink-muted">
                      Refused: {refused.map((stream) => stream.label).join(", ")}
                    </p>
                  ) : null}
                </TD>
                <TD numeric mono>
                  {formatTonnes(destination.capacityKgPerDay / 1000)}
                  <span className="ml-1 text-[11px] text-ink-muted">/day</span>
                </TD>
                <TD numeric mono>
                  {destination.slaHours === null ? "—" : `${destination.slaHours} h`}
                </TD>
                <TD>
                  {destination.reuseOnly ? (
                    <Badge tone="lead">Reuse, not recycling</Badge>
                  ) : licensedForHazard ? (
                    <Badge tone="verified">Licensed for hazards</Badge>
                  ) : hazardRefused ? (
                    <Badge tone="hazard">No hazard authorisation</Badge>
                  ) : (
                    <Badge tone="neutral">Standard line only</Badge>
                  )}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      <p className="border-t border-rule px-3 py-3 text-[12px] leading-relaxed text-ink-muted">
        Only a CPCB-registered line may take a hazardous stream, and the authorisation is
        per stream rather than per site — which is why a swollen battery pack is harder to
        place than a clean board. A reuse partner is not a recycling destination at all:
        working devices go there for refurbishment and never enter the shredding stream.
      </p>
    </Surface>
  );
}
