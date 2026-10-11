import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/card";
import { MeterRow } from "@/components/ui/meter";
import { formatInr, formatMass } from "@/lib/format";
import type { Destination } from "@/lib/pickup/directory";
import type { PickupView } from "@/lib/pickup/types";
import { pickupLabel, pickupTone } from "@/lib/tone";

/**
 * Where the loads actually went, counted from the loads themselves.
 *
 * Every figure here is a sum over real rows: a load counts against the facility the
 * router chose for it, the settled figure is the sum of the credit notes those loads
 * carry, and the hazardous count reads the load's own hazard flag rather than the
 * destination's licence. Capacity stays a ceiling — the bar compares one destination
 * against the busiest one in the list, which is a statement about the board and not
 * about a site's spare room.
 */
export function LoadAllocation({
  destinations,
  loads,
}: {
  destinations: Destination[];
  loads: PickupView[];
}) {
  const allocation = destinations.map((destination) => {
    const routed = loads.filter((load) => load.facilityId === destination.id);
    return {
      destination,
      routed,
      settledInr:
        routed.reduce(
          (total, load) => total + Number(load.creditNoteAmountPaise ?? 0),
          0,
        ) / 100,
      hazardous: routed.filter((load) => load.hazardous).length,
      declaredMassG: routed.reduce(
        (total, load) => total + Number(load.declaredMassG ?? 0),
        0,
      ),
    };
  });

  const busiest = Math.max(...allocation.map((entry) => entry.routed.length), 1);
  const routed = allocation.reduce((total, entry) => total + entry.routed.length, 0);
  const unassigned = loads.filter(
    (load) => !destinations.some((destination) => destination.id === load.facilityId),
  ).length;

  return (
    <Panel
      eyebrow="Allocation"
      title="Where the loads went"
      actions={
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
          {routed} of {loads.length} loads on the board
        </span>
      }
    >
      <div className="flex flex-col">
        {allocation.map(({ destination, routed: entry, settledInr, hazardous, declaredMassG }) => (
          <div
            key={destination.id}
            className="border-b border-rule-soft py-3 last:border-b-0"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-sm font-medium">{destination.name}</p>
              <p className="font-mono text-[13px] tabular-nums">
                {settledInr > 0 ? formatInr(settledInr) : "—"}
                <span className="ml-1.5 text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                  settled
                </span>
              </p>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {entry.length > 0 ? (
                entry.slice(0, 6).map((load) => (
                  <Badge key={load.pickupId} tone={pickupTone(load.status)}>
                    {load.pickupId} · {pickupLabel(load.status)}
                  </Badge>
                ))
              ) : (
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                  No loads routed here
                </span>
              )}
              {entry.length > 6 ? (
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                  +{entry.length - 6} more
                </span>
              ) : null}
            </div>

            <MeterRow
              label={hazardous > 0 ? "Hazardous stream" : "Standard line"}
              value={entry.length / busiest}
              tone={hazardous > 0 ? "hazard" : "copper"}
              display={`${entry.length} ${entry.length === 1 ? "load" : "loads"}`}
              note={
                entry.length === 0
                  ? "Nothing on the board is routed to this line."
                  : `${formatMass(declaredMassG)} declared${
                      hazardous > 0
                        ? `, ${hazardous} load${hazardous === 1 ? "" : "s"} carrying a hazard declaration`
                        : ""
                    }.`
              }
              className="pt-2"
            />
          </div>
        ))}
      </div>

      <p className="mt-3 border-t border-rule pt-3 text-[12px] leading-relaxed text-ink-muted">
        The bar compares each destination against the busiest one on the board, not against
        its capacity — a quiet line is not necessarily an underused one.
        {unassigned > 0
          ? ` ${unassigned} load${unassigned === 1 ? " is" : "s are"} routed to a facility the catalogue no longer lists.`
          : ""}
      </p>
    </Panel>
  );
}
