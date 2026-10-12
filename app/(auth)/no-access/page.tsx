import { connection } from "next/server";

import { AuthNotice } from "@/components/auth/auth-form";
import { Button } from "@/components/ui/button";
import { ScreenHeader } from "@/components/ui/page-header";
import { Stamp } from "@/components/ui/stamp";
import { getCurrentUser } from "@/lib/auth/dal";
import { GUARDS, ROLES, canOpen, roleLabel, type Role } from "@/lib/auth/roles";
import { cn } from "@/lib/cn";

/**
 * The refusal screen.
 *
 * Where an unauthorised request ends up. It exists instead of a bare "404 not found"
 * because a 404 here is a lie: the page is there, the answer is no, and a collector
 * who was told to clear the validation queue deserves to be told that the queue needs
 * an admin rather than that it does not exist.
 *
 * Both the proxy and `requireAccess` redirect here with the same three query values —
 * which page, which requirement, why — so the wording is derived from what the guard
 * actually decided and cannot drift from it.
 *
 * **Five roles, and a set of screens each — not a ladder.** This page used to print the
 * roles as a numbered ladder (`01`–`06` in the gutter), which said something the matrix
 * does not: that a role above another holds everything below it. It does not — a
 * Collector reads the map and an Operator writes the board. So the figure beside each
 * role is now the number of screens that role opens, counted by asking `canOpen` over
 * the same `GUARDS` table the proxy and the data access layer read, and the role that
 * would have opened the screen you asked for is marked. That is the question somebody
 * refused here actually has: not "how far up am I", but "which role do I need".
 *
 * Reachable by any signed-in user, role or not. It reads the session to name the caller
 * in the list, which is request data — hence `instant = false`, and hence the
 * `connection()` below. This screen does not go through `requireAccess` (it is where
 * that function sends people), so it has to stop prerendering itself: without it the
 * token verification reports `blocking-prerender-current-time`.
 */

type Search = Record<string, string | string[] | undefined>;

export const instant = false;

const pick = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** Every path the matrix gates: the denominator of "opens 3 of 16 screens". */
const GATED_PATHS: readonly string[] = GUARDS.flatMap((guard) => guard.paths);

/** Display order only. `rank` authorises nothing; it decides what is printed first. */
const byDisplayOrder = (Object.entries(ROLES) as [Role, (typeof ROLES)[Role]][]).sort(
  (a, b) => a[1].rank - b[1].rank,
);

/** The screens a role opens, asked of the matrix rather than restated here. */
const screensOpened = (role: Role): number =>
  GATED_PATHS.filter((path) => canOpen(path, role).ok).length;

/**
 * A path from the query string, only when it is one this app serves.
 *
 * `from` is a URL parameter, so it is attacker-controlled text; it is rendered as the
 * href of a link on this page. Anything that is not a site-absolute path (`/x`, never
 * `//host/x` or `javascript:…`) is dropped rather than linked to — the same rule
 * `requireUser` applies to the `next` it remembers.
 */
const retryPath = (from: string | undefined): string | null =>
  from && from.startsWith("/") && !from.startsWith("//") ? from : null;

export default async function NoAccessPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await connection();
  const [params, user] = await Promise.all([searchParams, getCurrentUser()]);

  const from = pick(params.from);
  const need = pick(params.need);
  const why = pick(params.why);
  const hasNoRole = why === "no-role";
  const retry = retryPath(from);

  return (
    <div className="flex flex-col gap-7">
      <div className="flex items-start justify-between gap-4">
        <ScreenHeader
          eyebrow="Access refused"
          title="This screen is not yours"
          lede={
            from
              ? `You asked for ${from}.`
              : "You asked for a screen this account cannot open."
          }
          className="flex-1"
        />
        <Stamp label="Refused" tone="hazard" angle={-7} className="mt-1 shrink-0" />
      </div>

      <AuthNotice
        notice={{
          tone: "error",
          title: hasNoRole
            ? "This account has no role yet"
            : `This screen is for ${need ?? "a role"}`,
          detail: hasNoRole
            ? "The account exists and the password is correct, but no role was granted after sign-up. An admin adds one on the Team screen or in the Cognito console; until then the app has nothing to open."
            : "Each role opens a fixed set of screens and no others. If the request is legitimate, ask an admin to grant the role that opens this one.",
        }}
      />

      {/*
        Every role is on the page, not just the gap. Someone refused at the validation
        queue can see that the Operator role is *not* the fix — it opens neither
        valuation nor validation — which is the question they would otherwise have to
        put to a person. The count is the matrix's own answer, and the marker beside a
        role says whether it is the one they need.
      */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            The five roles, and the screens each opens
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            {GATED_PATHS.length} screens in the matrix
          </p>
        </div>
        <ol className="mt-3 border-[3px] border-ink">
          {byDisplayOrder.map(([role, spec]) => {
            const mine = user?.role === role;
            const opens = screensOpened(role);
            const wouldOpenThis = from ? canOpen(from, role).ok : false;
            return (
              <li
                key={role}
                className={cn(
                  "flex items-baseline gap-4 border-b border-rule-soft px-4 py-3 last:border-b-0",
                  mine && "bg-ink text-paper",
                )}
              >
                {/* Screens this role opens, out of the matrix's total: the column's
                    header says what the figure counts. */}
                <span
                  className={cn(
                    "w-14 shrink-0 font-mono text-[11px] tabular-nums",
                    mine ? "text-copper" : "text-ink-muted",
                  )}
                >
                  {String(opens).padStart(2, "0")}/{GATED_PATHS.length}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span
                      className={cn(
                        "font-display text-[13px] uppercase tracking-[0.1em]",
                        mine ? "text-paper" : "text-ink",
                      )}
                    >
                      {spec.label}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[10px] uppercase tracking-[0.14em]",
                        mine ? "text-copper" : "text-ink-muted",
                      )}
                    >
                      {role}
                    </span>
                    {wouldOpenThis ? (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-copper">
                        ← opens this screen
                      </span>
                    ) : null}
                    {mine ? (
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-copper">
                        ← you
                      </span>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "mt-1 block text-[12px] leading-snug",
                      mine ? "text-paper/70" : "text-ink-muted",
                    )}
                  >
                    {spec.summary}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        <p className="mt-3 text-[12px] leading-relaxed text-ink-muted">
          A screen may be listed by more than one role. Authority is a set, so holding two
          groups gives you what each of them opens — never less, and never everything.
        </p>
      </section>

      <div className="flex flex-col gap-3 border-t border-rule pt-5">
        <p className="text-[13px] leading-relaxed text-ink-muted">
          Signed in as {user?.name ?? user?.email ?? "an unknown account"}
          {user ? ` · ${roleLabel(user.role)}` : ""}. Every screen re-checks the role
          itself, so widening it takes effect on the next request — there is nothing to
          clear on this side.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <form method="post" action="/api/auth/sign-out">
            <Button type="submit" variant="secondary">
              Sign out
            </Button>
          </form>
          {retry ? (
            <a
              href={retry}
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink underline decoration-rule underline-offset-2 hover:decoration-copper"
            >
              Try {retry} again
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
