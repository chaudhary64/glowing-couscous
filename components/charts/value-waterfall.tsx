import { formatInr } from "@/lib/format";

/**
 * Gross → handling → net, as a waterfall: the gross bar, the fee hanging off its top,
 * and what is left for the collector. The arithmetic is the server's; this only draws
 * it. When the fee is larger than the gross the net is floored at zero (see
 * `priceMaterials`), and the chart shows the shortfall in a hatched band rather than a
 * negative bar — the collector is never shown a debt.
 */
export function ValueWaterfall({
  gross,
  handling,
  net,
}: {
  gross: number;
  handling: number;
  net: number;
}) {
  const top = Math.max(gross, handling, 1);
  // Bars live between PAD (room for the figure above the tallest bar) and the baseline.
  const PAD = 18;
  const H = 132;
  const BASE = PAD + H;
  const y = (value: number) => BASE - (value / top) * H;
  const shortfall = handling > gross;
  const columns = [
    { key: "gross", label: "Gross", value: gross, from: 0, to: gross, tone: "var(--color-ink)" },
    {
      key: "fee",
      label: "Handling",
      value: -handling,
      from: Math.max(0, gross - handling),
      to: gross,
      tone: "var(--color-hazard)",
    },
    { key: "net", label: "Net", value: net, from: 0, to: net, tone: "var(--color-verified)" },
  ];

  return (
    <figure className="mt-5">
      <svg
        viewBox={`0 0 300 ${BASE + 34}`}
        className="w-full max-w-[380px]"
        role="img"
        aria-label={`Gross ${formatInr(gross)}, minus handling ${formatInr(handling)}, leaves ${formatInr(net)} for the collector${shortfall ? " (the fee exceeds the gross; the net is floored at zero)" : ""}.`}
      >
        <defs>
          <pattern id="shortfall-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-hazard)" strokeWidth="2" />
          </pattern>
        </defs>
        <line x1="0" x2="300" y1={BASE} y2={BASE} stroke="var(--color-rule)" />
        {columns.map((column, index) => {
          const x = 18 + index * 96;
          const height = Math.max(1.5, y(column.from) - y(column.to));
          return (
            <g key={column.key}>
              <rect
                x={x}
                y={y(column.to)}
                width={72}
                height={height}
                fill={column.tone}
                className="chart-grow"
                style={{ animationDelay: `${index * 160}ms`, transformOrigin: `0 ${column.key === "fee" ? y(column.to) : BASE}px` }}
              />
              {index < 2 ? (
                <line
                  x1={x + 72}
                  x2={x + 96}
                  y1={y(index === 0 ? gross : Math.max(0, gross - handling))}
                  y2={y(index === 0 ? gross : Math.max(0, gross - handling))}
                  stroke="var(--color-ink-muted)"
                  strokeDasharray="3 3"
                />
              ) : null}
              <text x={x + 36} y={y(Math.max(column.to, column.from)) - 6} textAnchor="middle" className="fill-ink font-mono text-[10px]">
                {column.value < 0 ? `−${formatInr(-column.value)}` : formatInr(column.value)}
              </text>
              <text x={x + 36} y={BASE + 16} textAnchor="middle" className="fill-ink-muted font-mono text-[9px] uppercase tracking-[0.12em]">
                {column.label}
              </text>
            </g>
          );
        })}
        {shortfall ? (
          <rect x={18 + 96} y={y(handling)} width={72} height={y(gross) - y(handling)} fill="url(#shortfall-hatch)" opacity="0.7" />
        ) : null}
      </svg>
      {shortfall ? (
        <figcaption className="mt-1 text-[11px] leading-snug text-ink-muted">
          The fee is more than the material is worth, so the net floors at ₹0 — the shortfall
          (hatched) is the operator&rsquo;s cost, never the collector&rsquo;s.
        </figcaption>
      ) : null}
    </figure>
  );
}
