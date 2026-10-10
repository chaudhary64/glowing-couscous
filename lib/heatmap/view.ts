import type { HotspotCluster, Ward } from "@/lib/types";

import type { HeatmapCluster, HeatmapData } from "./store";

/**
 * Adapters from computed heatmap data to the shapes the existing screen components
 * take (`Ward`, `HotspotCluster` in `lib/types.ts`), so the ward ranking, the van round
 * and the hotspot table render live data without being rewritten.
 *
 * Two fields change meaning, and the screen says so: `density` is now *pressure* —
 * detections per km² relative to the busiest ward — and `flaggedSites` is the number of
 * detected hotspots in the ward.
 */

const CATEGORY_LABEL: Record<string, string> = {
  precious: "Precious-metal boards",
  base: "Base metals",
  hazardous: "Hazardous",
  inert: "Inert",
};

export function day(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

export function toWards(data: HeatmapData): Ward[] {
  return data.wards.map((w) => ({
    id: w.code,
    name: w.name,
    city: "Mumbai",
    density: w.pressure,
    pickups: w.detections,
    flaggedSites: w.hotspots,
  }));
}

export function toHotspot(c: HeatmapCluster): HotspotCluster {
  return {
    id: c.code,
    label: c.label,
    wardId: c.wardCode ?? "",
    landMark: `${c.latitude.toFixed(4)}° N, ${c.longitude.toFixed(4)}° E`,
    radiusM: c.radiusM,
    detections: c.detections,
    topMaterial: c.topCategory ? `${CATEGORY_LABEL[c.topCategory]}${c.hazardSharePct ? ` · ${c.hazardSharePct}% hazardous` : ""}` : "Unclassified",
    firstSeen: day(c.firstSeenAt),
    status: c.status === "van_assigned" ? "van-assigned" : c.status,
  };
}
