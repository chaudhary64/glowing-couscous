import Link from "next/link";
import type { ReactNode } from "react";

import { canOpen, type Role } from "@/lib/auth/roles";

/** Whether `role` may open the screen behind `href` (query and hash ignored). */
export function mayOpen(role: Role | null, href: string): boolean {
  return canOpen(href.split(/[?#]/)[0], role).ok;
}

/**
 * A link only where the role may follow it.
 *
 * The rail already drops the screens a role cannot open, but a link inside a page that
 * points at one of them ends on /no-access, which reads as a broken app. Here the same
 * words are kept as plain text instead — or dropped, with `hide`, when they are only a
 * call to action — using the same `canOpen` the proxy and the rail call, so the three
 * cannot disagree. Holds no state, so server and client components can both render it.
 */
export function RoleLink({
  role,
  href,
  className,
  plainClassName,
  hide = false,
  children,
}: {
  role: Role | null;
  href: string;
  className?: string;
  /** Classes for the plain-text form; defaults to none. */
  plainClassName?: string;
  /** Render nothing when the role cannot follow the link. */
  hide?: boolean;
  children: ReactNode;
}) {
  if (mayOpen(role, href)) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  if (hide) return null;
  return <span className={plainClassName}>{children}</span>;
}
