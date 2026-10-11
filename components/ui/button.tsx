import Link from "next/link";
import { cn } from "@/lib/cn";
import type { AuthHref, ProductHref } from "@/lib/types";

/**
 * Square, mono, uppercase. Actions invert on hover and never round a corner —
 * the same rule the rest of the interface follows.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "inverse";

const variants: Record<ButtonVariant, string> = {
  primary:
    "border-[3px] border-ink bg-ink text-paper hover:bg-paper hover:text-ink active:border-[5px]",
  secondary:
    "border-[3px] border-ink bg-paper text-ink hover:bg-ink hover:text-paper",
  ghost:
    "border-0 bg-transparent px-0 text-ink underline decoration-ink underline-offset-2 hover:text-copper hover:decoration-copper",
  danger: "border-[3px] border-hazard bg-hazard text-paper hover:bg-paper hover:text-hazard-ink",
  // For use on an ink block, where primary's black-on-black would vanish. The hover
  // closes the block rather than opening it: black fill, white text, white edge.
  inverse:
    "border-[3px] border-paper bg-paper text-ink hover:bg-ink hover:text-paper",
};

/*
  Two of the skill's three sizes, chosen by width rather than by importance: **small**
  (16px sides, 11px type) under `sm`, **medium** (24px sides, 12px at 2px tracking) from
  `sm` up. The pair is not decoration — a row of medium buttons is ~40px wider than the
  same row of small ones, and on a 390px screen that was the difference between a header
  that fits and one that scrolled the page sideways.

  Disabled is a grey rule and a sunken fill — never a dropped opacity, because a
  translucent button is a button that looks broken rather than unavailable.
*/
const base =
  "inline-flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-[0.14em] transition-colors sm:text-[12px] sm:tracking-[0.18em] disabled:cursor-not-allowed disabled:border-rule-soft disabled:bg-sunken disabled:text-ink-muted";

export function Button({
  children,
  variant = "primary",
  bare = false,
  className,
  ...rest
}: React.ComponentProps<"button"> & {
  variant?: ButtonVariant;
  /** Drops the chrome so the button can sit inside a table row. */
  bare?: boolean;
}) {
  return (
    <button
      className={cn(base, variants[variant], bare ? "px-0 py-0" : "px-4 py-2 sm:px-6 sm:py-2.5", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  children,
  variant = "primary",
  className,
  title,
}: {
  /** A working screen or the sign-in flow — the two places a CTA can point. */
  href: ProductHref | AuthHref;
  children: React.ReactNode;
  variant?: ButtonVariant;
  className?: string;
  title?: string;
}) {
  return (
    <Link
      href={href}
      title={title}
      // Leans toward the pointer on public pages (components/motion/scanner-cursor).
      data-magnetic
      className={cn(base, variants[variant], variant === "ghost" ? "" : "px-4 py-2 sm:px-6 sm:py-2.5", className)}
    >
      {children}
    </Link>
  );
}
