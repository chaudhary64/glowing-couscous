import Link from "next/link";
import { cn } from "@/lib/cn";
import type { DocHref, ProductHref } from "@/lib/types";

/**
 * Square, mono, uppercase. Actions invert on hover and never round a corner —
 * the same rule the rest of the interface follows.
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<ButtonVariant, string> = {
  primary: "border-2 border-ink bg-ink text-paper hover:bg-paper hover:text-ink",
  secondary:
    "border-2 border-ink bg-paper-raised text-ink hover:bg-ink hover:text-paper",
  ghost:
    "border-0 bg-transparent px-0 text-ink underline decoration-rule underline-offset-2 hover:decoration-copper",
  danger: "border-2 border-hazard bg-hazard text-paper hover:bg-paper hover:text-hazard",
};

const base =
  "inline-flex items-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] transition-colors disabled:cursor-not-allowed disabled:border-rule disabled:bg-paper disabled:text-ink-muted";

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
      className={cn(base, variants[variant], bare ? "px-0 py-0" : "px-4 py-2", className)}
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
  href: ProductHref | DocHref;
  children: React.ReactNode;
  variant?: ButtonVariant;
  className?: string;
  title?: string;
}) {
  return (
    <Link
      href={href}
      title={title}
      className={cn(base, variants[variant], variant === "ghost" ? "" : "px-4 py-2", className)}
    >
      {children}
    </Link>
  );
}
