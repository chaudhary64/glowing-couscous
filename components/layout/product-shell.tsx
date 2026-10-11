import Link from "next/link";
import { connection } from "next/server";

import { ProductNav } from "@/components/layout/product-nav";
import { getCurrentUser } from "@/lib/auth/dal";
import { roleLabel } from "@/lib/auth/roles";
import { storedCounts } from "@/lib/records/queues";

/**
 * Shell for the working app. Same ink rail and square rules as the docs, but the
 * strip across the top reports the pilot's state rather than the stack, and the rail
 * is grouped by job instead of by rank.
 *
 * The session is read here for one reason: the rail has to know the role to decide
 * which links exist, and it has to name the person holding it so signing out is
 * obvious. That read is request data, which is why `app/(product)/layout.tsx` opts the
 * segment out of instant navigation — the docs' advice to push a session read behind a
 * `<Suspense>` boundary applies to pages that are otherwise static, and every route in
 * here already blocks on `requireAccess`, so a boundary would buy nothing but a flash
 * of the wrong rail.
 */
export async function ProductShell({ children }: { children: React.ReactNode }) {
  /*
    Prerendering stops here, deliberately.

    Verifying the id token reads the clock — jose checks `exp`, which is `Date.now()` —
    and nothing about that value may end up in a static shell. `cookies()` alone did not
    settle it: the framework still ran the verify during its prerender pass and reported
    `blocking-prerender-current-time` on every authenticated route in the app. `instant
    = false` on the segment is the same statement made in configuration; this is the half
    that tells the renderer where to stop. `await connection()` is the documented remedy
    and costs nothing here, because this shell can never be prerendered: it exists to
    name the person holding the session.
  */
  await connection();
  const [user, stored] = await Promise.all([getCurrentUser(), storedCounts()]);
  // The same counts the dashboard shows, so the strip and the rail can never disagree
  // with the page under them. Without a database they are simply left out.
  const counts = stored.counts;

  return (
    <div className="flex min-h-full flex-col lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <ProductNav
        viewer={{
          name: user?.name ?? user?.email ?? "Unknown account",
          email: user?.email ?? null,
          role: user?.role ?? null,
        }}
        awaitingDecision={counts?.awaitingDecision ?? null}
      />

      <div className="flex min-w-0 flex-col">
        <div className="sticky top-0 z-10 border-b border-rule bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/80">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5 sm:px-8">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
              Mumbai + Pune pilot
            </span>
            {counts ? (
              <>
                <span className="hidden h-3 w-px bg-rule sm:block" />
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
                  {counts.intakesToday} intakes today · {counts.awaitingDecision} awaiting a
                  decision
                </span>
              </>
            ) : null}

            <span className="ml-auto inline-flex items-center gap-2 border border-review/40 bg-review-tint px-2 py-0.5">
              <span aria-hidden className="size-1.5 bg-review" />
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-review">
                Simulated data
              </span>
            </span>

            {/*
              The rail's sign-out is desktop-only, and the rail itself is the only place
              the role is named. On a phone the strip carries both, so nobody is stuck
              signed in on a session they cannot end.
            */}
            <span className="flex items-center gap-3 lg:hidden">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
                {roleLabel(user?.role ?? null)}
              </span>
              <form method="post" action="/api/auth/sign-out">
                <button
                  type="submit"
                  className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink underline decoration-rule underline-offset-2 hover:decoration-copper"
                >
                  Sign out
                </button>
              </form>
            </span>
          </div>
        </div>

        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8 lg:py-10">
          {children}
        </main>

        <footer className="border-t border-rule">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-6 sm:px-8">
            <p className="max-w-3xl text-[12px] leading-relaxed text-ink-muted">
              Figures marked as counted are queries over the pilot&apos;s database; the
              rest are sample data and say so. Credits are simulated, this is not a payout
              system, and we route to CPCB-registered recyclers rather than processing
              waste ourselves.{" "}
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
