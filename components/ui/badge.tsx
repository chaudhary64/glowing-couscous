import { cn } from "@/lib/cn";
import type { BadgeTone } from "@/lib/tone";

export type { BadgeTone };

const tones: Record<BadgeTone, string> = {
  neutral: "border-rule text-ink-muted bg-paper",
  ink: "border-ink bg-ink text-paper",
  copper: "border-copper text-copper bg-copper-tint",
  verified: "border-verified text-verified bg-verified-tint",
  hazard: "border-hazard text-hazard bg-hazard-tint",
  review: "border-review text-review bg-review-tint",
  lead: "border-lead text-lead bg-paper",
};

export function Badge({
  children,
  tone = "neutral",
  solid = false,
  className,
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
  /** Filled variant for the single most important state on a screen. */
  solid?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em]",
        solid
          ? cn(
              "text-paper",
              tone === "verified" && "border-verified bg-verified",
              tone === "hazard" && "border-hazard bg-hazard",
              tone === "review" && "border-review bg-review",
              tone === "copper" && "border-copper bg-copper",
              tone === "ink" && "border-ink bg-ink",
              tone === "lead" && "border-lead bg-lead",
              tone === "neutral" && "border-ink bg-ink",
            )
          : tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A small square marker for legends and status lists. */
export function Dot({ tone = "neutral" }: { tone?: BadgeTone }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2",
        tone === "verified" && "bg-verified",
        tone === "hazard" && "bg-hazard",
        tone === "review" && "bg-review",
        tone === "copper" && "bg-copper",
        tone === "lead" && "bg-lead",
        tone === "ink" && "bg-ink",
        tone === "neutral" && "bg-rule",
      )}
    />
  );
}
