"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { productNav } from "@/lib/data/product-nav";
import { hotspots } from "@/lib/data/wards";
import { pickups } from "@/lib/data/operations";
import { validationQueue } from "@/lib/data/model";
import type { ProductHref } from "@/lib/types";

/**
 * Counts only appear where the number means work is waiting. A badge on
 * "Collectors" would be decoration; a badge on "Validation queue" is a to-do.
 */
const workCounts: Partial<Record<ProductHref, number>> = {
  "/validation": validationQueue.filter((record) => record.verdict === "review")
    .length,
  "/pickups": pickups.filter(
    (pickup) => pickup.status === "in-transit" || pickup.status === "assigned",
  ).length,
  "/map": hotspots.filter((spot) => spot.status === "open").length,
};

export function ProductNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="App sections"
      className="flex flex-col border-ink bg-ink text-paper lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto"
    >
      <div className="border-b border-paper/20 px-5 py-5 lg:px-6">
        <Link href="/" className="font-display text-2xl leading-none tracking-tight text-paper">
          ECO<span className="text-copper">EPR</span>
        </Link>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-paper/60">
          Waste &amp; Energy · Track 03
        </p>
      </div>

      <div className="flex gap-6 overflow-x-auto px-5 py-4 lg:block lg:overflow-visible lg:px-0 lg:py-0">
        {productNav.map((group) => (
          <div key={group.label} className="lg:pt-5">
            <p className="hidden font-mono text-[10px] uppercase tracking-[0.18em] text-paper/45 lg:block lg:px-6">
              {group.label}
            </p>
            <ul className="flex gap-px lg:mt-2 lg:flex-col lg:gap-0">
              {group.items.map((item) => {
                const active = pathname === item.href;
                const count = workCounts[item.href];
                return (
                  <li key={item.href} className="shrink-0 lg:shrink">
                    <Link
                      href={item.href}
                      title={item.hint}
                      aria-current={active ? "page" : undefined}
                      className={[
                        "flex min-w-[150px] items-center justify-between gap-3 border-b border-paper/15 px-5 py-3 text-[13px] font-medium transition-colors lg:min-w-0 lg:px-6",
                        active
                          ? "bg-paper text-ink"
                          : "text-paper/80 hover:bg-paper/10 hover:text-paper",
                      ].join(" ")}
                    >
                      <span>{item.label}</span>
                      {count ? (
                        <span
                          className={[
                            "border px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
                            active
                              ? "border-copper text-copper"
                              : "border-paper/40 text-paper/80",
                          ].join(" ")}
                        >
                          {count}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-auto hidden border-t border-paper/20 px-6 py-5 lg:block">
        <Link
          href="/doc"
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
        >
          Feature documentation →
        </Link>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-paper/50">
          Simulated credits
        </p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-paper/65">
          No real payouts. Routes to CPCB-registered recyclers only.
        </p>
      </div>
    </nav>
  );
}
