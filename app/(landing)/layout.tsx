import { LandingShell } from "@/components/layout/landing-shell";

/**
 * The landing page is its own group because it is the only route with public
 * chrome: no product rail, no doc rail, no session read. It defines `/`, and the
 * dashboard moved to `/dashboard` so the two no longer compete for the root.
 */
export default function LandingLayout({ children }: LayoutProps<"/">) {
  return <LandingShell>{children}</LandingShell>;
}
