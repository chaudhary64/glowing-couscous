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

/** Responsive menu mark: three bars when closed, crossed lines when open. */
function MenuIcon({ open = false }: { open?: boolean }) {
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
      {open ? <path d="M4 4l12 12M16 4 4 16" /> : <path d="M3 5h14M3 10h14M3 15h14" />}
    </svg>
  );
}

function NavGlyph({ href }: { href: ProductHref }) {
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center border border-current"
    >
      <svg
        viewBox="0 0 20 20"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {href === "/dashboard" ? (
          <>
            <rect x="3" y="3" width="5" height="5" />
            <rect x="12" y="3" width="5" height="5" />
            <rect x="3" y="12" width="5" height="5" />
            <rect x="12" y="12" width="5" height="5" />
          </>
        ) : href === "/intake" ? (
          <>
            <path d="M3 7.5h3l1.2-2h4.6l1.2 2H17v8.5H3z" />
            <circle cx="10" cy="11.5" r="2.5" />
            <path d="M15 3v3M13.5 4.5h3" />
          </>
        ) : href === "/valuation" ? (
          <>
            <path d="M3 16V9M8 16V5M13 16v-3M18 16V3" />
            <path d="M2 16.5h16" />
          </>
        ) : href === "/validation" ? (
          <>
            <path d="M10 2.5 16 5v4.5c0 3.7-2.5 6.4-6 8-3.5-1.6-6-4.3-6-8V5z" />
            <path d="m7.2 10 1.8 1.8 3.8-4" />
          </>
        ) : href === "/pickups" ? (
          <>
            <path d="M2.5 5.5h9v8h-9zM11.5 8h3l3 3v2.5h-6z" />
            <circle cx="6" cy="15" r="1.5" />
            <circle cx="15" cy="15" r="1.5" />
          </>
        ) : href === "/handoff" ? (
          <>
            <rect x="5" y="2.5" width="10" height="15" rx="1.5" />
            <path d="M8.5 5h3M9 14.5h2" />
          </>
        ) : href === "/gate" ? (
          <>
            <path d="M3 5h14M10 5v10M5 15h10" />
            <path d="M6 5 4 11h4zM14 5l-2 6h4z" />
          </>
        ) : href === "/demo" ? (
          <>
            <rect x="2.5" y="4" width="6.5" height="12" rx="1" />
            <rect x="11" y="4" width="6.5" height="12" rx="1" />
            <path d="M9 10h2" />
          </>
        ) : href === "/evidence" ? (
          <>
            <path d="M5 2.5h7l3 3V17H5z" />
            <path d="M12 2.5V6h3M7.5 9h5M7.5 12h5" />
          </>
        ) : href === "/map" ? (
          <>
            <path d="M10 17s5-4.7 5-9a5 5 0 1 0-10 0c0 4.3 5 9 5 9z" />
            <circle cx="10" cy="8" r="1.5" />
          </>
        ) : href === "/collectors" ? (
          <>
            <circle cx="7" cy="7" r="2.5" />
            <circle cx="14" cy="8" r="2" />
            <path d="M2.8 16c.4-2.5 2-4 4.2-4s3.8 1.5 4.2 4M12 13c2.7-.5 4.6.6 5.2 3" />
          </>
        ) : href === "/recyclers" ? (
          <>
            <path d="M3 17V6l7-3 7 3v11zM6 17v-5h8v5M6 8h.1M10 8h.1M14 8h.1" />
          </>
        ) : href === "/team" ? (
          <>
            <circle cx="10" cy="6.5" r="2.5" />
            <path d="M4.5 17c.4-3.3 2.2-5 5.5-5s5.1 1.7 5.5 5M3 10h2M15 10h2" />
          </>
        ) : (
          <>
            <path d="M4 5h12M4 10h12M4 15h12" />
            <circle cx="8" cy="5" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="13" cy="10" r="1.5" fill="currentColor" stroke="none" />
            <circle cx="7" cy="15" r="1.5" fill="currentColor" stroke="none" />
          </>
        )}
      </svg>
    </span>
  );
}

