import Link from "next/link";

import { ScannerCursor } from "@/components/motion/scanner-cursor";
import { SpotlightLayer } from "@/components/motion/spotlight-layer";
import { Badge } from "@/components/ui/badge";
import { WorldToggle } from "@/components/world/world-toggle";

/**
 * Chrome for the public landing page.
 *
 * The landing is the one page a brand buyer reaches before they hold an account, so
 * its nav has a different job from the product rail: it points at the pitch (the two
 * in-page sections), the public write-ups, and the two ways in. There is no session
 * read here on purpose — the page is static, and the same CTAs are correct whether or
 * not someone is already signed in.
 */

const footerLinks: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: "Product",
    links: [
      { label: "Open the app", href: "/dashboard" },
      { label: "Sign in", href: "/login" },
      { label: "Create an account", href: "/signup" },
    ],
  },
  {
    heading: "Read",
    links: [
      { label: "Feature write-ups", href: "/doc" },
      { label: "Valuation", href: "/doc/features/valuation" },
      { label: "Gatekeeper", href: "/doc/features/gatekeeper" },
    ],
  },
];

export function LandingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="tone-chrome chrome-glass sticky top-0 z-20 border-b-2 border-ink bg-ink text-paper">
        <nav
          aria-label="Primary"
          className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3 sm:px-8"
        >
          <Link
            href="/"
            className="font-display text-2xl leading-none tracking-tight text-paper"
          >
            ECO<span className="text-copper">EPR</span>
          </Link>

          <span className="hidden h-4 w-px bg-paper/25 sm:block" />

          <p className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-paper/60 md:block">
            Verifiable e-waste take-back
          </p>

          <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-2">
            <a
              href="#gap"
              className="hidden font-mono text-[11px] uppercase tracking-[0.14em] text-paper/70 underline decoration-paper/30 underline-offset-4 hover:text-paper hover:decoration-copper sm:inline-block"
            >
              The gap
            </a>
            <a
              href="#how"
              className="hidden font-mono text-[11px] uppercase tracking-[0.14em] text-paper/70 underline decoration-paper/30 underline-offset-4 hover:text-paper hover:decoration-copper sm:inline-block"
            >
              How it works
            </a>
            <a
              href="#handoff"
              className="hidden font-mono text-[11px] uppercase tracking-[0.14em] text-paper/70 underline decoration-paper/30 underline-offset-4 hover:text-paper hover:decoration-copper md:inline-block"
            >
              Smart pickup
            </a>
            <Link
              href="/doc"
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-paper/70 underline decoration-paper/30 underline-offset-4 hover:text-paper hover:decoration-copper"
            >
              Documentation
            </Link>
            <Link
              href="/login"
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-4 hover:decoration-copper"
            >
              Sign in
            </Link>
            <Link
              href="/dashboard"
              data-magnetic
              className="border-2 border-paper bg-paper px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-ink transition-colors hover:border-copper hover:bg-copper hover:text-paper"
            >
              Open the app
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      {/* The last section of the landing page is an ink block too, so the footer's
          rule has to be drawn in paper rather than ink to read as a boundary. */}
      <footer data-spotlight className="tone-chrome relative isolate overflow-hidden border-t-2 border-paper/25 bg-ink text-paper">
        <SpotlightLayer className="-z-[5]" />
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-10 sm:px-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div>
            <p className="font-display text-xl uppercase leading-tight tracking-tight">
              Credits are simulated. The audit trail is the point.
            </p>
            <p className="mt-3 max-w-xl text-[12px] leading-relaxed text-paper/60">
              EcoEPR routes hazardous e-waste to CPCB-registered recyclers; it does not
              process waste itself. This prototype runs a real multimodal model and a real
              Cognito pool, but every figure on the working screens is a fixture.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-6">
            {footerLinks.map((group) => (
              <nav key={group.heading} aria-label={group.heading}>
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper/60">
                  {group.heading}
                </p>
                <ul className="mt-3 flex flex-col gap-2">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-[13px] text-paper/80 underline decoration-paper/25 underline-offset-4 hover:text-paper hover:decoration-copper"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="border-t border-paper/20">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 sm:px-8">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper/60">
              EcoEPR · Mumbai + Pune pilot · 2026
            </p>
            {/* The landing page is where the 3D runs hardest, so the switch is here too,
                not only in the app's sidebar. */}
            <WorldToggle />
            <Badge tone="review" className="ml-auto">
              Simulated data
            </Badge>
          </div>
        </div>

        {/* The sign-off: an outline that fills with copper as it scrolls into view. */}
        <p aria-hidden className="wordmark select-none px-3 pt-4 pb-[3vw] text-center font-display text-[25vw] uppercase leading-[0.9] tracking-tight">
          EcoEPR
        </p>
      </footer>
      <ScannerCursor />
    </div>
  );
}
