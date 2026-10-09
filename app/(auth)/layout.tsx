import { AuthShell } from "@/components/layout/auth-shell";

/**
 * Everything in `(auth)` — sign in, sign up, confirmation, refusal — shares one frame.
 * The group adds no URL segment, so these are `/login`, `/signup`, `/confirm` and
 * `/no-access` and not `/auth/login`.
 */
export const instant = false;

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
