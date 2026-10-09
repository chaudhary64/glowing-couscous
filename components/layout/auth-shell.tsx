import Link from "next/link";

import { ROLES, roleLabel } from "@/lib/auth/roles";
import { getSession } from "@/lib/auth/session";

/**
 * The frame around sign in, sign up, confirmation and the refusal screen.
 *
 * Same ink rail and square rules as the working app, so the first screen a user sees
 * already belongs to the product — but the rail carries different facts here. In the
 * app it reports the pilot's state; before anyone is signed in the only thing worth
 * reporting is who holds what: Cognito holds the password, Postgres holds the role.
 * That is also the shortest honest answer to "why do I have to sign in at all".
 */
export async function AuthShell({ children }: { children: React.ReactNode }) {
  const roleCount = Object.keys(ROLES).length;

  /*
    The strip reports the session rather than assuming there isn't one. Three of the four
    screens in this group are unreachable while signed in — the proxy sees to that — but
    `/no-access` is only reachable while signed in, and it used to sit under a strip
    reading "Not signed in" directly above a line reading "Signed in as…".
  */
  const user = await getSession();
  const status = user ? `Signed in · ${roleLabel(user.role)}` : "Not signed in";

  return (
    // `min-h-dvh`, not `min-h-full`: the confirmation screen is short, and a
    // percentage min-height against an auto-height body collapses, which leaves the ink
    // rail stopping half way down the page with paper below it.
    <div className="flex min-h-dvh flex-col lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="flex flex-col border-ink bg-ink text-paper">
        <div className="border-b border-paper/20 px-5 py-5 lg:px-6 lg:py-6">
          <Link
            href="/"
            className="font-display text-2xl leading-none tracking-tight text-paper"
          >
            ECO<span className="text-copper">EPR</span>
          </Link>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-paper/60">
            Verifiable e-waste take-back
          </p>
        </div>

        <dl className="hidden flex-col gap-5 px-6 py-6 lg:flex">
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper/45">
              Credentials
            </dt>
            <dd className="mt-1.5 text-[12px] leading-relaxed text-paper/70">
              Held by Amazon Cognito. This app never stores a password — it receives a
              signed id token and puts it in an httpOnly cookie.
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper/45">
              Authority
            </dt>
            <dd className="mt-1.5 text-[12px] leading-relaxed text-paper/70">
              Held by Postgres and by Cognito groups — {roleCount} roles, from owner
              down to viewer. Cognito decides who you are; the role decides which
              screens open.
            </dd>
          </div>
          <div>
            <dt className="font-mono text-[10px] uppercase tracking-[0.18em] text-paper/45">
              Session
            </dt>
            <dd className="mt-1.5 text-[12px] leading-relaxed text-paper/70">
              One hour, then it expires on its own. No refresh token is kept in the
              browser, because nothing here refreshes it.
            </dd>
          </div>
        </dl>

        <div className="mt-auto hidden border-t border-paper/20 px-6 py-5 lg:block">
          <Link
            href="/doc"
            className="font-mono text-[10px] uppercase tracking-[0.14em] text-copper underline decoration-copper/40 underline-offset-2 hover:decoration-copper"
          >
            Feature documentation →
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <div className="sticky top-0 z-10 border-b border-rule bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/80">
          <div className="mx-auto flex w-full max-w-xl flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5 sm:px-8">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
              {status}
            </span>
            <span className="ml-auto inline-flex items-center gap-2 border border-review/40 bg-review-tint px-2 py-0.5">
              <span aria-hidden className="size-1.5 bg-review" />
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-review">
                Simulated data
              </span>
            </span>
          </div>
        </div>

        <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-5 py-10 sm:px-8 lg:py-16">
          {children}
        </main>

        <footer className="border-t border-rule">
          <div className="mx-auto w-full max-w-xl px-5 py-6 sm:px-8">
            <p className="text-[12px] leading-relaxed text-ink-muted">
              Runs on a real Cognito pool and a real RDS instance. Every figure inside
              is a fixture.
            </p>
          </div>
        </footer>
      </div>
    </div>
  );
}
