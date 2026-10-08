import { Dot } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { Ward } from "@/lib/types";

/**
 * Ward density plotted without a basemap.
 *
 * `ward.x` / `ward.y` are normalised 0–100 coordinates from the pilot grid, so a
 * gridded scatter carries the same information a tile layer would, at zero
 * dependency cost. The honest trade-off is stated in the caption rather than
 * hidden: this is a coordinate field, not geography.
 */

type Band = {
  tone: "hazard" | "copper" | "lead";
  label: string;
  range: string;
};

export function densityBand(density: number): Band {
  if (density >= 80) {
    return { tone: "hazard", label: "High pressure", range: "80–100" };
  }
  if (density >= 60) {
    return { tone: "copper", label: "Elevated", range: "60–79" };
  }
  return { tone: "lead", label: "Baseline", range: "0–59" };
}

/** Static class strings, because Tailwind cannot see a runtime tone value. */
const markerClasses: Record<Band["tone"], string> = {
  hazard: "border-hazard bg-hazard-tint text-hazard",
  copper: "border-copper bg-copper-tint text-copper",
  lead: "border-lead bg-paper text-lead",
};

/** 20 px at density 0, 48 px at density 100. */
function markerSize(density: number): number {
  const clamped = Math.max(0, Math.min(100, density));
  return Math.round(20 + (clamped / 100) * 28);
}

/** "M-East (Deonar)" reads as "Deonar" under a marker. */
function shortLabel(name: string): string {
  const inside = name.match(/\(([^)]+)\)/);
  return inside ? inside[1] : name;
}

const legendBands: Band[] = [
  { tone: "hazard", label: "High pressure", range: "80–100" },
  { tone: "copper", label: "Elevated", range: "60–79" },
  { tone: "lead", label: "Baseline", range: "0–59" },
];

export function WardMap({ wards }: { wards: Ward[] }) {
  const sorted = [...wards].sort((a, b) => b.density - a.density);

  return (
    <figure className="flex flex-col gap-3">
      <div className="relative aspect-[4/3] w-full border border-ink bg-paper-raised">
        {/* Grid cells: a heat surface reads as cells, not as empty space. */}
        <div
          aria-hidden
          className="absolute inset-0 grid grid-cols-10 grid-rows-[repeat(8,minmax(0,1fr))]"
        >
          {Array.from({ length: 80 }).map((_, index) => (
            <span key={index} className="border-b border-r border-rule-soft" />
          ))}
        </div>

        <ul className="absolute inset-0">
          {sorted.map((ward) => {
            const band = densityBand(ward.density);
            const size = markerSize(ward.density);
            return (
              <li
                key={ward.id}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${ward.x}%`, top: `${ward.y}%` }}
                title={`${ward.name} · density ${ward.density}/100 · ${ward.pickups} pickups · ${ward.flaggedSites} flagged sites`}
                aria-label={`${ward.name}, density ${ward.density} out of 100, ${ward.pickups} pickups, ${ward.flaggedSites} flagged sites`}
              >
                <span
                  className={cn(
                    "flex items-center justify-center border-2 font-mono text-[10px] font-medium tabular-nums",
                    markerClasses[band.tone],
                  )}
                  style={{ width: size, height: size }}
                >
                  {ward.density}
                </span>
                <span className="mt-1 block whitespace-nowrap text-center font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">
                  {shortLabel(ward.name)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <figcaption className="flex flex-col gap-3 border-t border-rule pt-3 sm:flex-row sm:items-start sm:justify-between">
        <ul className="flex flex-col gap-1.5">
          {legendBands.map((band) => (
            <li key={band.label} className="flex items-center gap-2">
              <Dot tone={band.tone} />
              <span className="text-[12px] text-ink-soft">
                {band.label}{" "}
                <span className="font-mono text-[11px] text-ink-muted">
                  density {band.range}
                </span>
              </span>
            </li>
          ))}
        </ul>
        <p className="max-w-sm text-[12px] leading-relaxed text-ink-muted">
          Marker area scales with density: 20 px at 0 rising to 48 px at 100. Not a
          basemap — positions are normalised ward coordinates from the pilot grid, so
          the real place names live in the ward table below.
        </p>
      </figcaption>
    </figure>
  );
}
