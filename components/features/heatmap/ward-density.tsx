"use client";

import { useMemo, useState } from "react";

import { densityBand } from "@/components/features/heatmap/density-band";
import { MeterRow } from "@/components/ui/meter";
import { cn } from "@/lib/cn";
import type { Ward } from "@/lib/types";

/**
 * The same numbers the scatter shows, in a form a ward officer can read, quote
 * and sort.
 *
 * Density is the default order because that is how the map is drawn, so the list
 * and the scatter agree on what "worst" means. The controls exist because the
 * officer's next question changes: sometimes it is which ward has the most pickups
 * left to service, sometimes which carries the flagged sites an inspection follows.
 * The sort runs on the client because all eight wards are already on the page —
 * reordering them should not cost a round trip.
 *
 * The row number is the position in whatever order is showing, so it renumbers with
 * the sort rather than claiming a rank it no longer holds.
 */

type SortKey = "density" | "pickups" | "flaggedSites" | "name";
type Direction = "desc" | "asc";

const sortOptions: { key: SortKey; label: string; direction: Direction }[] = [
  { key: "density", label: "Density", direction: "desc" },
  { key: "pickups", label: "Pickups", direction: "desc" },
  { key: "flaggedSites", label: "Flagged sites", direction: "desc" },
  { key: "name", label: "Ward name", direction: "asc" },
];

function compare(a: Ward, b: Ward, key: SortKey, direction: Direction): number {
  const base = key === "name" ? a.name.localeCompare(b.name) : a[key] - b[key];
  if (base !== 0) return direction === "asc" ? base : -base;
  // Equal on the chosen key — as two wards genuinely are on flagged sites. The
  // tie-break is pressure, worst first, so the order is decided by the data rather
  // than by whichever way the fixture happens to be written.
  return b.density - a.density;
}

/** What the current order means, in the operator's own terms. */
function sortNote(key: SortKey, direction: Direction): string {
  if (key === "name") {
    return `Alphabetical by ward name, ${direction === "asc" ? "A to Z" : "Z to A"}.`;
  }
  const subject =
    key === "density"
      ? "density, the pressure score the markers are sized by"
      : key === "pickups"
        ? "geotagged pickups in the window"
        : "flagged sites, the count an inspection follows";
  return `Ranked by ${subject}, ${direction === "desc" ? "highest" : "lowest"} first.`;
}

export function WardDensity({ wards }: { wards: Ward[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("density");
  const [direction, setDirection] = useState<Direction>("desc");

  const sorted = useMemo(
    () => [...wards].sort((a, b) => compare(a, b, sortKey, direction)),
    [wards, sortKey, direction],
  );
  const totalPickups = wards.reduce((sum, ward) => sum + ward.pickups, 0);

  const directionLabel =
    sortKey === "name"
      ? direction === "asc"
        ? "A → Z"
        : "Z → A"
      : direction === "desc"
        ? "High → low"
        : "Low → high";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          Sort
        </span>
        <div role="group" aria-label="Sort wards by" className="flex flex-wrap gap-1.5">
          {sortOptions.map((option) => {
            const isActive = option.key === sortKey;
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  setSortKey(option.key);
                  setDirection(option.direction);
                }}
                className={cn(
                  "border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors",
                  isActive
                    ? "border-ink bg-ink text-paper"
                    : "border-rule text-ink-muted hover:border-ink hover:text-ink",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() =>
            setDirection((current) => (current === "desc" ? "asc" : "desc"))
          }
          aria-label={`Reverse the sort order — currently ${directionLabel}`}
          className="border border-rule px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-soft transition-colors hover:border-ink hover:text-ink"
        >
          {directionLabel}
        </button>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-y border-rule py-1.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">
          {sortNote(sortKey, direction)}
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
