import {
  AuthField,
  AuthFrame,
  AuthHero,
  AuthNotice,
  AuthSubmit,
  AuthSwitch,
} from "@/components/auth/auth-form";
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
 *
 * Composition, per `landing-redesign.prompt.md`: a centred hero, the credential block as
 * the page's one framed object, the way to the other screen, then a hairline ledger note.
 * There is no second column and no rail — the type is the composition here too.
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
    <div className="flex flex-col gap-9">
      <AuthHero
        eyebrow="Account · sign in"
        title="Sign in"
        lede="Every screen in the product sits behind a role. Signing in is what tells the app which ones are yours."
      />

      {notice ? <AuthNotice notice={notice} /> : null}

      <form method="post" action="/api/auth/sign-in">
        {/* Carries the page the visitor was stopped at through the sign-in round trip. */}
        {next ? <input type="hidden" name="next" value={next} /> : null}

        <AuthFrame
          title="Credentials"
          note="Password held by Amazon Cognito"
          action={<AuthSubmit>Sign in</AuthSubmit>}
        >
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
        </AuthFrame>
      </form>

      <div className="flex flex-col items-center gap-8">
        <AuthSwitch prompt="No account yet?" href="/signup" label="Create one" />

        <div className="w-full border-t border-rule pt-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            Who gets in
          </p>
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-ink-muted">
            Accounts are created here, but a role is not. A new account lands with no
            group, sees nothing but the refusal screen, and is given a role from the
            Cognito console.
          </p>
        </div>
      </div>
    </div>
  );
}
