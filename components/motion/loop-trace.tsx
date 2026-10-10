"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A copper trace that carries the signal through a numbered sequence as it scrolls by.
 *
 * Wraps a list whose items are the steps. The trace runs along the top of the row on a
 * wide screen and down the left edge when the steps stack; each step lights
 * (`data-lit`) as the signal reaches it. The trace's length is the section's scroll
 * progress, written straight to a CSS variable, so scrolling never re-renders React.
 *
 * Under reduced motion the trace is drawn full and every step lit.
 */
export function LoopTrace({ children, className }: { children: ReactNode; className?: string }) {
  const holder = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const steps = [...el.querySelectorAll<HTMLElement>("li")];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0 as the list's top crosses 85% of the viewport, 1 as its bottom passes 55%.
      const p = reduced ? 1 : Math.min(1, Math.max(0, (vh * 0.85 - rect.top) / (rect.height + vh * 0.3)));
      el.style.setProperty("--trace", p.toFixed(4));
      steps.forEach((step, i) => {
        if (p >= (i + 0.35) / steps.length) step.dataset.lit = "1";
        else delete step.dataset.lit;
      });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    // Unlit steps dim only once the trace is running; without it, every step reads.
    if (!reduced) el.dataset.live = "1";
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={holder} className={`loop-trace relative ${className ?? ""}`}>
      <span aria-hidden className="loop-trace__line" />
      {children}
    </div>
  );
}
