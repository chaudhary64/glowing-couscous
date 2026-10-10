import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { Feature } from "@/lib/types";

/**
 * Page header. The rank chip is the honest bit: it tells the reader where this
 * capability sits in the priority list, including when it sits last.
 */
export function PageHeader({
  feature,
  lede,
  meta,
}: {
  feature: Feature;
  /** Overrides the registry tagline when a screen needs a sharper line. */
  lede?: string;
  meta?: React.ReactNode;
}) {
  return (
    <header className="rule-light border-b-2 border-ink pb-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-copper">
          Feature {String(feature.rank).padStart(2, "0")}
        </span>
        <span aria-hidden className="hidden h-3 w-px bg-rule sm:block" />
        <Badge tone={feature.status === "deferred" ? "lead" : "copper"}>
          {feature.status === "deferred"
            ? "Deferred · not in this build"
            : feature.status === "supporting"
              ? "Supporting"
              : "Core loop"}
        </Badge>
      </div>

      <h1 data-motion="scan" className="mt-3 font-display text-4xl uppercase leading-[0.95] tracking-tight sm:text-5xl">
        {feature.name}
      </h1>

      <p className="mt-3 max-w-2xl text-base leading-relaxed text-ink-soft">
        {lede ?? feature.tagline}
      </p>

      <div className="mt-5 grid gap-4 border-t border-rule pt-4 sm:grid-cols-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            What this screen does
          </p>
          <p className="mt-1 text-sm leading-relaxed">{feature.pageJob}</p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            Why this rank
          </p>
          <p className="mt-1 text-sm leading-relaxed">{feature.proof}</p>
        </div>
      </div>

      {meta ? <div className="mt-4">{meta}</div> : null}
    </header>
  );
}

/**
 * Header for a working screen. Same rules and type as the write-ups, but no rank
 * chip and no justification — an operator opening the validation queue does not
 * need to be told why the queue exists.
 */
export function ScreenHeader({
  eyebrow,
  title,
  lede,
  actions,
  meta,
  className,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("rule-light border-b-2 border-ink pb-5", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 max-w-3xl">
          {eyebrow ? (
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-copper">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="mt-2 font-display text-3xl uppercase leading-[0.95] tracking-tight sm:text-4xl">
            {title}
          </h1>
          {lede ? (
            <p className="mt-3 text-base leading-relaxed text-ink-soft">{lede}</p>
          ) : null}
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>

      {meta ? <div className="mt-4 border-t border-rule pt-3">{meta}</div> : null}
    </header>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  note,
  className,
}: {
  eyebrow?: string;
  title: string;
  note?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1", className)}>
      <div>
        {eyebrow ? (
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            {eyebrow}
          </p>
        ) : null}
        <h2 data-motion="scan" className="font-display text-xl uppercase leading-tight tracking-tight">
          {title}
        </h2>
      </div>
      {note ? (
        <p className="max-w-md text-[12px] leading-relaxed text-ink-muted">{note}</p>
      ) : null}
    </div>
  );
}

/** Small labelled block used for stack and source notes. */
export function MetaRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
        {label}
      </span>
      <span className="flex flex-wrap gap-1.5">{children}</span>
    </div>
  );
}
