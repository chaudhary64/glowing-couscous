import { ViewTransition } from "react";

/**
 * Page content tears off and the next page feeds in (see "page transitions" in
 * globals.css). A template, not the layout: templates remount on every navigation,
 * which is what fires enter and exit. The shell around it stays still.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="print" exit="tear" default="none">
      {children}
    </ViewTransition>
  );
}
