import { RATE_CARD } from "@/lib/data/rate-card";
import { formatRate } from "@/lib/format";

/**
 * The rate card as a commodities board: every line of the demo card, scrolling past.
 *
 * Pure CSS (`.rate-ticker` in globals.css): the track is the list twice, translated by
 * half its width on a loop, so the seam never shows. It pauses under the pointer, and
 * reduced motion stops it where it stands. The figures are the same `RATE_CARD` the
 * valuation engine prices with, so the board is never a different number from the page.
 *
 * A hairline strip on the page's own ground rather than an ink band: on the landing it is
 * a quiet breath between two sections, not a third argument.
 *
 * Only lines that carry a rate: a commodities board of eight rows reading "disposal" is
 * noise, and the zero-rate fractions are stated properly in the table below, with the
 * handling note that explains each one.
 */
export function RateTicker() {
  const lines = Object.entries(RATE_CARD).filter(([, line]) => line.ratePerKg > 0);
  const run = (copy: number) =>
    lines.map(([id, line]) => (
      <li key={`${copy}-${id}`} className="flex shrink-0 items-baseline gap-2.5 px-6" aria-hidden={copy > 0}>
        <span className="font-display text-lg leading-none tracking-tight text-copper">{line.symbol}</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink-muted">{line.name}</span>
        <span className="font-mono text-[12px] tabular-nums text-ink">
          {formatRate(line.ratePerKg)}
        </span>
        <span aria-hidden className="ml-3 size-1 self-center bg-rule" />
      </li>
    ));

  return (
    <section
      aria-label="Rate card"
      className="rate-ticker relative overflow-hidden border-b border-rule bg-paper-raised py-4"
    >
      {/* Four runs, so one repeat unit is two of them: the track's -50% loop then
          lands on an identical segment with no seam, and a unit stays wider than the
          viewport even on an ultrawide screen. Only the first is read out. */}
      <ul className="rate-ticker__track flex w-max">
        {run(0)}
        {run(1)}
        {run(2)}
        {run(3)}
      </ul>
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-paper-raised to-transparent" />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-paper-raised to-transparent" />
    </section>
  );
}
