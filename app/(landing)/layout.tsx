import { ViewTransition } from "react";

import { LandingShell } from "@/components/layout/landing-shell";
import "./landing.css";

/**
 * The landing page is its own group because it is the only route with public
 * chrome: no product rail, no doc rail, no session read. It defines `/`, and the
 * dashboard moved to `/dashboard` so the two no longer compete for the root.
 */
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
