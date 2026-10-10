"use client";

import { useEffect, useRef } from "react";

/**
 * The hidden PCB pattern under a dark section, lit in a circle where the pointer is.
 *
 * Its own element, updated only by itself and only after it has hydrated: it writes the
 * pointer's local position into its *own* `--mx`/`--my`, never onto the section around
 * it. (Writing onto a server-rendered parent before React had hydrated it is a
 * hydration mismatch — which is exactly what an early mouse move used to cause.)
 *
 * Mouse and trackpad only; nothing under reduced motion. Styles: `.spotlight-layer`.
 */
export function SpotlightLayer({ className }: { className?: string }) {
  const layer = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = layer.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let x = -999;
    let y = -999;
    const paint = () => {
      frame = 0;
      el.style.setProperty("--mx", `${x}px`);
      el.style.setProperty("--my", `${y}px`);
    };
    const onMove = (event: PointerEvent) => {
      const r = host.getBoundingClientRect();
      x = event.clientX - r.left;
      y = event.clientY - r.top;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    host.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      host.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return <span ref={layer} aria-hidden className={`spotlight-layer ${className ?? ""}`} />;
}
