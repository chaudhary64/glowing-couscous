import { ViewTransition } from "react";

import { ProductShell } from "@/components/layout/product-shell";

/**
 * The shell reads the session to decide which links the rail shows, so the segment is
 * allowed to block on the server. Every page inside it guards itself with
 * `requireAccess` as well — this layout is chrome, not the authorization boundary.
 */
export const instant = false;

// Crossing into this section swaps the whole layout, and React only animates a
// <ViewTransition> that is the outermost thing added or removed, so the shell itself
// carries the tear. Moves within the section are the template's.
export default function ProductLayout({ children }: LayoutProps<"/">) {
  return (
    <ViewTransition enter="print" exit="tear" default="none">
      <ProductShell>{children}</ProductShell>
    </ViewTransition>
  );
}
