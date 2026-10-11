import { ViewTransition } from "react";

import { LandingShell } from "@/components/layout/landing-shell";
import "./landing.css";

/**
 * The landing page is its own group because it is the only route with public chrome: no
 * product rail, no doc rail. It defines `/`, and the dashboard moved to `/dashboard` so
 * the two no longer compete for the root.
 *
 * It did use to be the one route with no session read, because the page is static and
 * its CTAs were assumed correct for everyone. They were not: a signed-out visitor was
 * offered "Open the app", which only sent them to the sign-in form. The shell now reads
 * the session to decide the ways in, so this segment blocks on the server like `(auth)`
 * and `(product)` do — the same trade those two already make for chrome that has to name
 * a session.
 */
export const instant = false;
// Crossing into this section swaps the whole layout, and React only animates a
// <ViewTransition> that is the outermost thing added or removed, so the shell itself
// carries the tear. Moves within the section are the template's.
export default function LandingLayout({ children }: LayoutProps<"/">) {
  return (
    <ViewTransition enter="print" exit="tear" default="none">
      <LandingShell>{children}</LandingShell>
    </ViewTransition>
  );
}
