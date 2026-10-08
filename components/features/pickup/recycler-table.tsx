import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/card";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { formatTonnes } from "@/lib/format";
import { isReusePartner, takesHazardous } from "@/lib/streams";
import type { Recycler } from "@/lib/types";

/**
 * Who is allowed to receive what. The registration number is the compliance
 * identity, so it is shown in full rather than summarised.
 */
export function RecyclerTable({
  recyclers,
  className,
}: {
  recyclers: Recycler[];
  className?: string;
}) {
  return (
    <Surface className={className}>
      <Table caption="Registration, capacity and accepted streams for each destination.">
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
          {recyclers.map((recycler) => {
            const reuse = isReusePartner(recycler);
            const hazardous = takesHazardous(recycler);
            return (
              <TR key={recycler.id}>
                <TD>
                  <span className="font-medium">{recycler.name}</span>
                  <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                    {recycler.id} · {recycler.city}
                  </p>
                </TD>
                <TD mono>{recycler.cpcbId}</TD>
                <TD className="hidden md:table-cell">
                  <span className="flex flex-wrap gap-1.5">
                    {recycler.accepts.map((stream) => (
                      <Badge key={stream} tone="neutral">
                        {stream}
                      </Badge>
                    ))}
                  </span>
                </TD>
                <TD numeric mono>
                  {formatTonnes(recycler.capacityTonnesPerDay)}
                  <span className="ml-1 text-[11px] text-ink-muted">/day</span>
                </TD>
                <TD numeric mono>
                  {recycler.slaHours} h
                </TD>
                <TD>
                  {reuse ? (
                    <Badge tone="lead">Reuse, not recycling</Badge>
                  ) : hazardous ? (
                    <Badge tone="verified">Licensed for hazards</Badge>
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
        Only CPCB-registered lines can take a hazardous stream, which is why a
        swollen battery pack costs more to place than a clean board. RX-04 is a
        reuse partner: working devices go there for refurbishment and never enter
        the shredding stream.
      </p>
    </Surface>
  );
}
