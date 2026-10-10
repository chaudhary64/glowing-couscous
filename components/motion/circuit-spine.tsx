"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The landing page as a circuit board.
 *
 * One copper trace runs down the left margin of the page, routed the way a PCB track
 * is: straight runs joined by 45° jogs. Every section marked `data-node` is a solder
 * pad on it, with a short stub branching toward the section. As the page scrolls the
 * trace is drawn behind the reader's eye (its tip sits at 62% of the viewport), and a
 * pad lights the moment the signal reaches it.
 *
 * It is drawn from the live layout: positions are measured, not authored, and
 * re-measured whenever the page changes height. Wide screens only (there is no
 * margin to route through on a phone); under reduced motion it is drawn whole.
 */

interface Node {
  y: number;
  lit: boolean;
}

interface Layout {
  width: number;
  height: number;
  x: number;
  path: string;
  nodes: Node[];
  /** Path length at sampled y positions, for mapping scroll to length. */
  samples: { y: number; len: number }[];
}

const JOG = 18; // the 45° jog's horizontal offset, px
const MIN_WIDTH = 1280;

export function CircuitSpine() {
  const svg = useRef<SVGSVGElement>(null);
  const trace = useRef<SVGPathElement>(null);
  const glow = useRef<SVGPathElement>(null);
  const tip = useRef<SVGCircleElement>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [lit, setLit] = useState(0);

  // Measure the page and route the trace.
  useEffect(() => {
    const host = svg.current?.parentElement;
    if (!host) return;
    const wide = window.matchMedia(`(min-width: ${MIN_WIDTH}px)`);

    const measure = () => {
      if (!wide.matches) return setLayout(null);
      const hostRect = host.getBoundingClientRect();
      const anchors = [...host.querySelectorAll<HTMLElement>("[data-node]")];
      const column = host.querySelector<HTMLElement>("[data-node] .max-w-6xl");
      if (anchors.length < 2 || !column) return setLayout(null);
      const x = column.getBoundingClientRect().left - hostRect.left - 34;
      const ys = anchors.map((a) => a.getBoundingClientRect().top - hostRect.top + 56);

      // Straight down to just above each pad, a 45° jog out and back, then the pad.
      let d = `M ${x} ${ys[0]}`;
      ys.slice(1).forEach((y, i) => {
        const side = i % 2 === 0 ? JOG : -JOG;
        const mid = (ys[i] + y) / 2;
        d += ` L ${x} ${mid - JOG} L ${x + side} ${mid} L ${x + side} ${y - JOG * 2} L ${x} ${y - JOG}  L ${x} ${y}`;
      });
      setLayout({ width: hostRect.width, height: hostRect.height, x, path: d, nodes: ys.map((y) => ({ y, lit: false })), samples: [] });
    };

    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(host);
    wide.addEventListener("change", measure);
    return () => {
      ro.disconnect();
      wide.removeEventListener("change", measure);
    };
  }, []);

  // Draw with the scroll.
  useEffect(() => {
    const path = trace.current;
    const host = svg.current?.parentElement;
    if (!layout || !path || !host) return;
    const total = path.getTotalLength();
    // Length as a function of y, sampled once per layout.
    const samples: { y: number; len: number }[] = [];
    for (let i = 0; i <= 240; i++) {
      const len = (total * i) / 240;
      samples.push({ y: path.getPointAtLength(len).y, len });
    }
    const lengthAt = (y: number) => {
      if (y <= samples[0].y) return 0;
      for (let i = 1; i < samples.length; i++)
        if (samples[i].y >= y) {
          const a = samples[i - 1];
          const b = samples[i];
          return a.len + ((y - a.y) / (b.y - a.y || 1)) * (b.len - a.len);
        }
      return total;
    };

    path.style.strokeDasharray = `${total}`;
    const halo = glow.current;
    if (halo) halo.style.strokeDasharray = `${total}`;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const draw = () => {
      frame = 0;
      const tipY = reduced ? Infinity : window.scrollY + window.innerHeight * 0.62 - (host.getBoundingClientRect().top + window.scrollY);
      const len = Math.min(total, lengthAt(tipY));
      path.style.strokeDashoffset = `${total - len}`;
      if (halo) halo.style.strokeDashoffset = `${total - len}`;
      const point = path.getPointAtLength(len);
      tip.current?.setAttribute("cx", String(point.x));
      tip.current?.setAttribute("cy", String(point.y));
      setLit(layout.nodes.filter((n) => n.y <= tipY).length);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    draw();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [layout]);

  return (
    <svg
      ref={svg}
      aria-hidden
      className="pointer-events-none absolute inset-0 hidden xl:block"
      width={layout?.width ?? 0}
      height={layout?.height ?? 0}
      style={{ overflow: "visible" }}
    >
      {layout ? (
        <>
          <defs>
            <filter id="spine-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {/* The unlit track, then the copper drawn over it. The trace runs the page's full
              height and redraws on every scroll frame, so its glow is a wide faint stroke
              rather than a blur filter, which would re-blur the whole page-tall path. */}
          <path d={layout.path} fill="none" stroke="var(--color-rule)" strokeWidth={2} />
          <path ref={glow} d={layout.path} fill="none" stroke="var(--color-copper)" strokeOpacity={0.22} strokeWidth={7} strokeLinecap="round" />
          <path ref={trace} d={layout.path} fill="none" stroke="var(--color-copper)" strokeWidth={2.5} />
          {layout.nodes.map((node, i) => {
            const on = i < lit;
            return (
              <g key={i} transform={`translate(${layout.x} ${node.y})`}>
                {/* the stub toward the section, ending in a via */}
                <line x1={0} y1={0} x2={22} y2={0} stroke={on ? "var(--color-copper)" : "var(--color-rule)"} strokeWidth={2} />
                <circle cx={26} cy={0} r={3} fill="none" stroke={on ? "var(--color-copper)" : "var(--color-rule)"} strokeWidth={1.5} />
                {/* the pad */}
                <rect x={-7} y={-7} width={14} height={14} fill={on ? "var(--color-copper)" : "var(--color-paper)"} stroke={on ? "var(--color-copper)" : "var(--color-rule)"} strokeWidth={2} filter={on ? "url(#spine-glow)" : undefined} style={{ transition: "fill 300ms, stroke 300ms" }} />
                <rect x={-2.5} y={-2.5} width={5} height={5} fill={on ? "var(--color-paper)" : "var(--color-rule)"} />
              </g>
            );
          })}
          <circle ref={tip} r={4} fill="var(--color-paper)" stroke="var(--color-copper)" strokeWidth={2} filter="url(#spine-glow)" />
        </>
      ) : null}
    </svg>
  );
}
