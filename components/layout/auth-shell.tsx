import Link from "next/link";
import { connection } from "next/server";

import { LandingFooter } from "@/components/layout/landing-footer";
import { roleLabel } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";

/**
 * The frame around sign in, sign up, confirmation and the refusal screen.
 *
 * These four screens are what a visitor sees before they hold an account, so the chrome is
 * the public surface's — a sticky header rather than a rail, and the landing's own footer
 * to close with — but the ground under it is RawBlock, the same white-and-black the working
 * screens wear. These screens used to import
 * `app/(landing)/landing.css` to borrow the landing's bone palette; they no longer do,
 * because there is no second palette to borrow. The landing keeps its bone override, and
 * the app is one ground from the sign-in form to the last table row.
 *
 * The footer is `LandingFooter` rather than a band retyped here: a visitor on these screens
 * has not signed in yet, so they get the public surface's sign-off, and there is one footer
 * to keep true instead of two. The strip reports the session rather than assuming there
 * isn't one — `/no-access` is only reachable while signed in.
 *
 * There is no badge. A "Prototype" chip on all four screens was the same warning as the one
 * that came off the product screens, and for the same reason: pinned to every screen it
 * stops being read. What is not real is said where a figure is printed (lib/disclaimer.ts).
 */
export async function AuthShell({ children }: { children: React.ReactNode }) {
  // Prerendering stops here, for the same reason it stops in `ProductShell`: this strip
  // verifies an id token to say who is signed in, and a verified session is request data
  // that must not be baked into a shell. Without it, every render of these four screens
  // reports `blocking-prerender-current-time`.
  await connection();

  /*
    Three of the four screens in this group are unreachable while signed in — the proxy sees
    to that — but `/no-access` is only reachable while signed in, and it used to sit under a
    strip reading "Not signed in" directly above a line reading "Signed in as…".
  */
  const user = await getSession();
  const status = user ? `Signed in · ${roleLabel(user.role)}` : "Not signed in";

  return (
    // No palette override any more: RawBlock is the app's ground, so these screens wear
    // it directly rather than borrowing the landing's bone through a stylesheet import.
    <div className="flex min-h-dvh flex-col">
      {/* The landing's header, not an ink band: on a page made of type the header should
          not be the loudest thing on it. */}
      <header className="sticky top-0 z-20 border-b-[3px] border-ink bg-paper">
        <nav
          aria-label="Primary"
          className="mx-auto grid w-full max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-x-4 px-5 py-5 sm:px-8"
        >
          <Link
            href="/"
            className="font-display text-xl leading-none tracking-tight text-ink sm:text-2xl"
          >
            ECO<span className="text-copper">EPR</span>
          </Link>

          <p className="hidden justify-self-center font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-ink-muted sm:block">
            {status}
          </p>

          <Link
            href="/"
            className="justify-self-end font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-copper underline decoration-copper/40 underline-offset-[6px] hover:decoration-copper"
          >
            Overview
          </Link>
        </nav>
      </header>

      {/*
        `min-h-dvh`, not `min-h-full`: the confirmation screen is short, and a percentage
        min-height against an auto-height body collapses, which leaves the close band
        halfway up the page with paper below it.
      */}
      <main className="flex-1">
        <div className="mx-auto w-full max-w-2xl px-5 py-14 sm:px-8 sm:py-20">
          {children}
        </div>
      </main>

      {/* The landing's sign-off, not a band retyped here: these screens are the public
          surface's, so they close the way the landing closes. */}
      <LandingFooter />
    </div>
  );
}
