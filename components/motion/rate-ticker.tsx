import { RATE_CARD } from "@/lib/data/rate-card";
import { formatRate } from "@/lib/format";

/**
 * The rate card as a commodities board: every line of the demo card, scrolling past.
 *
 * Pure CSS (`.rate-ticker` in globals.css): the track is the list twice, translated by
 * half its width on a loop, so the seam never shows. It pauses under the pointer, and
 * reduced motion stops it where it stands. The figures are the same `RATE_CARD` the
 * valuation engine prices with, so the board is never a different number from the page.
 */
export function RateTicker() {
  const lines = Object.entries(RATE_CARD);
  const run = (copy: number) =>
    lines.map(([id, line]) => (
      <li key={`${copy}-${id}`} className="flex shrink-0 items-baseline gap-2 px-6" aria-hidden={copy > 0}>
        <span className="font-display text-lg leading-none tracking-tight text-copper">{line.symbol}</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper/60">{line.name}</span>
        <span className="font-mono text-[12px] tabular-nums text-paper">
          {line.ratePerKg > 0 ? formatRate(line.ratePerKg) : "disposal"}
        </span>
        <span aria-hidden className="ml-4 size-1 bg-paper/25" />
      </li>
    ));

  return (
    <section aria-label="Rate card" className="rate-ticker relative overflow-hidden border-b-2 border-ink bg-ink py-3 text-paper">
      <ul className="rate-ticker__track flex w-max">
        {run(0)}
        {run(1)}
      </ul>
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-ink to-transparent" />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-ink to-transparent" />
    </section>
  );
}
