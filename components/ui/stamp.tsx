import { cn } from "@/lib/cn";
import { verdictLabel, type BadgeTone } from "@/lib/tone";
import type { Verdict } from "@/lib/types";

const stampColors: Record<BadgeTone, string> = {
  neutral: "border-ink text-ink",
  ink: "border-ink text-ink",
  copper: "border-copper text-copper",
  verified: "border-verified text-verified",
  hazard: "border-hazard text-hazard",
  review: "border-review text-review",
  lead: "border-lead text-lead",
};

const verdictStamps: Record<Verdict, { label: string; tone: BadgeTone }> = {
  verified: { label: verdictLabel("verified"), tone: "verified" },
  rejected: { label: verdictLabel("rejected"), tone: "hazard" },
  review: { label: verdictLabel("review"), tone: "review" },
};

/**
 * The one loud element in the design: a rubber stamp struck across a record.
 * Everything else on the page stays quiet so this reads as a verdict.
 */
export function Stamp({
  verdict,
  label,
  tone,
  angle = -6,
  className,
}: {
  /** Derives both wording and colour when given a verdict. */
  verdict?: Verdict;
  label?: string;
  tone?: BadgeTone;
  angle?: number;
  className?: string;
}) {
  const resolved = verdict
    ? verdictStamps[verdict]
    : { label: label ?? "Stamped", tone: tone ?? "ink" };

  return (
    <span
      aria-hidden
      className={cn(
        "inline-block select-none border-[3px] px-3 py-1 font-display text-lg uppercase leading-none tracking-[0.18em]",
        stampColors[resolved.tone],
        className,
      )}
      style={{ transform: `rotate(${angle}deg)` }}
    >
      {resolved.label}
    </span>
  );
}

/** Accessible verdict marker for places where the rotated stamp would not fit. */
export function VerdictMark({
  verdict,
  className,
}: {
  verdict: Verdict;
  className?: string;
}) {
  const resolved = verdictStamps[verdict];
  return (
    <span
      className={cn(
        "inline-block border-[3px] px-2 py-0.5 font-display text-sm uppercase tracking-[0.16em]",
        stampColors[resolved.tone],
        className,
      )}
    >
      {resolved.label}
    </span>
  );
}
