import { connection } from "next/server";

import { AuthNotice } from "@/components/auth/auth-form";
import { Button } from "@/components/ui/button";
import { ScreenHeader } from "@/components/ui/page-header";
import { Stamp } from "@/components/ui/stamp";
import { getCurrentUser } from "@/lib/auth/dal";
import { ROLES, roleLabel, type Role } from "@/lib/auth/roles";
import { cn } from "@/lib/cn";

/**
 * The refusal screen.
 *
 * Where an unauthorised request ends up. It exists instead of a bare "404 not found"
 * because a 404 here is a lie: the page is there, the answer is no, and a collector
 * who was told to clear the validation queue deserves to be told that the queue needs
 * an officer rather than that it does not exist.
 *
 * Both the proxy and `requireAccess` redirect here with the same three query values —
 * which page, which requirement, why — so the wording is derived from what the guard
 * actually decided and cannot drift from it.
 *
 * Reachable by any signed-in user, role or not. It reads the session to name the
 * caller's own role in the ladder, which is request data — hence `instant = false`,
 * and hence the `connection()` below. This screen does not go through `requireAccess`
 * (it is where that function sends people), so it has to stop prerendering itself:
 * without it the token verification reports `blocking-prerender-current-time`.
 */

type Search = Record<string, string | string[] | undefined>;

export const instant = false;

const pick = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

const ladder = (Object.entries(ROLES) as [Role, (typeof ROLES)[Role]][]).sort(
  (a, b) => a[1].rank - b[1].rank,
);

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
            : `This screen needs ${need ?? "more authority"}`,
          detail: hasNoRole
            ? "The account exists and the password is correct, but no role was granted after sign-up. An owner or admin adds one in the Cognito console; until then the app has nothing to open."
            : `Your role opens the screens beneath it. Ask an owner or an admin to widen this one if the request is legitimate.`,
        }}
      />

      {/*
        The whole ladder is on the page, not just the gap. Someone refused at the
        validation queue can see that an operator role is *not* the fix — it is one
        rung short — which is the question they would otherwise have to ask a person.
      */}
      <section>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
          The role ladder
        </p>
        <ol className="mt-3 border-2 border-ink">
          {ladder.map(([role, spec]) => {
            const mine = user?.role === role;
            return (
              <li
                key={role}
                className={cn(
                  "flex items-baseline gap-4 border-b border-rule-soft px-4 py-3 last:border-b-0",
                  mine && "bg-ink text-paper",
                )}
              >
                <span
                  className={cn(
                    "w-6 shrink-0 font-mono text-[11px] tabular-nums",
                    mine ? "text-copper" : "text-ink-muted",
                  )}
                >
                  {String(spec.rank).padStart(2, "0")}
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
          {from ? (
            <a
              href={from}
              className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink underline decoration-rule underline-offset-2 hover:decoration-copper"
            >
              Try {from} again
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
