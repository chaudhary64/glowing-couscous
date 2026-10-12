"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Surface } from "@/components/ui/card";
import type { ClusterStatus, HeatmapCluster, HeatmapData } from "@/lib/heatmap/store";

import { HotspotMap } from "./hotspot-map";

/**
 * The interactive half of `/map`: the map, the site under the cursor, and the buttons
 * that act on it. Everything else on the page is server-rendered from the same
 * `HeatmapData`, and an action ends in `router.refresh()`, so the stats, the ward table
 * and the van round re-render from the database rather than from optimistic state here.
 */

const STATUS_LABEL: Record<ClusterStatus, string> = {
  open: "Open",
  van_assigned: "Van assigned",
  cleared: "Cleared",
};

const STATUS_TONE: Record<ClusterStatus, "hazard" | "copper" | "verified"> = {
  open: "hazard",
  van_assigned: "copper",
  cleared: "verified",
};

const CATEGORY_LABEL: Record<string, string> = {
  precious: "Precious-metal boards",
  base: "Base metals",
  hazardous: "Hazardous",
  inert: "Inert",
};

function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function DispatchButtons({ cluster, canDispatch }: { cluster: HeatmapCluster; canDispatch: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!canDispatch) {
    return <span className="text-[12px] text-ink-muted">Read-only: an Operator or Admin assigns vans to a site.</span>;
  }

  async function set(status: ClusterStatus) {
    setError(null);
    const response = await fetch("/api/heatmap/dispatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: cluster.code, status }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      setError(body?.message ?? `Failed (${response.status}).`);
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {cluster.status !== "van_assigned" && cluster.status !== "cleared" ? (
          <Button variant="secondary" disabled={pending} onClick={() => void set("van_assigned")}>
            Assign a van
          </Button>
        ) : null}
        {cluster.status !== "cleared" ? (
          <Button variant="secondary" disabled={pending} onClick={() => void set("cleared")}>
            Mark cleared
          </Button>
        ) : null}
        {cluster.status !== "open" ? (
          <Button variant="ghost" disabled={pending} onClick={() => void set("open")}>
            Reopen
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-[12px] text-hazard-ink">{error}</p> : null}
    </div>
  );
}

export function HeatmapExplorer({ data, canDispatch }: { data: HeatmapData; canDispatch: boolean }) {
  const [selected, setSelected] = useState<string | null>(data.clusters[0]?.code ?? null);
  const site = data.clusters.find((c) => c.code === selected) ?? null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <HotspotMap
        points={data.points}
        clusters={data.clusters}
        wards={data.wards}
        districts={data.districts}
        frame={data.frame}
        selected={selected}
        onSelect={setSelected}
      />

      <div className="flex flex-col gap-4">
        <Surface tone="inset" className="flex flex-col gap-3 p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
            Sites · {data.clusters.length} detected
          </p>
          {data.clusters.length === 0 ? (
            <p className="text-sm leading-relaxed text-ink-soft">
              {data.livePointCount === 0
                ? "No geotagged intakes yet. A site appears here once four intakes with a location land within ~150 m of each other inside three weeks."
                : data.filter.hazardousOnly
                  ? "No site contains a hazardous item in the window."
                  : `No spot has ${data.rule.minDetections} detections within ${data.rule.radiusM} m of each other in the last ${data.rule.windowDays} days.`}
            </p>
          ) : (
            <ol className="flex max-h-72 flex-col overflow-y-auto">
              {data.clusters.map((c, index) => (
                <li key={c.code}>
                  <button
                    type="button"
                    onClick={() => setSelected(c.code)}
                    className={`flex w-full items-center justify-between gap-3 border-b border-rule-soft px-2 py-2 text-left hover:bg-paper ${c.code === selected ? "bg-paper" : ""}`}
                  >
                    <span className="flex min-w-0 gap-2">
                      <span className="font-mono text-[12px] tabular-nums text-copper">{String(index + 1).padStart(2, "0")}</span>
                      <span className="truncate text-[13px] font-medium">{c.label}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-[12px] tabular-nums">{c.detections}</span>
                      <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </Surface>

        {site ? (
          <Surface tone="inset" className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[site.status]}>{STATUS_LABEL[site.status]}</Badge>
              <span className="font-mono text-[11px] text-ink-muted">{site.code}</span>
            </div>
            <p className="text-sm font-medium leading-snug">{site.label}</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[12px]">
              <dt className="text-ink-muted">Ward</dt>
              <dd>{site.wardName ?? "Outside India"}</dd>
              <dt className="text-ink-muted">Detections</dt>
              <dd className="font-mono tabular-nums">{site.detections} in {data.rule.windowDays} days</dd>
              <dt className="text-ink-muted">Radius</dt>
              <dd className="font-mono tabular-nums">{site.radiusM} m</dd>
              <dt className="text-ink-muted">Dominant</dt>
              <dd>{site.topCategory ? CATEGORY_LABEL[site.topCategory] : "Unclassified"}</dd>
              <dt className="text-ink-muted">Hazardous share</dt>
              <dd className="font-mono tabular-nums">{site.hazardSharePct}%</dd>
              <dt className="text-ink-muted">Mass</dt>
              <dd className="font-mono tabular-nums">{site.totalMassKg} kg</dd>
              <dt className="text-ink-muted">Seen</dt>
              <dd className="font-mono tabular-nums">{day(site.firstSeenAt)} → {day(site.lastSeenAt)}</dd>
            </dl>
            <DispatchButtons cluster={site} canDispatch={canDispatch} />
          </Surface>
        ) : null}
      </div>
    </div>
  );
}
