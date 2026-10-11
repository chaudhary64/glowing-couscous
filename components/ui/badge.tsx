import { cn } from "@/lib/cn";
import type { BadgeTone } from "@/lib/tone";

export type { BadgeTone };

/*
  A status chip is white, with a 2px edge in the colour and the colour's label inside —
  the skill's chip, not a pill and not a tint block. `-ink` is the AA-safe companion of
  the pure status colour (see the note in app/globals.css).
*/
const tones: Record<BadgeTone, string> = {
  neutral: "border-ink text-ink bg-paper",
  ink: "border-ink bg-ink text-paper",
  copper: "border-copper text-copper bg-paper",
  verified: "border-verified text-verified bg-paper",
  hazard: "border-hazard text-hazard-ink bg-paper",
  review: "border-review text-review-ink bg-paper",
  lead: "border-ink text-ink bg-paper",
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
        "inline-flex items-center gap-1.5 border-2 px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.09em]",
        solid
          ? cn(
              "text-paper",
              tone === "verified" && "border-verified bg-verified",
              tone === "hazard" && "border-hazard bg-hazard",
              tone === "review" && "border-review bg-review",
              tone === "copper" && "border-copper bg-copper",
              tone === "ink" && "border-ink bg-ink",
              tone === "lead" && "border-ink bg-ink",
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
        tone === "lead" && "bg-ink",
        tone === "ink" && "bg-ink",
        tone === "neutral" && "bg-rule",
      )}
    />
  );
}
