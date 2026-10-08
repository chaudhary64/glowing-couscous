import { Badge } from "@/components/ui/badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/data-table";
import { hotspotStatusLabel, hotspotStatusTone } from "@/lib/tone";
import type { HotspotCluster, Ward } from "@/lib/types";

export function HotspotTable({
  hotspots,
  wards,
}: {
  hotspots: HotspotCluster[];
  wards: Ward[];
}) {
  const open = hotspots.filter((spot) => spot.status === "open");

  return (
    <div className="flex flex-col gap-3">
      {open.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-l-4 border-hazard bg-hazard-tint px-3 py-2">
          <Badge tone="hazard" solid>
            {open.length} open
          </Badge>
          <p className="text-[12px] leading-snug text-ink-soft">
            {open.map((spot) => spot.label).join(" · ")} — these need a van before
            the next collection round, the rest are already moving or closed.
          </p>
        </div>
      ) : null}

      <Table>
        <THead>
          <TR>
            <TH>Cluster</TH>
            <TH>Ward</TH>
            <TH numeric>Radius</TH>
            <TH numeric>Detections</TH>
            <TH>Top material</TH>
            <TH>First seen</TH>
            <TH>Status</TH>
          </TR>
        </THead>
        <TBody>
          {hotspots.map((spot) => {
            const ward = wards.find((entry) => entry.id === spot.wardId);
            return (
              <TR
                key={spot.id}
                muted={spot.status === "cleared"}
                className={spot.status === "open" ? "bg-hazard-tint/40" : undefined}
              >
                <TD>
                  <span className="font-medium">{spot.label}</span>
                  <p className="mt-1 text-[11px] leading-snug text-ink-muted">
                    {spot.id} · {spot.landMark}
                  </p>
                </TD>
                <TD>
                  {ward ? ward.name : "Unmapped"}
                  <p className="mt-1 font-mono text-[11px] text-ink-muted">
                    {spot.wardId}
                  </p>
                </TD>
                <TD numeric mono>
                  {spot.radiusM} m
                </TD>
                <TD numeric mono>
                  {spot.detections}
                </TD>
                <TD className="text-[13px] text-ink-soft">{spot.topMaterial}</TD>
                <TD mono className="text-ink-muted">
                  {spot.firstSeen}
                </TD>
                <TD>
                  <Badge tone={hotspotStatusTone(spot.status)}>
                    {hotspotStatusLabel(spot.status)}
                  </Badge>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>

      <p className="text-[12px] leading-relaxed text-ink-muted">
        A cluster is a geohash cell group with four or more detections in a rolling
        21-day window. Cleared clusters stay in the log so a returning dump is
        visible as a regression rather than a new discovery.
      </p>
    </div>
  );
}
