import { MeterRow } from "@/components/ui/meter";
import type { Ward } from "@/lib/types";

/**
 * Ward ranking: the map's ward shading, as a list a ward officer can read and quote.
 *
 * `ward.density` here is *pressure* — detections per km², relative to the busiest ward
 * (= 100) — and `ward.pickups` / `ward.flaggedSites` are detections and detected sites.
 * The adapter in `lib/heatmap/view.ts` maps the computed figures onto this shape.
 */

type Band = { tone: "hazard" | "copper" | "lead"; label: string };

function band(pressure: number): Band {
  if (pressure >= 80) return { tone: "hazard", label: "Highest load" };
  if (pressure >= 50) return { tone: "copper", label: "Elevated" };
  return { tone: "lead", label: "Lower" };
}

export function WardDensity({ wards }: { wards: Ward[] }) {
  const sorted = [...wards].sort((a, b) => b.density - a.density);
  const total = sorted.reduce((sum, ward) => sum + ward.pickups, 0);

  if (sorted.length === 0) {
    return <p className="text-sm leading-relaxed text-ink-soft">No ward has a geotagged intake in the window yet.</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule pb-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          Ward · relative pressure · detections · sites
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          {total} detections across {sorted.length} ward{sorted.length === 1 ? "" : "s"}
        </p>
      </div>

      <ol>
        {sorted.map((ward, index) => {
          const b = band(ward.density);
          return (
            <li key={ward.id} className="border-b border-rule-soft py-1 last:border-b-0">
              <div className="flex items-baseline gap-2 pt-1.5">
                <span className="font-mono text-[11px] tabular-nums text-copper">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="text-sm font-medium text-ink">{ward.name}</span>
                <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                  {b.label}
                </span>
              </div>
              {/* Meter is 0–1, so pressure is passed as a ratio. */}
              <MeterRow
                label={ward.id}
                value={ward.density / 100}
                tone={b.tone}
                display={`${ward.density}/100`}
                className="pt-1"
                note={`${ward.pickups} detection${ward.pickups === 1 ? "" : "s"} · ${ward.flaggedSites} site${ward.flaggedSites === 1 ? "" : "s"}`}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
