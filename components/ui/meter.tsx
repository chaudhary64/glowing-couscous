import { cn } from "@/lib/cn";
import type { BadgeTone } from "@/lib/tone";

const fills: Record<BadgeTone, string> = {
  neutral: "bg-ink",
  ink: "bg-ink",
  copper: "bg-copper",
  verified: "bg-verified",
  hazard: "bg-hazard",
  review: "bg-review",
  lead: "bg-lead",
};

/**
 * Square meter. `target` renders a tick on the track, because for the gatekeeper
 * the threshold matters as much as the value.
 */
export function Meter({
  value,
  max = 1,
  tone = "copper",
  target,
  size = "md",
  label,
  className,
}: {
  /** What the meter measures, for assistive technology; defaults to its percentage. */
  label?: string;
  /** Current value in the same unit as `max`. */
  value: number;
  max?: number;
  tone?: BadgeTone;
  /** Optional threshold marker, in the same unit as `max`. */
  target?: number;
  size?: "sm" | "md";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const targetPct =
    target === undefined
      ? null
      : Math.max(0, Math.min(100, (target / max) * 100));

  return (
    <div
      role="meter"
      aria-label={label ?? `${Math.round(pct)} percent`}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className={cn(
        "relative w-full border-2 border-ink bg-paper",
        size === "sm" ? "h-2" : "h-3",
        className,
      )}
    >
      <span
        className={cn("absolute inset-y-0 left-0", fills[tone])}
        style={{ width: `${pct}%` }}
      />
      {targetPct !== null ? (
        <span
          aria-hidden
          className="absolute inset-y-0 w-0.5 bg-ink"
          style={{ left: `calc(${targetPct}% - 1px)` }}
        />
      ) : null}
    </div>
  );
}

/** Meter with a label row above it, used across metric and density tables. */
export function MeterRow({
  label,
  value,
  display,
  tone = "copper",
  target,
  note,
  className,
}: {
  label: string;
  value: number;
  display: string;
  tone?: BadgeTone;
  target?: number;
  note?: string;
  className?: string;
}) {
  return (
    <div className={cn("py-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-ink">
          {label}
        </span>
        <span className="font-mono text-[13px] font-bold text-ink">{display}</span>
      </div>
      <Meter value={value} tone={tone} target={target} label={`${label}: ${display}`} className="mt-1.5" />
      {note ? (
        <p className="mt-1.5 text-[12px] leading-snug text-ink-muted">{note}</p>
      ) : null}
    </div>
  );
}
