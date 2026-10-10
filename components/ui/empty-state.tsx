/**
 * An empty list that reads as finished, not broken: a small board trace drawn in copper,
 * a title, and the sentence explaining why it is empty. The trace draws itself once
 * (static under reduced motion).
 */
export function EmptyState({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <svg viewBox="0 0 120 64" className="h-16 w-32" fill="none" stroke="var(--color-copper)" strokeWidth="1.6" aria-hidden>
        <path className="empty-trace" d="M4 32h22l8-10h22l8 10h22l8-10h22" />
        <path className="empty-trace" style={{ animationDelay: "160ms" }} d="M34 22V8M86 22V8M60 32v24" />
        <rect className="empty-chip" x="48" y="40" width="24" height="16" />
        <circle cx="34" cy="8" r="2.5" fill="var(--color-copper)" />
        <circle cx="86" cy="8" r="2.5" fill="var(--color-copper)" />
        <circle cx="4" cy="32" r="2.5" fill="var(--color-copper)" />
        <circle cx="116" cy="22" r="2.5" fill="var(--color-copper)" />
      </svg>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-copper">{title}</p>
      <p className="max-w-md text-sm leading-relaxed text-ink-soft">{children}</p>
    </div>
  );
}
