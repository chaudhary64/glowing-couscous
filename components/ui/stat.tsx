import { cn } from "@/lib/cn";

/**
 * A single figure, set like a data sheet: hairline rule, mono label, display
 * numeral. Deliberately not a card — a wall of cards would make every screen look
 * like every other dashboard.
 */
export function Stat({
  label,
  value,
  unit,
  note,
  emphasis = false,
  className,
}: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  /** Copper treatment for the one figure that carries the page. */
  emphasis?: boolean;
  className?: string;
}) {
  return (
    <div data-tilt="5" className={cn("glass rule-light relative border-t-2 border-ink bg-paper-raised px-3 pb-3 pt-2.5", className)}>
      <span aria-hidden className="tilt-sheen" />
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
        {label}
      </p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span
          data-motion="print"
          className={cn(
            "font-display text-3xl leading-none tracking-tight sm:text-4xl",
            emphasis ? "text-copper" : "text-ink",
          )}
        >
          {value}
        </span>
        {unit ? (
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-muted">
            {unit}
          </span>
        ) : null}
      </p>
      {note ? (
        <p className="mt-1.5 text-[12px] leading-snug text-ink-muted">{note}</p>
      ) : null}
    </div>
  );
}

export function StatGrid({
  children,
  columns = 3,
  className,
}: {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-x-6 gap-y-5",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        columns === 4 && "sm:grid-cols-2 lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
