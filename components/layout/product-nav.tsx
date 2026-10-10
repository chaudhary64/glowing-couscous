"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";
import { productNav } from "@/lib/data/product-nav";
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
  const navList = useRef<HTMLDivElement>(null);
  const marker = useRef<HTMLSpanElement>(null);

  // The active block slides to the page you opened instead of jumping (desktop rail),
  // and on the phone's sideways nav the active item scrolls into view. Written straight
  // to the marker's style after layout: no state, so no extra render per navigation.
  useLayoutEffect(() => {
    const list = navList.current;
    const block = marker.current;
    const link = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !block) return;
    if (!link) {
      block.style.opacity = "0";
      return;
    }
    const top = link.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    const first = block.dataset.placed !== "1";
    block.style.transition = first ? "none" : "";
    block.style.transform = `translateY(${top}px)`;
    block.style.height = `${link.offsetHeight}px`;
    block.style.opacity = "1";
    block.dataset.placed = "1";
    if (window.matchMedia("(max-width: 1023px)").matches) {
      link.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    }
  }, [pathname]);

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
      className="tone-chrome chrome-glass flex flex-col border-ink bg-ink text-paper lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto"
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

      <div ref={navList} className="relative flex gap-6 overflow-x-auto px-5 py-4 lg:block lg:overflow-visible lg:px-0 lg:py-0">
        {/* The sliding active block (desktop rail only), behind the links. */}
        <span ref={marker} aria-hidden className="nav-marker pointer-events-none absolute inset-x-0 top-0 hidden lg:block" />
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
                        "relative z-[1] flex min-w-[150px] items-center justify-between gap-3 border-b border-paper/15 px-5 py-3 text-[13px] font-medium transition-colors duration-300 lg:min-w-0 lg:px-6",
                        active
                          ? // On the rail the sliding block is the background; the label turns dark
                            // only as the block arrives under it, never dark-on-dark mid-slide.
                            "bg-paper text-ink lg:bg-transparent lg:text-paper lg:delay-200"
                          : "text-paper/80 hover:bg-paper/10 hover:text-paper",
                      ].join(" ")}
                    >
                      <span>{item.label}</span>
                      <PendingHint />
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

/**
 * While the page a link points at is still rendering (these routes block on the session
 * check, so there is no loading.js to show instantly), a copper bar runs along the
 * bottom of the clicked link. It waits 120 ms before showing, so a fast navigation never
 * flashes it.
 */
function PendingHint() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`link-pending ${pending ? "is-pending" : ""}`} />;
}
