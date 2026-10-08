import Link from "next/link";
import { ProductNav } from "@/components/layout/product-nav";
import { intakeStats } from "@/lib/data/intake";
import { logisticsStats } from "@/lib/data/operations";

/**
 * Shell for the working app. Same ink rail and square rules as the docs, but the
 * strip across the top reports the pilot's state rather than the stack, and the
 * rail is grouped by job instead of by rank.
 */
export function ProductShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <ProductNav />

      <div className="flex min-w-0 flex-col">
        <div className="sticky top-0 z-10 border-b border-rule bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/80">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5 sm:px-8">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
              Mumbai + Pune pilot
            </span>
            <span className="hidden h-3 w-px bg-rule sm:block" />
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
              {intakeStats.today} intakes today · {logisticsStats.notesIssued} credit notes
            </span>
            <span className="ml-auto inline-flex items-center gap-2 border border-review/40 bg-review-tint px-2 py-0.5">
              <span aria-hidden className="size-1.5 bg-review" />
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-review">
                Simulated data
              </span>
            </span>
          </div>
        </div>

        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8 lg:py-10">
          {children}
        </main>

        <footer className="border-t border-rule">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-6 sm:px-8">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
              EcoEPR · prototype
            </p>
            <p className="max-w-3xl text-[12px] leading-relaxed text-ink-muted">
              Every figure on these screens is a fixture, not a live reading.
              Credits are simulated, this is not a payout system, and we route to
              CPCB-registered recyclers rather than processing waste ourselves.{" "}
              <Link
                href="/doc"
                className="underline decoration-rule underline-offset-2 hover:decoration-copper"
              >
                Read how each capability was built
              </Link>
              .
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
