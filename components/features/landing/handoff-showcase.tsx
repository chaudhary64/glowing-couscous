"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The smart-pickup handoff, playing itself on the landing page: the collector's phone
 * routes a hazardous load, shows the PIN, the gate verifies it, and the UPI credit lands.
 * A picture of what /demo does live, with the figures the demo really produces — the
 * 37.5 kg lead-acid load nets ₹450.00 on the catalogue's rate card.
 *
 * It only runs while it is on screen (IntersectionObserver), so it costs nothing while
 * the visitor reads anything else. Under reduced motion it holds the final frame, with
 * every step listed — nothing is lost by not animating.
 */

const STEPS = [
  {
    title: "Hand over",
    body: "One tap on the collector's phone routes the load. Hazardous lead-acid skips the unlicensed site next door and goes to a CPCB-licensed battery line.",
  },
  {
    title: "PIN at the gate",
    body: "A 4-digit PIN appears once, on the phone. The recycler weighs the load and types it — five wrong tries lock it, and it expires in fifteen minutes.",
  },
  {
    title: "Paid over UPI",
    body: "The credit note issues on the weighed mass, and a DynamoDB Stream triggers the payout. The phone turns green — every step written to the audit trail.",
  },
] as const;

const FRAME_MS = 2600;
/** Phone frames: 0 load, 1 PIN, 2 verified at gate, 3 paid. Step = which copy is lit. */
const FRAMES = [0, 1, 2, 3] as const;
const stepOf = (frame: number) => (frame === 0 ? 0 : frame === 3 ? 2 : 1);

export function HandoffShowcase() {
  const root = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<number>(3);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const element = root.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(([entry]) => setPlaying(entry.isIntersecting), { threshold: 0.35 });
    io.observe(element);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setFrame((current) => (current + 1) % FRAMES.length), FRAME_MS);
    return () => clearInterval(timer);
  }, [playing]);

  const step = stepOf(frame);

  return (
    <div ref={root} className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
      <ol className="flex flex-col gap-3">
        {STEPS.map((entry, index) => (
          <li
            key={entry.title}
            data-lit={index === step ? "" : undefined}
            className="showcase-step border-l-2 border-rule py-2 pl-5"
          >
            <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-copper">
              {String(index + 1).padStart(2, "0")} · {entry.title}
            </p>
            <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-soft">{entry.body}</p>
          </li>
        ))}
      </ol>

      <div className="mx-auto w-full max-w-[300px]" aria-hidden>
        <div className="rounded-[2rem] border-[9px] border-ink bg-ink shadow-[0_30px_60px_-30px_rgba(18,23,27,0.7)]">
          <div className="relative h-[520px] overflow-hidden rounded-[1.45rem] bg-paper-raised">
            <div className="flex items-center justify-between border-b border-rule px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted">
              <span>EcoEPR · Collector</span>
              <span>C-1042</span>
            </div>
            <div className="px-4 py-4">
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-copper">Namaste, Sunita</p>
              <p className="mt-1 font-display text-xl uppercase leading-tight">Today&rsquo;s load</p>
              <div className="mt-3 border border-rule bg-paper p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[12px] font-medium leading-snug">Inverter batteries · 2 × sealed lead-acid</p>
                  <span className="border border-hazard bg-hazard-tint px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-[0.12em] text-hazard">
                    Hazardous
                  </span>
                </div>
                <p className="mt-2 flex justify-between font-mono text-[10px] text-ink-muted">
                  <span>Declared</span>
                  <span className="text-ink">37.5 kg</span>
                </p>
                <p className="mt-1 flex justify-between font-mono text-[10px] text-ink-muted">
                  <span>To</span>
                  <span className="text-ink">{frame === 0 ? "—" : "GreenLoop Battery Line"}</span>
                </p>
              </div>

              {frame === 0 ? (
                <div key="f0" className="showcase-frame mt-24">
                  <div className="showcase-press w-full border-2 border-ink bg-ink py-4 text-center font-display text-lg uppercase text-paper">
                    Hand over e-waste
                  </div>
                </div>
              ) : null}

              {frame === 1 ? (
                <div key="f1" className="showcase-frame mt-10 text-center">
                  <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-ink-muted">Show this PIN at the gate</p>
                  <p className="mt-2 flex justify-center font-mono text-5xl tabular-nums tracking-[0.16em]">
                    {"4821".split("").map((digit, index) => (
                      <span key={index} className="pin-digit inline-block" style={{ animationDelay: `${index * 90}ms` }}>
                        {digit}
                      </span>
                    ))}
                  </p>
                  <p className="mt-3 font-mono text-[10px] text-ink-muted">Valid 14:59 · 5 tries left</p>
                </div>
              ) : null}

              {frame === 2 ? (
                <div key="f2" className="showcase-frame mt-10 text-center">
                  <span className="inline-block border border-verified bg-verified px-2 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-paper">
                    Verified at gate
                  </span>
                  <p className="mt-3 font-display text-4xl tracking-tight">₹450.00</p>
                  <p className="mt-1 text-[11px] text-ink-soft">Credit note issued on 37.5 kg</p>
                  <p className="mt-5 inline-flex items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted">
                    <span className="inline-block size-1.5 animate-pulse bg-verified" />
                    UPI payment on its way
                  </p>
                </div>
              ) : null}
            </div>

            {frame === 3 ? (
              <div key="f3" className="handoff-upi absolute inset-0 flex flex-col items-center justify-center bg-verified px-5 text-center text-paper">
                <div className="relative">
                  <span className="upi-ring" />
                  <div className="handoff-upi-check relative flex size-20 items-center justify-center rounded-full border-4 border-paper">
                    <svg viewBox="0 0 24 24" className="size-10" fill="none" stroke="currentColor" strokeWidth={3}>
                      <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="square" className="upi-tick" />
                    </svg>
                  </div>
                </div>
                <p className="mt-5 font-mono text-[10px] uppercase tracking-[0.2em] text-paper/80">UPI payment</p>
                <p className="mt-1 font-display text-5xl leading-none">₹450.00</p>
                <p className="mt-2 font-display text-xl uppercase">Successful</p>
                <p className="mt-6 font-mono text-[9px] uppercase tracking-[0.14em] text-paper/70">
                  To c-1042@ecoepr · simulated rail
                </p>
              </div>
            ) : null}
          </div>
        </div>
        <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-ink-muted">
          The collector&rsquo;s phone · live at /demo
        </p>
      </div>
    </div>
  );
}
