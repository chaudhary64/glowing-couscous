"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { cn } from "@/lib/cn";

/**
 * Mounts the hero's 3D board behind the headline.
 *
 * The headline and receipt are server HTML and paint first; the board fades in behind
 * them once its code and model arrive, so it never holds up the largest paint. Its
 * render loop runs only while the hero is on screen. Under reduced motion it is one
 * still frame; without WebGL the hero is simply the ink ground it was designed on.
 *
 * Below the desktop breakpoint the board is its own block between the headline and the
 * receipt, framed for portrait (`compact`) and drawn at a lower pixel ratio.
 */

const HeroScene = dynamic(() => import("./hero-scene"), { ssr: false });

const REDUCED = "(prefers-reduced-motion: reduce)";
function onReducedChange(notify: () => void) {
  const query = window.matchMedia(REDUCED);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}
let webglSupport: boolean | undefined;
function supportsWebGL(): boolean {
  if (webglSupport === undefined) {
    try {
      const canvas = document.createElement("canvas");
      webglSupport = Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
}
const never = () => () => {};

/** Desktop composition (board behind the copy) versus the stacked phone composition. */
const WIDE = "(min-width: 1024px)";
function onWideChange(notify: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", notify);
  return () => query.removeEventListener("change", notify);
}

export function HeroBoard({ className }: { className?: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(true);
  const [ready, setReady] = useState(false);
  const reduced = useSyncExternalStore(onReducedChange, () => window.matchMedia(REDUCED).matches, () => false);
  const webgl = useSyncExternalStore(never, supportsWebGL, () => false);
  const wide = useSyncExternalStore(onWideChange, () => window.matchMedia(WIDE).matches, () => false);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={holder} aria-hidden className={cn("pointer-events-none", className)}>
      {webgl ? (
        <div className={cn("absolute inset-0 transition-opacity duration-[1400ms] ease-out", ready ? "opacity-100" : "opacity-0")}>
          <HeroScene live={!reduced} active={active} compact={!wide} onReady={() => setReady(true)} />
        </div>
      ) : null}
    </div>
  );
}
