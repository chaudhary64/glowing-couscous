import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/card";
import { hotspotStatusLabel, hotspotStatusTone } from "@/lib/tone";
import type { HotspotCluster, Ward } from "@/lib/types";

/**
 * The point of the map screen: turning clusters into a round an operator can act
 * on. Numbering is justified here because the order *is* the route — highest
 * detection count first, and cleared clusters are left out of the run.
 *
 * Nothing is assigned by this component. It shows the case for a round and hands
 * the operator to the pickup board, which is where a van actually gets allocated.
 */
export function VanRound({
  hotspots,
  wards,
  actions,
  note,
  canOpenBoard = true,
}: {
  hotspots: HotspotCluster[];
  wards: Ward[];
  /** Replaces the "send a van" link per stop — the live map passes dispatch buttons. */
  actions?: (spot: HotspotCluster) => ReactNode;
  /** Replaces the closing note, which otherwise describes the fixture route. */
  note?: ReactNode;
  /** Whether this role may open the pickup board; a viewer may not, so it is not linked. */
  canOpenBoard?: boolean;
}) {
  const route = [...hotspots]
    .filter((spot) => spot.status !== "cleared")
    .sort((a, b) => b.detections - a.detections);

  const totalDetections = route.reduce((sum, spot) => sum + spot.detections, 0);
  const unassigned = route.filter((spot) => spot.status === "open").length;

  return (
    <Panel
      eyebrow="Routing"
      title="Next van round"
      actions={
        canOpenBoard ? (
          <Link
            href="/pickups"
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
          >
            Open the pickup board →
          </Link>
        ) : undefined
      }
      bodyClassName="p-0"
    >
      <ol>
        {route.map((spot, index) => {
          const ward = wards.find((entry) => entry.id === spot.wardId);
          return (
            <li
              key={spot.id}
              className="border-b border-rule-soft px-4 py-3.5 last:border-b-0"
            >
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="flex min-w-0 gap-3">
                  <span className="mt-0.5 font-display text-lg leading-none tabular-nums text-copper">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug">{spot.label}</p>
                    <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                      {ward ? ward.name : "Unmapped"} · {spot.landMark}
                    </p>
                    <p className="mt-1.5 text-[12px] leading-snug text-ink-soft">
                      {spot.topMaterial} · {spot.radiusM} m radius · first seen{" "}
                      {spot.firstSeen}
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-right">
                    <span className="block font-mono text-[13px] font-medium tabular-nums">
                      {spot.detections}
                    </span>
                    <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-ink-muted">
                      detections
                    </span>
                  </span>
                  <Badge tone={hotspotStatusTone(spot.status)}>
                    {hotspotStatusLabel(spot.status)}
                  </Badge>
                </div>
              </div>

              {actions ? (
                <div className="mt-2.5">{actions(spot)}</div>
              ) : !canOpenBoard ? null : (
                <Link
                  href="/pickups"
                  className="mt-2.5 inline-block font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
                >
                  Send a van to {ward ? ward.name : "this cluster"} →
                </Link>
              )}
            </li>
          );
        })}
      </ol>

      <p className="border-t-[3px] border-ink px-4 py-3 text-[12px] leading-relaxed text-ink-soft">
        {note ?? (
          <>
            {route.length} clusters on the round carrying {totalDetections} detections
            between them, {unassigned} still with no van assigned. Stops are ordered by
            detection count, not by driving distance — the fixtures carry no road
            network, so this is a priority list rather than a routable sequence.
          </>
        )}
      </p>
    </Panel>
  );
}
