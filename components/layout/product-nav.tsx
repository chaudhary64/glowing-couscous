"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useNavState } from "@/components/layout/nav-frame";
import { productNav } from "@/lib/data/product-nav";
import { canOpen, roleLabel, type Role } from "@/lib/auth/roles";
import { cn } from "@/lib/cn";
import type { ProductHref } from "@/lib/types";

/**
 * Counts only appear where the number means work is waiting. A badge on "Collectors"
 * would be decoration; a badge on "Validation queue" is a to-do.
 *
 * The numbers arrive as a prop rather than an import, because they are real reads: the
 * holds come from Postgres and the open loads from the smart-pickup service, and this is
 * a client component that can make neither call. `ProductShell` makes them and passes the
 * result down. Reading `lib/data` here instead would put a badge on a to-do list that
 * nothing had actually added to.
 */

export interface NavViewer {
  name: string;
  email: string | null;
  role: Role | null;
}

/** Three square bars, the menu button's only mark. */
function MenuIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 20 20"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="square"
    >
      <path d="M3 5h14M3 10h14M3 15h14" />
    </svg>
  );
}

const MENU_BUTTON =
  "size-10 shrink-0 items-center justify-center border-2 border-paper/40 text-paper transition-colors hover:border-paper hover:bg-paper hover:text-ink";

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
 *
 * The menu button folds it. On a desktop the rail shrinks to the button and the page
 * takes the width (the state is held by `NavFrame`, which owns the grid). On a phone the
 * links fold into a menu under the mark instead of running sideways off the screen.
 */
export function ProductNav({
  viewer,
  counts = {},
}: {
  viewer: NavViewer;
  counts?: Partial<Record<ProductHref, number>>;
}) {
  const pathname = usePathname();
  const { collapsed, toggle } = useNavState();
  // The phone menu is open only on the screen it was opened from, so following a link
  // closes it on its own, with no effect to reset it.
  const [menuOpenOn, setMenuOpenOn] = useState<string | null>(null);
  const menuOpen = menuOpenOn === pathname;

  const groups = productNav
    .map((group) => ({
      label: group.label,
      items: group.items.filter((item) => canOpen(item.href, viewer.role).ok),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <nav
      aria-label="App sections"
      className={cn(
        "flex flex-col border-ink bg-ink text-paper lg:sticky lg:top-0 lg:h-screen",
        collapsed ? "lg:overflow-hidden" : "lg:overflow-y-auto",
      )}
    >
      <div
        className={cn(
          "flex items-start justify-between gap-3 border-b-[3px] border-paper/25 px-5 py-5 lg:px-6",
          collapsed && "lg:justify-center lg:px-3",
        )}
      >
        <div className={cn("min-w-0", collapsed && "lg:hidden")}>
          {/*
            The mark points at the app's own home here, not the public landing page:
            inside a session "home" means the dashboard, and the landing's job is done.
          */}
          <Link
            href="/dashboard"
            className="font-display text-2xl leading-none tracking-tight text-paper"
          >
            ECO<span className="text-copper-lit">EPR</span>
          </Link>
          <p className="mt-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-paper/60">
            Verifiable e-waste take-back
          </p>
        </div>

        <button
          type="button"
          onClick={() => setMenuOpenOn(menuOpen ? null : pathname)}
          aria-expanded={menuOpen}
          aria-controls="app-nav-links"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          className={cn(MENU_BUTTON, "inline-flex lg:hidden")}
        >
          <MenuIcon />
        </button>
        <button
          type="button"
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls="app-nav-links"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          title={collapsed ? "Expand navigation" : "Collapse navigation"}
          className={cn(MENU_BUTTON, "hidden lg:inline-flex")}
        >
          <MenuIcon />
        </button>
      </div>

      <div
        id="app-nav-links"
        className={cn(menuOpen ? "block" : "hidden", "pb-3 lg:block lg:pb-0", collapsed && "lg:hidden")}
      >
        {groups.map((group) => (
          <div key={group.label} className="pt-4 lg:pt-5">
            <p className="px-5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-paper/60 lg:px-6">
              {group.label}
            </p>
            <ul className="mt-2 flex flex-col">
              {group.items.map((item) => {
                const active = pathname === item.href;
                const count = counts[item.href];
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={item.hint}
                      aria-current={active ? "page" : undefined}
                      className={[
                        "flex items-center justify-between gap-3 border-b-[3px] border-paper/20 px-5 py-3 text-[13px] transition-colors lg:px-6",
                        // The screen you are on is a full inversion; everything else is
                        // the skill's list hover — lighten the ground, underline the word.
                        active
                          ? "bg-paper font-bold text-ink"
                          : "text-paper/80 hover:bg-paper/10 hover:text-paper hover:underline",
                      ].join(" ")}
                    >
                      <span>{item.label}</span>
                      {count ? (
                        <span
                          className={[
                            "border-2 px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums",
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

      <div
        className={cn(
          "mt-auto hidden border-t-[3px] border-paper/25 px-6 py-5 lg:block",
          collapsed && "lg:hidden",
        )}
      >
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-paper/60">
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

        <p className="mt-3 inline-flex items-center gap-2 border-2 border-copper-lit px-2 py-1">
          <span aria-hidden className="size-1.5 bg-copper-lit" />
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-copper-lit">
            {roleLabel(viewer.role)}
          </span>
        </p>

        <form method="post" action="/api/auth/sign-out" className="mt-4">
          <button
            type="submit"
            className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-copper-lit underline decoration-copper-lit/50 underline-offset-2 hover:decoration-copper-lit"
          >
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
