"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

interface NavState {
  /** The desktop rail is folded down to its menu button. Phones keep their own menu state. */
  collapsed: boolean;
  toggle: () => void;
}

const NavContext = createContext<NavState>({ collapsed: false, toggle: () => {} });

/** The rail's folded state, for the rail itself. */
export const useNavState = () => useContext(NavContext);

/**
 * The product layout's two columns, and whether the first one is folded.
 *
 * The state lives here, in the layout, so it survives moving between screens: the
 * product layout stays mounted across navigations. It is deliberately not stored. The
 * cookie notice promises one essential cookie, and a display preference is not worth a
 * second one; a reload opens the rail again.
 */
export function NavFrame({ nav, children }: { nav: ReactNode; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const toggle = useCallback(() => setCollapsed((folded) => !folded), []);
  const value = useMemo(() => ({ collapsed, toggle }), [collapsed, toggle]);

  return (
    <NavContext.Provider value={value}>
      <div
        className={cn(
          "flex min-h-full min-w-0 flex-col lg:grid lg:transition-[grid-template-columns] lg:duration-200 motion-reduce:transition-none",
          collapsed ? "lg:grid-cols-[72px_minmax(0,1fr)]" : "lg:grid-cols-[280px_minmax(0,1fr)]",
        )}
      >
        {nav}
        {children}
      </div>
    </NavContext.Provider>
  );
}
