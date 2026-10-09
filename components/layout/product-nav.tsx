"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { productNav } from "@/lib/data/product-nav";
import { hotspots } from "@/lib/data/wards";
import { pickups } from "@/lib/data/operations";
import { validationQueue } from "@/lib/data/model";
import { canOpen, roleLabel, type Role } from "@/lib/auth/roles";
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

export interface NavViewer {
  name: string;
  email: string | null;
  role: Role | null;
}

/**
 * The rail.
 *
 * Links the current role cannot open are **removed**, not greyed out. A disabled
 * "Validation queue" invites a click and explains nothing; the role ladder on
 * `/no-access` is where that conversation belongs. It is only the visible half of the
 * rule either way — the pages check the same matrix server-side, so hiding a link
 * here is a courtesy and never the control.
 *
 * The same `canOpen` the proxy and the data access layer call is imported directly,
 * so there is no second copy of the matrix to fall out of step.
 */
export function ProductNav({ viewer }: { viewer: NavViewer }) {
  const pathname = usePathname();

  const groups = productNav
    .map((group) => ({
      label: group.label,
      items: group.items.filter((item) => canOpen(item.href, viewer.role).ok),
    }))
    .filter((group) => group.items.length > 0);

  const hidden = productNav
    .flatMap((group) => group.items)
    .filter((item) => !canOpen(item.href, viewer.role).ok).length;

  return (
    <nav
      aria-label="App sections"
      className="flex flex-col border-ink bg-ink text-paper lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto"
    >
      <div className="border-b border-paper/20 px-5 py-5 lg:px-6">
        {/*
          The mark points at the app's own home here, not the public landing page:
          inside a session "home" means the dashboard, and the landing's job is done.
        */}
        <Link
          href="/dashboard"
          className="font-display text-2xl leading-none tracking-tight text-paper"
        >
          ECO<span className="text-copper">EPR</span>
        </Link>
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-paper/60">
          Verifiable e-waste take-back
        </p>
      </div>

      <div className="flex gap-6 overflow-x-auto px-5 py-4 lg:block lg:overflow-visible lg:px-0 lg:py-0">
        {groups.map((group) => (
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
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper/45">
          Signed in
        </p>
        <p className="mt-1.5 text-[13px] font-medium leading-snug text-paper">
          {viewer.name}
        </p>
        {viewer.email ? (
          <p className="mt-0.5 break-all text-[11px] leading-snug text-paper/55">
            {viewer.email}
          </p>
        ) : null}

        <p className="mt-3 inline-flex items-center gap-2 border border-copper/60 px-2 py-0.5">
          <span aria-hidden className="size-1.5 bg-copper" />
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-copper">
            {roleLabel(viewer.role)}
          </span>
        </p>

        {hidden > 0 ? (
          <p className="mt-3 text-[11px] leading-relaxed text-paper/55">
            {hidden} {hidden === 1 ? "screen is" : "screens are"} hidden by this role.
          </p>
        ) : null}

        <form method="post" action="/api/auth/sign-out" className="mt-4">
          <button
            type="submit"
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
          >
            Sign out
          </button>
        </form>

        <Link
          href="/doc"
          className="mt-4 block border-t border-paper/20 pt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
        >
          Feature documentation →
        </Link>
      </div>
    </nav>
  );
}
