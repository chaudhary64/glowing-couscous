"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { cn } from "@/lib/cn";
import { hasGpuWebGL } from "@/lib/gpu";

/**
 * "Collected → assayed → priced → stamped", told once, on scroll.
 *
 * A tall section whose inner frame sticks to the viewport while the visitor scrolls
 * through it. The scroll position drives the 3D board (`board-scene.tsx`) and picks
 * which of four captions is shown. Every figure in a caption is passed in from the
 * landing page, which takes it from the same item and rate card as the receipt above —
 * the board is illustrative, the numbers are not.
 *
 * It degrades in three steps, and each step is still a finished section:
 *
 * - **Reduced motion:** no scroll-jacking. The section is ordinary height, the board is
 *   one still frame of the exploded view, and all four captions are listed.
 * - **No WebGL:** the captions run as above, beside a plain ledger panel.
 * - **Before the model arrives:** the same panel, so nothing shifts when it does.
 *
 * The 3D code is loaded only when the section comes within a screen of the viewport.
 */

const BoardScene = dynamic(() => import("./board-scene"), { ssr: false });

export interface AssayLine {
  label: string;
  detail?: string;
  value: string;
  muted?: boolean;
}

export interface AssayFacts {
  itemId: string;
  itemLabel: string;
  city: string;
  matchedClass: string;
  confidence: string;
  /** Material fractions, by mass. */
  fractions: { name: string; mass: string }[];
  totalMass: string;
  lines: AssayLine[];
  gross: string;
  fee: string;
  net: string;
  validUntil: string;
}

const BEATS = [
  { from: 0, label: "Collected" },
  { from: 0.25, label: "Assayed" },
  { from: 0.58, label: "Priced" },
  { from: 0.84, label: "Stamped" },
] as const;

const beatAt = (p: number) => {
  let beat = 0;
  BEATS.forEach((b, i) => {
    if (p >= b.from) beat = i;
  });
  return beat;
};

/** The exploded, side-on frame shown as the one still image under reduced motion. */
const STILL_PROGRESS = 0.7;


const REDUCED = "(prefers-reduced-motion: reduce)";
function onReducedChange(notify: () => void) {
  const query = window.matchMedia(REDUCED);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}
const never = () => () => {};

