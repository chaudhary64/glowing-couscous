import { MeterRow } from "@/components/ui/meter";
import { densityBand } from "@/components/features/heatmap/ward-map";
import type { Ward } from "@/lib/types";

/**
 * The same numbers the scatter shows, in a form a ward officer can read, quote
 * and sort. Density ordering is real information, so it is numbered.
 */
export function WardDensity({ wards }: { wards: Ward[] }) {
  const sorted = [...wards].sort((a, b) => b.density - a.density);
  const totalPickups = sorted.reduce((sum, ward) => sum + ward.pickups, 0);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule pb-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          Ward · density · pickups · flagged sites
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          {totalPickups} geotagged pickups across {sorted.length} wards
        </p>
      </div>

      <ol>
        {sorted.map((ward, index) => {
          const band = densityBand(ward.density);
          return (
            <li
              key={ward.id}
              className="border-b border-rule-soft py-1 last:border-b-0"
            >
              <div className="flex items-baseline gap-2 pt-1.5">
                <span className="font-mono text-[11px] tabular-nums text-copper">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="text-sm font-medium text-ink">{ward.name}</span>
                <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
                  {band.label}
                </span>
              </div>
              {/* Meter is 0–1, so density is passed as a ratio. */}
              <MeterRow
                label={ward.id}
                value={ward.density / 100}
                tone={band.tone}
                display={`${ward.density}/100`}
                className="pt-1"
                note={`${ward.pickups} pickups · ${ward.flaggedSites} flagged sites`}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
