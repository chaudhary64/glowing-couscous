import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { AuthUser } from "@/lib/auth/token";
import { landingEntry, landingSections, type LandingEntryLink } from "@/lib/data/landing";
import { SIMULATED_LABEL } from "@/lib/disclaimer";

/**
 * The landing's sign-off, ported from `chaudhary64/corex` (`src/app/components/ui/Footer.jsx`).
 *
 * The composition is the reference's, kept whole: a three-part contact band above an ink
 * slab, the slab's first column carrying the outlined wordmark and the other three the
 * links, then a thin bar of fine print. What could not come across is the reference's
 * instrumentation — it drives the band with GSAP's `SplitText` and `DrawSVGPlugin`, which
 * are Club GreenSock plugins this project does not have, and it draws its icons with
 * `react-icons`. So the band's arrivals run on `data-motion` (components/motion, with one
 * new `draw` kind for the wave) and the arrow is sixteen characters of inline path. The
 * reference's newsletter and social rows are gone rather than faked: this product has no
 * list to join and no accounts to follow, and a footer is a bad place to start inventing.
 *
 * Two deliberate departures, both of them the house rules:
 *
 * - The reference's circle — a `rounded-full` lime disc holding the arrow — is a square
 *   block here. Nothing in this interface rounds a corner (components/ui/button.tsx).
 * - The wordmark is Archivo Black in outline that fills with copper on scroll, the
 *   reference's gesture in this brand's hand, and it sits in the first column as theirs
 *   does.
 */

/** The long arrow the reference uses in its kicker and its circle, drawn rather than imported. */
function Arrow({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 22 12" fill="none" className={className}>
      <path
        d="M0 6h19.5M15 1.5 19.5 6 15 10.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="square"
      />
    </svg>
  );
}

/**
 * The wave the reference draws under its closing line, as geometry instead of an export.
 *
 * Its own path is a 6 KB polyline a design tool emitted — 409 samples, one every half a
 * unit. This is the same curve stated as 24 cubic Béziers: six periods across a 601 × 12
 * box, amplitude 4.5 about y=6, each quarter period fitted to the real sine (worst
 * deviation 0.0004 units) with its endpoints on the exact peak, trough and zero crossing.
 * It is a length, not a picture, which is what the `draw` motion needs.
 */
const SINE_PATH =
  "M0.75 6 C8.87 3.7 16.69 1.5 25.75 1.5 C34.81 1.5 42.63 3.7 50.75 6 C58.87 8.3 66.69 10.5 75.75 10.5 C84.81 10.5 92.63 8.3 100.75 6 C108.87 3.7 116.69 1.5 125.75 1.5 C134.81 1.5 142.63 3.7 150.75 6 C158.87 8.3 166.69 10.5 175.75 10.5 C184.81 10.5 192.63 8.3 200.75 6 C208.87 3.7 216.69 1.5 225.75 1.5 C234.81 1.5 242.63 3.7 250.75 6 C258.87 8.3 266.69 10.5 275.75 10.5 C284.81 10.5 292.63 8.3 300.75 6 C308.87 3.7 316.69 1.5 325.75 1.5 C334.81 1.5 342.63 3.7 350.75 6 C358.87 8.3 366.69 10.5 375.75 10.5 C384.81 10.5 392.63 8.3 400.75 6 C408.87 3.7 416.69 1.5 425.75 1.5 C434.81 1.5 442.63 3.7 450.75 6 C458.87 8.3 466.69 10.5 475.75 10.5 C484.81 10.5 492.63 8.3 500.75 6 C508.87 3.7 516.69 1.5 525.75 1.5 C534.81 1.5 542.63 3.7 550.75 6 C558.87 8.3 566.69 10.5 575.75 10.5 C584.81 10.5 592.63 8.3 600.75 6";