export function AssaySequence({ facts, stamp }: { facts: AssayFacts; stamp: ReactNode }) {
  const section = useRef<HTMLElement>(null);
  const progress = useRef(0);
  const [beat, setBeat] = useState(0);
  const [near, setNear] = useState(false);
  const [ready, setReady] = useState(false);
  // The server renders the full-motion, WebGL layout; the client corrects it on hydration.
  const reduced = useSyncExternalStore(onReducedChange, () => window.matchMedia(REDUCED).matches, () => false);
  const webgl = useSyncExternalStore(never, hasGpuWebGL, () => true);

  // Load the 3D only when the section is about a screen away.
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Scroll → progress (a ref, read by the canvas every frame) and the beat (state).
  useEffect(() => {
    if (reduced) {
      progress.current = STILL_PROGRESS;
      return;
    }
    const el = section.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const p = travel > 0 ? Math.min(1, Math.max(0, -rect.top / travel)) : 0;
      progress.current = p;
      setBeat(beatAt(p));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [reduced]);

  const showCanvas = near && webgl;

  return (
    <section
      ref={section}
      id="assay"
      data-node
      aria-labelledby="assay-title"
      className={cn("relative scroll-mt-24 border-b-2 border-ink bg-paper", !reduced && "h-[420vh]")}
    >
      <div className={cn(!reduced && "sticky top-0 h-dvh overflow-hidden")}>
        <div className="mx-auto grid h-full w-full max-w-6xl grid-rows-[minmax(0,1fr)_auto] gap-6 px-5 pb-8 pt-20 sm:px-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:grid-rows-1 lg:items-center lg:gap-12 lg:pb-12">
          {/* -------------------------------------------------------- the board */}
          <div
            className={cn(
              // No frame: the board sits on the page's own paper, shadow and all.
              "relative min-h-[280px] w-full",
              reduced ? "aspect-[4/3] lg:sticky lg:top-24 lg:self-start" : "h-full lg:h-[min(78vh,720px)]",
            )}
          >
            {showCanvas ? (
              // The canvas bleeds past its column, so parts flying outward fade into the
              // paper instead of hitting a hard edge.
              <div
                className={cn(
                  "absolute -inset-x-10 -inset-y-6 transition-opacity duration-700 sm:-inset-x-16 lg:-inset-y-12 lg:-left-40 lg:right-0",
                  ready ? "opacity-100" : "opacity-0",
                )}
              >
                <BoardScene progress={progress} live={!reduced} onReady={() => setReady(true)} />
              </div>
            ) : null}
            {!ready ? (
              <div className="absolute inset-0 flex items-end p-5">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-muted">
                  {webgl ? "Loading the board…" : "3D view unavailable on this device"}
                </p>
              </div>
            ) : null}


            <p className="pointer-events-none absolute bottom-3 right-4 font-mono text-[9px] uppercase tracking-[0.14em] text-ink-muted/80">
              Illustrative board · Poly Haven, CC0
            </p>
          </div>

          {/* ------------------------------------------------------ the captions */}
          <div className={cn("relative z-10", !reduced && "min-h-[260px] lg:min-h-[420px]")}>
            {/* the ledger rail: where in the sequence we are */}
            {!reduced ? (
              <ol className="pointer-events-none absolute left-0 top-0 hidden flex-wrap gap-1.5 lg:flex" aria-hidden>
                {BEATS.map((b, i) => (
                  <li key={b.label} className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "font-mono text-[10px] uppercase tracking-[0.14em] transition-colors duration-500",
                        i === beat ? "text-copper" : i < beat ? "text-ink-soft" : "text-ink-muted/60",
                      )}
                    >
                      {String(i + 1).padStart(2, "0")} {b.label}
                    </span>
                    {i < BEATS.length - 1 ? <span className="h-px w-4 bg-rule" /> : null}
                  </li>
                ))}
              </ol>
            ) : null}
            <h2 id="assay-title" className="sr-only">
              From one collected unit to a stamped credit note
            </h2>
            {[
              <Beat key="collected" index={0} eyebrow="As collected" title={facts.itemLabel}>
                <p>
                  Photographed at the doorstep in {facts.city}. The gatekeeper reads it as{" "}
                  <span className="text-ink">{facts.matchedClass}</span> at {facts.confidence} confidence —
                  nothing below happens until it does.
                </p>
              </Beat>,
              <Beat key="assayed" index={1} eyebrow="Assayed" title="Taken apart, by mass">
                <ul className="divide-y divide-rule border-y border-rule">
                  {facts.fractions.map((f) => (
                    <li key={f.name} className="flex items-baseline justify-between gap-4 py-1.5">
                      <span>{f.name}</span>
                      <span className="font-mono text-[12px] text-ink">{f.mass}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em]">
                  {facts.fractions.length} fractions · {facts.totalMass}
                </p>
              </Beat>,
              <Beat key="priced" index={2} eyebrow="Priced" title="Line by line, on the server">
                <ul className="divide-y divide-rule border-y border-rule">
                  {facts.lines.map((line) => (
                    <li key={line.label} className={cn("flex items-baseline justify-between gap-4 py-1.5", line.muted && "text-ink-muted")}>
                      <span className="min-w-0">
                        {line.label}
                        {line.detail ? (
                          <span className="block font-mono text-[10px] uppercase tracking-[0.1em] text-ink-muted">{line.detail}</span>
                        ) : null}
                      </span>
                      <span className="font-mono text-[12px] text-ink">{line.value}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 flex justify-between font-mono text-[12px] text-ink">
                  <span className="uppercase tracking-[0.12em] text-ink-muted">Gross · fee</span>
                  <span>
                    {facts.gross} · −{facts.fee}
                  </span>
                </p>
              </Beat>,
              <Beat key="stamped" index={3} eyebrow="Stamped" title="A note a compliance officer can hold">
                <div className="flex flex-wrap items-center gap-5">
                  <span className={cn("inline-block", (reduced || beat === 3) && "animate-stamp-press")}>{stamp}</span>
                  <span>
                    <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-ink-muted">Net to collector</span>
                    <span className="font-display text-4xl leading-none tracking-tight text-ink">{facts.net}</span>
                  </span>
                </div>
                <p className="mt-3">
                  {facts.itemId} · valid until {facts.validUntil}. Issued only after the gate reads Verified, and
                  only to a CPCB-registered recycler.
                </p>
              </Beat>,
            ].map((node, i) =>
              reduced ? (
                <div key={i} className="mb-8 last:mb-0">
                  {node}
                </div>
              ) : (
                <div
                  key={i}
                  aria-hidden={i !== beat}
                  className={cn(
                    "absolute inset-x-0 top-1/2 transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none",
                    i === beat
                      ? "-translate-y-1/2 opacity-100"
                      : i < beat
                        ? "pointer-events-none -translate-y-[calc(50%+16px)] opacity-0"
                        : "pointer-events-none -translate-y-[calc(50%-16px)] opacity-0",
                  )}
                >
                  {node}
                </div>
              ),
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Beat({
  index,
  eyebrow,
  title,
  children,
}: {
  index: number;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-copper">
        {String(index + 1).padStart(2, "0")} · {eyebrow}
      </p>
      <h3 className="mt-3 font-display text-3xl uppercase leading-[0.95] tracking-tight sm:text-4xl">{title}</h3>
      <div className="mt-4 text-[14px] leading-relaxed text-ink-soft">{children}</div>
    </div>
  );
}
