"use client";

import { formatPaise } from "@/lib/pickup/types";

/**
 * The moment the demo is built around: the collector's phone turning green because the
 * money arrived. It is shown only when the pickup reads `payoutStatus: "paid"` — written
 * by the stream-triggered payout function — never on the strength of the gate's own
 * request succeeding. A screen that celebrated the settle call would be claiming the
 * money moved when all it knew was that the note was issued.
 */
export function UpiOverlay({
  amountPaise,
  reference,
  vpa,
  noteId,
  paidAt,
  onClose,
}: {
  amountPaise: number;
  reference: string;
  vpa: string;
  noteId: string;
  paidAt: string;
  onClose?: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="assertive"
      className="handoff-upi absolute inset-0 z-20 flex flex-col items-center justify-center bg-verified px-6 text-center text-paper"
    >
      <div className="handoff-upi-check flex size-24 items-center justify-center rounded-full border-4 border-paper">
        <svg viewBox="0 0 24 24" className="size-12" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="square" />
        </svg>
      </div>
      <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-paper/80">UPI payment</p>
      <p className="mt-1 font-display text-6xl leading-none tracking-tight">{formatPaise(amountPaise)}</p>
      <p className="mt-2 font-display text-2xl uppercase tracking-tight">Successful</p>

      <dl className="mt-8 w-full space-y-2 border-t border-paper/30 pt-4 text-left font-mono text-[11px]">
        <Row term="To" value={vpa} />
        <Row term="UPI ref" value={reference} />
        <Row term="Credit note" value={noteId} />
        <Row term="Time" value={new Date(paidAt).toLocaleTimeString("en-IN")} />
      </dl>
      <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-paper/70">
        Simulated rail · no money moved
      </p>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="mt-6 border-2 border-paper px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] hover:bg-paper hover:text-verified"
        >
          Done
        </button>
      ) : null}
    </div>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="uppercase tracking-[0.12em] text-paper/70">{term}</dt>
      <dd className="truncate text-right">{value}</dd>
    </div>
  );
}
