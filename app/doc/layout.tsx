import { ViewTransition } from "react";

import { DocShell } from "@/components/layout/doc-shell";

// Crossing into this section swaps the whole layout, and React only animates a
// <ViewTransition> that is the outermost thing added or removed, so the shell itself
// carries the tear. Moves within the section are the template's.
export default function DocLayout({ children }: LayoutProps<"/doc">) {
  return (
    <ViewTransition enter="print" exit="tear" default="none">
      <DocShell>{children}</DocShell>
    </ViewTransition>
  );
}
