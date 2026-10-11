import { cn } from "@/lib/cn";

export interface ReceiptLine {
  label: string;
  /** Secondary mono detail, e.g. mass at rate. */
  detail?: string;
  value: string;
  /** Dim a line that carries no money, like hazardous material. */
  muted?: boolean;
}

export interface ReceiptAdjustment {
  label: string;
  value: string;
}

/**
 * The signature component: a scrap receipt. Dotted leaders, mono figures, a
 * perforated top edge and an optional stamp struck across the corner. It is the
 * one place the design raises its voice, because a receipt is what a kabadiwala
 * and a compliance officer both actually hold.
 */
export function Receipt({
  title,
  reference,
  issuedAt,
  lines,
  adjustments,
  total,
  note,
  stamp,
  className,
}: {
  title: string;
  reference: string;
  issuedAt: string;
  lines: ReceiptLine[];
  adjustments?: ReceiptAdjustment[];
  total: { label: string; value: string; sub?: string };
  note?: string;
  stamp?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative border-[3px] border-ink bg-paper-raised font-mono text-[13px]",
        className,
      )}
    >
      <div aria-hidden className="h-0 border-t-[3px] border-dashed border-ink" />

      <div className="px-4 pt-4 pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-display text-lg uppercase leading-none tracking-tight">
              {title}
            </p>
            <p className="mt-1.5 text-[11px] uppercase tracking-[0.14em] text-ink-muted">
              Ref {reference}
            </p>
          </div>
          <p className="text-right text-[11px] uppercase tracking-[0.14em] text-ink-muted">
            {issuedAt}
          </p>
        </div>
      </div>

      <div aria-hidden className="mx-4 border-t border-ink" />

      <dl className="px-4 py-3">
        {lines.map((line) => (
          // On a phone the detail drops under the label, so a long line cannot push the
          // value off the paper; from `sm` up it is the one-line ledger row.
          <div key={line.label} className="flex flex-wrap items-baseline gap-x-2 py-1 sm:flex-nowrap">
            <dt className={cn("min-w-0", line.muted && "text-ink-muted")}>
              {line.label}
            </dt>
            {/* The leader, the detail and the value all belong to the term's description:
                a `<dl>` row may hold only its `<dt>` and `<dd>`. */}
            <dd className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 sm:flex-nowrap">
              <span
                aria-hidden
                className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-rule"
              />
              {line.detail ? (
                <span className="order-last w-full text-[11px] text-ink-muted sm:order-none sm:w-auto sm:shrink-0">
                  {line.detail}
                </span>
              ) : null}
              <span
                className={cn(
                  "shrink-0 font-medium tabular-nums",
                  line.muted && "text-ink-muted",
                )}
              >
                {line.value}
              </span>
            </dd>
          </div>
        ))}
      </dl>

      {adjustments?.length ? (
        <>
          <div aria-hidden className="mx-4 border-t border-rule" />
          <dl className="px-4 py-3">
            {adjustments.map((line) => (
              <div key={line.label} className="flex items-baseline gap-2 py-1">
                <dt className="shrink-0 text-ink-muted">{line.label}</dt>
                <dd className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span
                    aria-hidden
                    className="min-w-4 flex-1 translate-y-[-3px] border-b border-dotted border-rule"
                  />
                  <span className="shrink-0 tabular-nums text-ink-soft">{line.value}</span>
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}

      <div aria-hidden className="mx-4 border-t-[3px] border-ink" />

      <div className="flex flex-wrap items-end justify-between gap-4 px-4 py-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            {total.label}
          </p>
          <p className="mt-1 font-display text-3xl leading-none tracking-tight text-copper">
            {total.value}
          </p>
          {total.sub ? (
            <p className="mt-1.5 text-[11px] text-ink-muted">{total.sub}</p>
          ) : null}
        </div>
        {stamp ? <div className="shrink-0">{stamp}</div> : null}
      </div>

      {note ? (
        <>
          <div aria-hidden className="mx-4 border-t border-dotted border-rule" />
          <p className="px-4 py-3 text-[11px] leading-relaxed text-ink-muted">{note}</p>
        </>
      ) : null}

      <div aria-hidden className="h-0 border-t-[3px] border-dashed border-ink" />
    </div>
  );
}
