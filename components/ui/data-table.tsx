import { cn } from "@/lib/cn";

/** Tables carry most of this product's data, so their rules live in one place. */

export function Table({
  children,
  className,
  caption,
}: {
  children: React.ReactNode;
  className?: string;
  caption?: string;
}) {
  return (
    // Focusable and labelled, so a keyboard user can scroll a table wider than the screen.
    <div className="w-full overflow-x-auto" tabIndex={0} role="region" aria-label={caption ?? "Table"}>
      <table className={cn("w-full border-collapse text-left", className)}>
        {caption ? (
          <caption className="pb-2 text-left font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
            {caption}
          </caption>
        ) : null}
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="rule-light border-b-2 border-ink">
      {children}
    </thead>
  );
}

export function TBody({ children, ...rest }: React.ComponentProps<"tbody">) {
  return <tbody {...rest}>{children}</tbody>;
}

export function TR({
  children,
  className,
  muted = false,
}: {
  children: React.ReactNode;
  className?: string;
  muted?: boolean;
}) {
  return (
    <tr
      className={cn(
        "border-b border-rule-soft transition-colors hover:bg-copper-tint/60",
        // Muted by colour, not opacity: opacity would also fade the row's badges below
        // WCAG AA, and their colours carry the meaning.
        muted && "text-ink-muted",
        className,
      )}
    >
      {children}
    </tr>
  );
}

export function TH({
  children,
  numeric = false,
  className,
}: {
  children?: React.ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={cn(
        "px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-ink-muted",
        numeric && "text-right",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  numeric = false,
  mono = false,
  className,
}: {
  children?: React.ReactNode;
  numeric?: boolean;
  mono?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "px-3 py-2.5 align-top text-sm text-ink",
        numeric && "text-right tabular-nums",
        mono && "font-mono text-[13px]",
        className,
      )}
    >
      {children}
    </td>
  );
}
