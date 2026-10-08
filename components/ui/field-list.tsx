import { cn } from "@/lib/cn";

/** Definition-list pairs, the workhorse for item detail and model signals. */

export function FieldList({
  children,
  columns = 2,
  className,
}: {
  children: React.ReactNode;
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-6 gap-y-3",
        columns === 1 && "grid-cols-1",
        columns === 2 && "sm:grid-cols-2",
        columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
    >
      {children}
    </dl>
  );
}

export function Field({
  label,
  value,
  mono = false,
  tone,
  className,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  tone?: "copper" | "verified" | "hazard" | "review" | "muted";
  className?: string;
}) {
  return (
    <div className={cn("border-t border-rule pt-2", className)}>
      <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 text-sm leading-snug",
          mono && "font-mono text-[13px]",
          tone === "copper" && "text-copper",
          tone === "verified" && "text-verified",
          tone === "hazard" && "text-hazard",
          tone === "review" && "text-review",
          tone === "muted" && "text-ink-muted",
        )}
      >
        {value}
      </dd>
    </div>
  );
}
