/**
 * A ring of outcomes — here, what the gatekeeper did with every priced item. Segments
 * draw themselves round the ring one after another; the legend carries the counts, so
 * the figure reads without the ring.
 */
export interface RingSegment {
  label: string;
  value: number;
  color: string;
}

export function OutcomeRing({ segments, total, caption }: { segments: RingSegment[]; total: number; caption: string }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const sum = segments.reduce((acc, s) => acc + s.value, 0) || 1;
  // Each arc starts where the previous one ended, computed up front.
  const arcs = segments.map((segment, index) => ({
    segment,
    length: (segment.value / sum) * c,
    offset: segments.slice(0, index).reduce((acc, s) => acc + (s.value / sum) * c, 0),
  }));

  return (
    <figure className="flex flex-wrap items-center gap-6">
      <span data-tilt="14" className="ring-3d inline-block rounded-full">
      <svg viewBox="0 0 110 110" className="size-36 -rotate-90" role="img" aria-label={`${caption}: ${segments.map((s) => `${s.value} ${s.label}`).join(", ")}.`}>
        <circle cx="55" cy="55" r={r} fill="none" stroke="var(--color-rule-soft)" strokeWidth="12" />
        {arcs.map(({ segment, length, offset }, index) =>
          segment.value > 0 ? (
            <circle
              key={segment.label}
              cx="55"
              cy="55"
              r={r}
              fill="none"
              stroke={segment.color}
              strokeWidth="12"
              strokeDasharray={`${length} ${c - length}`}
              strokeDashoffset={-offset}
              className="chart-ring-draw"
              style={{ ["--gap" as string]: `${c}`, animationDelay: `${index * 260}ms` }}
            />
          ) : null,
        )}
        <text x="55" y="55" transform="rotate(90 55 55)" textAnchor="middle" dominantBaseline="central" className="fill-ink font-display text-[26px]">
          {total}
        </text>
      </svg>
      </span>
      <figcaption className="flex flex-col gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">{caption}</span>
        {segments.map((segment) => (
          <span key={segment.label} className="flex items-center gap-2 text-sm">
            <span aria-hidden className="inline-block size-2.5" style={{ background: segment.color }} />
            <span className="w-8 font-mono tabular-nums">{segment.value}</span>
            <span className="text-ink-soft">{segment.label}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
