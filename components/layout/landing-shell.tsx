import { connection } from "next/server";
import Link from "next/link";

import { LandingFooter } from "@/components/layout/landing-footer";
import { ButtonLink } from "@/components/ui/button";
import { getSession } from "@/lib/auth/session";
import { landingEntry, landingSections } from "@/lib/data/landing";

/**
 * Chrome for the public landing page.
 *
 * The landing is the one page a brand buyer reaches before they hold an account, so
 * its nav has a different job from the product rail: it points at the pitch (the
 * in-page sections), and the ways in.
 *
 * The session is read here because those ways in are not the same for both visitors. A
 * signed-out guest was being offered "Open the app", a button that cannot open anything
 * for them — every working screen sits behind a session, so it only bounced them into
 * the sign-in form (proxy.ts). The pair now comes from `landingEntry`, so the header,
 * hero, closing band and footer all offer the account a visitor actually has.
 *
 * It is drawn to match the page it sits on: bone with a hairline, not an ink band. The
 * header should not be the loudest thing on a page made of type.
 */

export async function LandingShell({ children }: { children: React.ReactNode }) {
  // Prerendering stops here, the way it does in `AuthShell` and `ProductShell`: these
  // CTAs are decided by a verified id token, which is request data, and nothing about it
  // may be baked into a static shell. `app/(landing)/layout.tsx` says the same thing in
  // configuration (`instant = false`).
  await connection();
  const user = await getSession();
  const entry = landingEntry(user !== null);

  return (
    // `.landing-bone` re-points the palette for this route only (app/(landing)/landing.css).
    <div className="landing-bone flex min-h-dvh flex-col">
      {/* Three columns: wordmark, the sections, the two ways in. It never wraps — a
          wrapped nav is what the old ink bar did on a narrow screen. */}
      <header className="sticky top-0 z-20 border-b border-rule bg-paper">
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

          {/* Centred between the wordmark and the actions, and dropped below `lg`, where
              the two CTAs are the only things a visitor actually needs. */}
          <ul className="hidden items-center justify-center gap-x-8 lg:flex">
            {landingSections.map((section) => (
              <li key={section.href}>
                <a
                  href={section.href}
                  className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-ink-muted underline decoration-transparent underline-offset-[6px] transition-colors hover:text-ink hover:decoration-copper"
                >
                  {section.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-self-end gap-x-4 sm:gap-x-6">
            {/* Signed out: create the account, or go straight to signing in. Signed in:
                neither is offered, because the proxy bounces `/login` and `/signup` back to
                the app — the only real move left is to open it. */}
            {entry.secondary ? (
              <Link
                href={entry.secondary.href}
                className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-copper underline decoration-copper/40 underline-offset-[6px] hover:decoration-copper"
              >
                {entry.secondary.label}
              </Link>
            ) : null}
            {/* The page's own primary button, so the header CTA and the hero CTA are the
                same object rather than two lookalikes. */}
            <ButtonLink href={entry.primary.href}>{entry.primary.label}</ButtonLink>
          </div>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <LandingFooter user={user} />
    </div>
  );
}