const MENU_BUTTON =
  "size-10 shrink-0 items-center justify-center border border-paper/40 text-paper transition-colors hover:border-copper-lit hover:bg-paper hover:text-ink";

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
        "relative flex min-w-0 flex-col border-ink bg-ink text-paper lg:sticky lg:top-0 lg:h-screen",
        collapsed ? "lg:overflow-hidden" : "lg:overflow-y-auto",
      )}
    >
      <div
        className={cn(
          "flex items-start justify-between gap-3 border-b border-paper/20 bg-ink px-5 py-5 pl-6 lg:px-5 lg:pl-6",
          collapsed && "lg:justify-center lg:px-2 lg:pl-2",
        )}
      >
        <div className={cn("min-w-0", collapsed && "lg:hidden")}>
          {/*
            The mark points at the app's own home here, not the public landing page:
            inside a session "home" means the dashboard, and the landing's job is done.
          */}
          <Link
            href="/dashboard"
            className="font-display text-[1.7rem] leading-none tracking-tight text-paper"
          >
            ECO<span className="text-copper-lit">EPR</span>
          </Link>
          <p className="mt-2 flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-paper/55">
            <span aria-hidden className="size-1.5 bg-copper-lit" />
            Operations console
          </p>
        </div>
        <Link
          href="/dashboard"
          aria-label="EcoEPR dashboard"
          className={cn(
            "hidden size-9 items-center justify-center border border-copper-lit font-display text-sm text-paper hover:bg-copper-lit hover:text-ink",
          )}
        >
          E<span className="text-copper-lit">·</span>
        </Link>

        <button
          type="button"
          onClick={() => setMenuOpenOn(menuOpen ? null : pathname)}
          aria-expanded={menuOpen}
          aria-controls="app-nav-links"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          className={cn(MENU_BUTTON, "inline-flex lg:hidden")}
        >
          <MenuIcon open={menuOpen} />
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
          <MenuIcon open={!collapsed} />
        </button>
      </div>

      <div
        id="app-nav-links"
        className={cn(menuOpen ? "block" : "hidden", "pb-4 lg:block lg:pb-0")}
      >
        {groups.map((group, groupIndex) => (
          <div key={group.label} className="pt-6 first:pt-5">
            <p className={cn(
              "flex items-center gap-2 px-5 pl-6 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-paper/45 lg:px-5 lg:pl-6",
              collapsed && "lg:hidden",
            )}>
              <span className="text-copper-lit">{String(groupIndex + 1).padStart(2, "0")}</span>
              <span aria-hidden className="h-px w-4 bg-paper/25" />
              {group.label}
            </p>
            <ul className="mt-3 flex flex-col gap-1 px-2 lg:px-2.5">
              {group.items.map((item) => {
                const active = pathname === item.href;
                const count = counts[item.href];
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      title={item.hint}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-3 border border-transparent px-3 py-2.5 pl-4 text-[13px] transition-colors lg:px-3",
                        collapsed && "lg:justify-center lg:px-2",
                        active
                          ? "border-paper bg-paper font-bold text-ink"
                          : "text-paper/70 hover:border-paper/20 hover:bg-paper/10 hover:text-paper",
                      )}
                    >
                      {active ? <span aria-hidden className="absolute inset-y-1 left-0 w-1 bg-copper" /> : null}
                      <NavGlyph href={item.href} />
                      <span className={cn("min-w-0 truncate", collapsed && "lg:hidden")}>{item.label}</span>
                      {count && !collapsed ? (
                        <span
                          className={[
                            "ml-auto border px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums",
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
          "mt-auto hidden border-t border-paper/20 bg-paper/5 px-4 py-4 lg:block",
          collapsed && "lg:hidden",
        )}
      >
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center bg-copper-lit font-display text-sm text-ink">
            {viewer.name.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium leading-snug text-paper">{viewer.name}</p>
            <p className="mt-1 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-copper-lit">
              {roleLabel(viewer.role)}
            </p>
          </div>
        </div>
        {viewer.email ? (
          <p className="mt-3 truncate border-t border-paper/15 pt-3 text-[11px] text-paper/45">
            {viewer.email}
          </p>
        ) : null}
        <form method="post" action="/api/auth/sign-out" className="mt-3">
          <button
            type="submit"
            className="w-full border border-paper/20 px-3 py-2 text-left font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-paper/65 transition-colors hover:border-copper-lit hover:text-copper-lit"
          >
            Sign out
          </button>
        </form>
      </div>
      <div className={cn("mt-auto hidden border-t border-paper/20 p-3 lg:hidden", collapsed && "lg:block")}>
        <div className="flex items-center justify-center border border-paper/25 py-2 text-copper-lit" title={viewer.name}>
          <span className="font-mono text-[11px] font-bold uppercase">{viewer.name.slice(0, 1)}</span>
        </div>
      </div>
    </nav>
  );
}
