import { cn } from "@/lib/cn";

/**
 * A ruled box. No radius, no shadow — separation comes from border weight, which
 * is how a weighbridge form separates its fields.
 */
export function Surface({
  children,
  className,
  tone = "plain",
}: {
  children: React.ReactNode;
  className?: string;
  /** `plain` = raised paper, `inset` = sunken, `ink` = inverted block. */
  tone?: "plain" | "inset" | "ink";
}) {
  return (
    <div
      className={cn(
        "border",
        tone === "plain" && "border-rule bg-paper-raised",
        tone === "inset" && "border-rule-soft bg-paper",
        tone === "ink" && "border-ink bg-ink text-paper",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * Surface plus a header band. Using one panel shape everywhere is what keeps the
 * six screens reading as one product.
 */
export function Panel({
  eyebrow,
  title,
  actions,
  children,
  className,
  bodyClassName,
  tone = "plain",
}: {
  eyebrow?: string;
  title?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  tone?: "plain" | "inset" | "ink";
}) {
  const hasHeader = Boolean(eyebrow || title || actions);

  return (
    <Surface tone={tone} className={cn("flex flex-col", className)}>
      {hasHeader ? (
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b-2 px-4 py-3",
            tone === "ink" ? "border-paper/30" : "border-ink",
          )}
        >
          <div className="min-w-0">
            {eyebrow ? (
              <p
                className={cn(
                  "font-mono text-[10px] uppercase tracking-[0.18em]",
                  tone === "ink" ? "text-paper/60" : "text-ink-muted",
                )}
              >
                {eyebrow}
              </p>
            ) : null}
            {title ? (
              <h2
                className={cn(
                  "font-display text-base uppercase leading-tight tracking-tight",
                  tone === "ink" ? "text-paper" : "text-ink",
                )}
              >
                {title}
              </h2>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      ) : null}

      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </Surface>
  );
}