export function LandingFooter({ user }: { user: AuthUser | null }) {
  /*
    The product column and the arrow both follow the same rule as the header
    (lib/data/landing.ts): an account to open when there is a session, the two ways to
    get one when there is not. A signed-out reader was being pointed at "/dashboard"
    from this footer as well, which is a redirect into the sign-in form and nothing more.
  */
  const entry = landingEntry(user !== null);
  const productLinks: LandingEntryLink[] = [entry.primary, entry.secondary].filter(
    (link): link is LandingEntryLink => link !== null,
  );

  return (
    // Drawn in paper rather than ink, because the section above it is an ink block too.
    <footer className="relative isolate overflow-hidden border-t-2 border-paper/25 bg-ink text-paper">
      {/* ------------------------------------------------------- the contact band */}
      {/* Desktop only, as in the reference: on a phone the slab below is the whole footer,
          and a second invitation is a scroll, not a courtesy. */}
      <div
        data-motion="rows"
        className="mx-auto hidden w-full max-w-6xl items-center justify-between gap-10 px-8 pt-16 pb-14 lg:flex"
      >
        <p className="flex items-center gap-3 font-mono text-[11px] font-bold uppercase leading-none tracking-[0.2em] text-paper/70">
          <span>
            Seen
            <br />
            enough
          </span>
          <span className="overflow-clip">
            <Arrow className="h-3 w-5" />
          </span>
        </p>

        <div className="min-w-0 flex-1 text-center">
          <p className="font-display text-[clamp(1.75rem,3.6vw,2.75rem)] uppercase leading-[0.95] tracking-tight">
            The audit trail is the point
          </p>
          {/* Stretched to the line above it rather than held at the reference's 214 px: the
              claim is longer than the words it sat under there, and a wave is a wave at any
              wavelength. The stroke stays 3 units, so it reads as a ruled line, not a shape. */}
          <svg
            aria-hidden
            viewBox="0 0 601 12"
            preserveAspectRatio="none"
            className="mx-auto mt-1.5 h-3 w-full"
          >
            <path
              data-motion="draw"
              d={SINE_PATH}
              className="stroke-copper"
              fill="none"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <Link
          href={entry.primary.href}
          aria-label={entry.primary.label}
          className="grid size-16 shrink-0 place-items-center bg-copper text-ink transition-colors hover:bg-paper"
        >
          <Arrow className="h-4 w-6" />
        </Link>
      </div>

      {/* ------------------------------------------------------------- the slab */}
      <div className="pb-8 pt-2 lg:pb-10">
        <div
          data-motion="rows"
          className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-x-8 gap-y-8 px-5 sm:px-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,1fr)]"
        >
          <div className="col-span-2 lg:col-span-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper/60">
              Verifiable e-waste take-back
            </p>
            <h2 className="mt-3 font-display text-xl uppercase leading-tight tracking-tight">
              {SIMULATED_LABEL}
            </h2>
            <p className="mt-4 max-w-md text-[13px] leading-relaxed text-paper/60">
              EcoEPR is a traceability prototype; it does not process waste or independently
              verify recycler registration. It uses a real multimodal model and a real Cognito
              pool when configured, while the working screens can combine fixture data with
              records written by the pipeline. Sample and simulated values are labelled on their
              panels.
            </p>
          </div>

          <nav aria-label="Product" className="flex flex-col gap-2 text-[13px]">
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-paper/60">
              Product
            </p>
            {productLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-paper/80 underline decoration-paper/25 underline-offset-4 hover:text-paper hover:decoration-copper"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <nav aria-label="This page" className="flex flex-col gap-2 text-[13px]">
            <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.18em] text-paper/60">
              This page
            </p>
            {landingSections.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-paper/80 underline decoration-paper/25 underline-offset-4 hover:text-paper hover:decoration-copper"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex flex-col items-start gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper/60">
              Status
            </p>
            <Badge tone="review">{SIMULATED_LABEL}</Badge>
            <p className="font-mono text-[10px] uppercase leading-relaxed tracking-[0.14em] text-paper/60">
              Rates: a labelled sample card
              <br />
              Route: proposed recycler route
            </p>
          </div>
        </div>

        <div
          data-motion="rows"
          className="mx-auto mt-16 flex w-full max-w-6xl flex-col gap-2 border-t border-paper/20 px-5 pt-6 sm:px-8 lg:flex-row lg:items-center lg:justify-between"
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper/60">
            © 2026 EcoEPR · EPR traceability prototype
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-paper/60">
            Simulated before any real payout
          </p>
        </div>
      </div>
    </footer>
  );
}
