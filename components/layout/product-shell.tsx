import { connection } from "next/server";

import { NavFrame } from "@/components/layout/nav-frame";
import { ProductNav } from "@/components/layout/product-nav";
import { getCurrentUser } from "@/lib/auth/dal";
import { scopeForUser } from "@/lib/records/scope";
import { canOpen, roleLabel } from "@/lib/auth/roles";
import { listLoads } from "@/lib/pickup/directory";
import { listPendingHolds } from "@/lib/records/queues";
import type { ProductHref } from "@/lib/types";

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
  const user = await getCurrentUser();

  /*
    The rail's badges, read rather than imported — and only for the roles that can act
    on them.

    A badge is a claim that work is waiting, so it has to be counted from the rows that
    hold that work: the undecided holds from Postgres, and the loads the smart-pickup
    service has not settled. Both reads fail soft — a service that is off or a database
    that is down produces no badge rather than a zero, because "nothing is waiting" and
    "nobody can tell" are different claims and the rail should not make the first when it
    means the second. Neither read throws, so a broken badge cannot take down the shell
    that every product page renders through.

    A count is taken only for a role that can open the screen it belongs to: /validation
    is the admin's screen now and /pickups the operator's, and the rail already removes
    the link from anyone else. Asking `canOpen` — the same membership test the rail, the
    proxy and the data access layer use — is what keeps this to the roles that can spend
    the number, rather than a second list of roles written here that could drift from the
    matrix. It is not only tidiness: without it every viewer's page load queried Postgres
    and the pickup service for a figure it had nowhere to show.
  */
  const role = user?.role ?? null;
  const mayCountHolds = canOpen("/validation", role).ok;
  const mayCountLoads = canOpen("/pickups", role).ok;
  const scope = user && (mayCountHolds || mayCountLoads) ? await scopeForUser(user) : null;
  const [holds, loads] = await Promise.all([
    scope && mayCountHolds ? listPendingHolds(scope, 100) : null,
    scope && mayCountLoads ? listLoads(scope, 100) : null,
  ]);
  const counts: Partial<Record<ProductHref, number>> = {};
  if (holds?.configured && holds.rows.length > 0) {
    counts["/validation"] = holds.rows.length;
  }
  if (loads?.configured) {
    const open = loads.rows.filter((load) => load.status !== "settled").length;
    if (open > 0) counts["/pickups"] = open;
  }

  return (
    // The grid and the rail's folded state live in `NavFrame`, a client component, so the
    // menu button can widen the page without this shell knowing about it.
    <NavFrame
      nav={
        <ProductNav
          counts={counts}
          viewer={{
            name: user?.name ?? user?.email ?? "Unknown account",
            email: user?.email ?? null,
            role: user?.role ?? null,
          }}
        />
      }
    >

      <div className="flex min-w-0 flex-col">
        <div className="sticky top-0 z-10 border-b-[3px] border-ink bg-paper lg:hidden">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5 sm:px-8">
            {/*
              The strip exists for the phone, and only for the phone: the rail that names
              the role and carries the sign-out is desktop-only, so on a small screen this
              is the one place a session can be seen and ended. Once the rail appears there
              is nothing here to say, which is why the bar is hidden from `lg` up rather
              than left standing empty with a rule under it.

              It used to carry the pilot's scope and a "simulated data" badge. Both are
              gone. A disclaimer pinned to every screen stops being read after a week, and
              the claim it was making is already made where it can be checked: each panel
              says whether its figure is counted or authored.
            */}
            <span className="flex items-center gap-3 lg:hidden">
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-ink-muted">
                {roleLabel(user?.role ?? null)}
              </span>
              <form method="post" action="/api/auth/sign-out">
                <button
                  type="submit"
                  className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-ink underline decoration-ink underline-offset-2 hover:decoration-copper"
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
      </div>
    </NavFrame>
  );
}
