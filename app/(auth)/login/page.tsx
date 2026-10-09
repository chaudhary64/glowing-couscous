import { AuthField, AuthNotice, AuthSubmit, AuthSwitch } from "@/components/auth/auth-form";
import { ScreenHeader } from "@/components/ui/page-header";
import { errorNotice, infoNotice } from "@/lib/auth/copy";

/**
 * Sign in.
 *
 * The page reads `searchParams` to render the failure a route handler just sent it
 * back with, so it is request-shaped rather than a static shell — hence the `instant`
 * opt-out. That is the honest description of a sign-in page: there is nothing to
 * prefetch, and it cannot be rendered before the request is known.
 *
 * Nothing sensitive rides in the URL. The email typed into a failed attempt is not
 * echoed back through a query string — an address in a URL ends up in proxy logs and
 * in the `Referer` of whatever is clicked next, and the cost is one retyped field.
 */

type Search = Record<string, string | string[] | undefined>;

export const instant = false;

const pick = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;
  const notice =
    errorNotice(pick(params.error)) ?? infoNotice(pick(params.notice));
  const next = pick(params.next);

  return (
    <div className="flex flex-col gap-7">
      <ScreenHeader
        eyebrow="EcoEPR · Mumbai + Pune pilot"
        title="Sign in"
        lede="Every screen in the product sits behind a role. Signing in is what tells the app which ones are yours."
      />

      {notice ? <AuthNotice notice={notice} /> : null}

      <form
        method="post"
        action="/api/auth/sign-in"
        className="flex flex-col gap-5 border-2 border-ink bg-paper-raised p-5 sm:p-6"
      >
        {/* Carries the page the visitor was stopped at through the sign-in round trip. */}
        {next ? <input type="hidden" name="next" value={next} /> : null}

        <AuthField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@organisation.in"
        />

        <AuthField
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
        />

        <AuthSubmit>Sign in</AuthSubmit>
      </form>

      <AuthSwitch prompt="No account yet?" href="/signup" label="Create one" />

      <div className="border-t border-rule pt-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
          Who gets in
        </p>
        <p className="mt-2 max-w-md text-[12px] leading-relaxed text-ink-muted">
          Accounts are created here, but a role is not. A new account lands with no
          group, sees nothing but this refusal screen, and is given a role from the
          Cognito console.{" "}
          <a
            href="/doc"
            className="underline decoration-rule underline-offset-2 hover:decoration-copper"
          >
            The access matrix is written up here
          </a>
          .
        </p>
      </div>
    </div>
  );
}
