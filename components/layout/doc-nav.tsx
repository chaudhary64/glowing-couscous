"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { features } from "@/lib/data/features";

const statusLabel: Record<string, string> = {
  core: "Core",
  supporting: "Supporting",
  deferred: "Deferred",
};

/**
 * The documentation rail is a ranked index: the reading order follows the
 * pipeline, and the leading number is the priority from the track doc. Order
 * carries information, so the numbers are justified rather than decorative.
 */
export function DocNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Feature write-ups"
      className="flex flex-col border-ink bg-ink text-paper lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto"
    >
      <div className="border-b border-paper/20 px-5 py-5 lg:px-6">
        <Link href="/" className="font-display text-2xl leading-none tracking-tight text-paper">
          ECO<span className="text-copper">EPR</span>
        </Link>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-paper/60">
          Feature documentation
        </p>
        <Link
          href="/"
          className="mt-3 inline-block font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
        >
          ← Back to the app
        </Link>
      </div>

      <ul className="flex gap-px overflow-x-auto lg:flex-col lg:gap-0 lg:overflow-visible">
        <li className="shrink-0 lg:shrink">
          <Link
            href="/doc"
            aria-current={pathname === "/doc" ? "page" : undefined}
            className={[
              "flex min-w-[170px] items-start gap-3 border-b border-paper/15 px-5 py-3.5 transition-colors lg:min-w-0 lg:px-6",
              pathname === "/doc"
                ? "bg-paper text-ink"
                : "text-paper/80 hover:bg-paper/10 hover:text-paper",
            ].join(" ")}
          >
            <span className="mt-0.5 font-mono text-[11px] tabular-nums text-copper">00</span>
            <span className="block text-[13px] font-medium leading-snug">
              Priority ladder
            </span>
          </Link>
        </li>

        {features.map((feature) => {
          const active = pathname === feature.docHref;
          return (
            <li key={feature.slug} className="shrink-0 lg:shrink">
              <Link
                href={feature.docHref}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex min-w-[190px] items-start gap-3 border-b border-paper/15 px-5 py-3.5 transition-colors lg:min-w-0 lg:px-6",
                  active
                    ? "bg-paper text-ink"
                    : "text-paper/80 hover:bg-paper/10 hover:text-paper",
                ].join(" ")}
              >
                <span
                  className={[
                    "mt-0.5 font-mono text-[11px] tabular-nums",
                    active ? "text-copper" : "text-copper/80",
                  ].join(" ")}
                >
                  {String(feature.rank).padStart(2, "0")}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium leading-snug">
                    {feature.name}
                  </span>
                  <span
                    className={[
                      "mt-0.5 block font-mono text-[10px] uppercase tracking-[0.12em]",
                      active ? "text-ink-muted" : "text-paper/45",
                    ].join(" ")}
                  >
                    {statusLabel[feature.status]}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto hidden border-t border-paper/20 px-6 py-5 lg:block">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper/50">
          Simulated credits
        </p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-paper/65">
          No real payouts. Routes to CPCB-registered recyclers only.
        </p>
      </div>
    </nav>
  );
}
