import { ViewTransition } from "react";

import { AuthShell } from "@/components/layout/auth-shell";

/**
 * Everything in `(auth)` — sign in, sign up, confirmation, refusal — shares one frame.
 * The group adds no URL segment, so these are `/login`, `/signup`, `/confirm` and
 * `/no-access` and not `/auth/login`.
 *
 * These four screens used to import the landing's stylesheet to borrow its bone ground.
 * They no longer do: every surface in the app now wears the same RawBlock ground, so
 * there is nothing left to re-point, and the auth screens are simply the app's chrome
 * with the session read taken out.
 */
export const instant = false;

// Crossing into this section swaps the whole layout, and React only animates a
// <ViewTransition> that is the outermost thing added or removed, so the shell itself
// carries the tear. Moves within the section are the template's.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="print" exit="tear" default="none">
      <AuthShell>{children}</AuthShell>
    </ViewTransition>
  );
}
