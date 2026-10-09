import { AuthField, AuthNotice, AuthSubmit, AuthSwitch } from "@/components/auth/auth-form";
import { ScreenHeader } from "@/components/ui/page-header";
import { errorNotice } from "@/lib/auth/copy";

/**
 * Create an account.
 *
 * Three fields and a confirmation, and no name/email/role choices beyond that. Role is
 * not picked here on purpose: letting a sign-up form choose its own authority is how a
 * demo ends up with a public "sign up as owner" button, and this one is wired to a real
 * pool. New accounts land with no group, which means they can sign in and open nothing
 * until somebody with an admin role grants one.
 *
 * Every field carries `required`, so the empty-submit case is caught by the browser and
 * never costs a round trip; the route handler checks the same thing again for clients
 * that are not browsers.
 */

type Search = Record<string, string | string[] | undefined>;

export const instant = false;

const pick = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const params = await searchParams;
  const notice = errorNotice(pick(params.error));

  return (
    <div className="flex flex-col gap-7">
      <ScreenHeader
        eyebrow="EcoEPR · Mumbai + Pune pilot"
        title="Create an account"
        lede="Cognito sends a six-digit code to the address you give. Confirming it creates the account; a role is granted separately."
      />

      {notice ? <AuthNotice notice={notice} /> : null}

      <form
        method="post"
        action="/api/auth/sign-up"
        className="flex flex-col gap-5 border-2 border-ink bg-paper-raised p-5 sm:p-6"
      >
        <AuthField
          label="Full name"
          name="name"
          autoComplete="name"
          placeholder="Asha Kulkarni"
        />

        <AuthField
          label="Work email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@organisation.in"
          hint="This is the sign-in name, and where the confirmation code goes."
        />

        <AuthField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters, with an upper-case letter, a lower-case letter and a number."
        />

        <AuthField
          label="Password, again"
          name="confirm"
          type="password"
          autoComplete="new-password"
        />

        <AuthSubmit>Create account</AuthSubmit>
      </form>

      <AuthSwitch prompt="Already have an account?" href="/login" label="Sign in" />
    </div>
  );
}
