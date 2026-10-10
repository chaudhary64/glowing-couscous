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
      <Burst />
      <div className="relative">
        <span aria-hidden className="upi-ring" />
        <span aria-hidden className="upi-ring" style={{ animationDelay: "700ms" }} />
      <div className="handoff-upi-check relative flex size-24 items-center justify-center rounded-full border-4 border-paper">
        <svg viewBox="0 0 24 24" className="size-12" fill="none" stroke="currentColor" strokeWidth={3} aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="square" className="upi-tick" />
        </svg>
      </div>
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

/**
 * The payment lands with a burst: gold and copper coins thrown out in 3D from behind
 * the tick. Trajectories come from a fixed hash of the chip's index, so the
 * render is pure and every burst is the same shape.
 */
const CHIPS = Array.from({ length: 36 }, (_, i) => {
  const h = (n: number) => {
    const x = Math.sin((i + 1) * n) * 43758.5453;
    return x - Math.floor(x);
  };
  const angle = h(12.9898) * Math.PI * 2;
  const reach = 110 + h(78.233) * 140;
  return {
    tx: Math.cos(angle) * reach,
    ty: Math.sin(angle) * reach - 30,
    tz: (h(37.719) - 0.3) * 260,
    spin: 180 + h(91.13) * 540,
    size: 12 + Math.round(h(23.41) * 10),
    gold: i % 3 !== 0,
    delay: Math.round(h(55.5) * 160),
  };
});

function Burst() {
  return (
    <div aria-hidden className="upi-burst">
      {CHIPS.map((chip, index) => (
        <span
          key={index}
          className="upi-chip"
          style={
            {
              "--tx": `${chip.tx.toFixed(1)}px`,
              "--ty": `${chip.ty.toFixed(1)}px`,
              "--tz": `${chip.tz.toFixed(1)}px`,
              "--spin": `${chip.spin.toFixed(0)}deg`,
              width: chip.size,
              height: chip.size,
              background: chip.gold
                ? "radial-gradient(circle at 35% 30%, #fff1c2, #e3bd55 45%, #a87c22 100%)"
                : "radial-gradient(circle at 35% 30%, #ffd9bf, #e8894d 45%, #8f4a22 100%)",
              animationDelay: `${420 + chip.delay}ms`,
            } as React.CSSProperties
          }
        />
      ))}
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
