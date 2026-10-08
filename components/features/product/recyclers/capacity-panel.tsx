import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/card";
import { MeterRow } from "@/components/ui/meter";
import { formatInr } from "@/lib/format";
import { pickupLabel, pickupTone } from "@/lib/tone";
import type { Pickup, Recycler } from "@/lib/types";

/**
 * Where the day's loads actually went. Capacity is a promise; this is what was
 * routed, which is the number a brand asking for EPR evidence cares about.
 */
export function LoadAllocation({
  recyclers,
  pickups,
}: {
  recyclers: Recycler[];
  pickups: Pickup[];
}) {
  const allocation = recyclers.map((recycler) => {
    const loads = pickups.filter((pickup) => pickup.recyclerId === recycler.id);
    return {
      recycler,
      loads,
      settledInr: loads.reduce((total, load) => total + load.settledInr, 0),
      hazardous: loads.filter((load) => load.hazardous).length,
    };
  });

  const busiest = Math.max(...allocation.map((entry) => entry.loads.length), 1);
  const routed = allocation.reduce((total, entry) => total + entry.loads.length, 0);

  return (
    <Panel
      eyebrow="Allocation"
      title="Where today's loads went"
      actions={
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
          {routed} of {pickups.length} loads routed
        </span>
      }
    >
      <div className="flex flex-col">
        {allocation.map(({ recycler, loads, settledInr, hazardous }) => (
          <div
            key={recycler.id}
            className="border-b border-rule-soft py-3 last:border-b-0"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-sm font-medium">{recycler.name}</p>
              <p className="font-mono text-[13px] tabular-nums">
                {settledInr > 0 ? formatInr(settledInr) : "—"}
                <span className="ml-1.5 text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                  settled
                </span>
              </p>
            </div>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {loads.length > 0 ? (
                loads.map((load) => (
                  <Badge key={load.id} tone={pickupTone(load.status)}>
                    {load.id} · {pickupLabel(load.status)}
                  </Badge>
                ))
              ) : (
                <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                  No loads routed today
                </span>
              )}
            </div>

            <MeterRow
              label={hazardous > 0 ? "Hazardous stream" : "Standard line"}
              value={loads.length / busiest}
              tone={hazardous > 0 ? "hazard" : "copper"}
              display={`${loads.length} ${loads.length === 1 ? "load" : "loads"}`}
              note={
                hazardous > 0
                  ? `${hazardous} load${hazardous === 1 ? "" : "s"} declared hazardous, so this destination needs a licence for that stream.`
                  : "No hazard declaration on today's loads to this line."
              }
              className="pt-2"
            />
          </div>
        ))}
      </div>

      <p className="mt-3 border-t border-rule pt-3 text-[12px] leading-relaxed text-ink-muted">
        The bar compares each destination against the busiest one today, not against
        its capacity — a quiet line is not necessarily an underused one.
      </p>
    </Panel>
  );
}
