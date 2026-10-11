import {
  AuthField,
  AuthFrame,
  AuthHero,
  AuthNotice,
  AuthSubmit,
  AuthSwitch,
} from "@/components/auth/auth-form";
import { Button } from "@/components/ui/button";
import { ERRORS, errorNotice, infoNotice } from "@/lib/auth/copy";
import { pendingEmail } from "@/lib/auth/session";

/**
 * Enter the emailed code.
 *
 * The address is read from the httpOnly cookie that sign-up (or a failed sign-in on an
 * unconfirmed account) wrote, and shown back so the reader can see where the code went.
 * It is never taken from the form: the confirm and resend endpoints both act on that
 * address, and a posted one would turn either into a way to confirm — or to spam — an
 * address of the caller's choosing.
 *
 * The cookie lasts fifteen minutes. When it is gone the page says so plainly rather
 * than rendering a form that cannot work, which is the failure a user will actually
 * hit if they leave the tab open overnight.
 *
 * Same frame as sign in and sign up, because it is the third screen of one flow: hero,
 * the framed block, then the ways out. The code is the record here, so the block is
 * titled for it and the address it was sent to is on the note line.
 */

type Search = Record<string, string | string[] | undefined>;

export const instant = false;

const pick = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function ConfirmPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const [params, email] = await Promise.all([searchParams, pendingEmail()]);

  const notice =
    errorNotice(pick(params.error)) ?? infoNotice(pick(params.notice));

  if (!email) {
    return (
      <div className="flex flex-col gap-9">
        <AuthHero
          eyebrow="Account · confirm"
          title="Confirm the account"
          lede="A six-digit code is needed to finish creating an account."
        />

        <AuthNotice notice={ERRORS.expired} />

        <div className="flex flex-col items-center gap-4 border-t border-rule pt-6">
          <AuthSwitch
            prompt="Start again with this address?"
            href="/signup"
            label="Create the account"
          />
          <AuthSwitch
            prompt="Already confirmed?"
            href="/login"
            label="Sign in"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-9">
      <AuthHero
        eyebrow="Account · confirm"
        title="Confirm the account"
        lede={`Cognito sent a six-digit code to ${email}. Entering it proves the address is yours.`}
      />

      {notice ? <AuthNotice notice={notice} /> : null}

      <form method="post" action="/api/auth/confirm">
        <AuthFrame
          title="Six-digit code"
          note={`Sent to ${email}`}
          action={<AuthSubmit>Confirm</AuthSubmit>}
        >
          <AuthField
            label="Confirmation code"
            name="code"
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="000000"
            hint="Six digits, no spaces. Codes are short-lived."
          />
        </AuthFrame>
      </form>

      {/*
        Resending is its own POST rather than a second button on the form above: the two
        actions have different failure modes, and a code that has already expired needs
        the resend *without* a code to submit.
      */}
      <form
        method="post"
        action="/api/auth/resend"
        className="flex flex-col items-start gap-3 border-t border-rule pt-5"
      >
        <p className="max-w-xl text-[13px] leading-relaxed text-ink-muted">
          Nothing in the inbox? Codes expire, and the first email is often late. Sending
          another one replaces the old code.
        </p>
        <Button type="submit" variant="secondary">
          Send a new code
        </Button>
      </form>

      <div className="flex flex-col items-center">
        <AuthSwitch prompt="Wrong address?" href="/signup" label="Start over" />
      </div>
    </div>
  );
}
