import { cn } from "@/lib/cn";
import type { Pickup } from "@/lib/types";

/**
 * The step trail for one pickup. Steps are a real sequence, so they are numbered
 * — the order carries the audit, and the order is the point: collector to
 * licensed recycler to settled credit.
 *
 * Done/pending is never colour-only: each step also carries the word.
 */
export function PickupTimeline({
  pickup,
  recyclerName,
  className,
}: {
  pickup: Pickup;
  recyclerName: string;
  className?: string;
}) {
  const remaining = pickup.steps.filter((step) => !step.done).length;

  return (
    <div className={cn("flex flex-col", className)}>
      <ol className="flex flex-col">
        {pickup.steps.map((step, index) => (
          <li
            key={step.label}
            className="relative flex gap-3 pb-5 last:pb-0"
          >
            {index < pickup.steps.length - 1 ? (
              <span
                aria-hidden
                className="absolute top-4 bottom-0 left-[7px] w-px bg-rule"
              />
            ) : null}

            <span
              aria-hidden
              className={cn(
                "mt-1 size-4 shrink-0 border-2",
                step.done
                  ? "border-verified bg-verified"
                  : "border-ink bg-paper",
              )}
            />

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="flex items-baseline gap-2">
                  <span className="font-mono text-[10px] tabular-nums text-ink-muted">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={cn(
                      "text-sm leading-snug",
                      step.done ? "text-ink" : "text-ink-muted",
                    )}
                  >
                    {step.label}
                  </span>
                </p>
                <span className="font-mono text-[11px] tabular-nums text-ink-muted">
                  {step.at}
                </span>
              </div>
              <p
                className={cn(
                  "mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em]",
                  step.done ? "text-verified" : "text-ink-muted",
                )}
              >
                {step.done ? "Done" : "Pending"}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 border-t border-rule pt-3">
        <p className="text-[12px] leading-relaxed text-ink-soft">
          {remaining === 0
            ? `${pickup.id} is closed: the load was received by ${recyclerName} and the credit note settled against verified weight.`
            : `${remaining} step${remaining === 1 ? "" : "s"} left. Weighing at the recycler gate sets the payable mass, and settlement follows that weight — which is what turns a promise into a documented chain from doorstep to licensed line.`}
        </p>
        {pickup.hazardous ? (
          <p className="mt-2 text-[12px] leading-relaxed text-hazard">
            Hazard declaration is already attached, so this load cannot be rerouted
            to an unlicensed buyer mid-journey.
          </p>
        ) : null}
      </div>
    </div>
  );
}
