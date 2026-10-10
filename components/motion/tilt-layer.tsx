"use client";

import { useEffect } from "react";

/**
 * Cards and devices that lean toward the pointer, like objects in the 3D world rather
 * than flat boxes. Any element opts in with `data-tilt` (optionally `data-tilt="4"` for a
 * gentler maximum, in degrees); a sheen inside it can follow the pointer with
 * `.tilt-sheen`.
 *
 * One listener for the page. Every change goes through the Web Animations API — the same
 * rule as motion-observer.tsx — so no attribute or style is ever written to an element
 * React might still be hydrating. Fine pointers only; off under reduced motion.
 */
export function TiltLayer() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const live = new Map<HTMLElement, { tilt: Animation; sheen: Animation | null }>();
    let current: HTMLElement | null = null;
    let frame = 0;
    let last: PointerEvent | null = null;

    const pose = (element: HTMLElement, rx: number, ry: number, mx: number, my: number, duration: number) => {
      const transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(0)`;
      let entry = live.get(element);
      const sheenElement = element.querySelector<HTMLElement>(":scope > .tilt-sheen");
      const sheenFrame = { background: `radial-gradient(260px circle at ${mx}% ${my}%, rgb(255 255 255 / 0.09), transparent 60%)` };
      if (!entry) {
        entry = {
          tilt: element.animate([{ transform }], { duration, fill: "forwards", easing: "ease-out" }),
          sheen: sheenElement ? sheenElement.animate([sheenFrame], { duration, fill: "forwards" }) : null,
        };
        live.set(element, entry);
        return;
      }
      (entry.tilt.effect as KeyframeEffect).setKeyframes([{ transform }]);
      (entry.tilt.effect as KeyframeEffect).updateTiming({ duration });
      entry.tilt.currentTime = 0;
      entry.tilt.play();
      if (entry.sheen) {
        (entry.sheen.effect as KeyframeEffect).setKeyframes([sheenFrame]);
        entry.sheen.currentTime = 0;
        entry.sheen.play();
      }
    };

    const apply = () => {
      frame = 0;
      const event = last;
      if (!event) return;
      const target = (event.target as Element | null)?.closest<HTMLElement>("[data-tilt]") ?? null;
      if (current && current !== target) pose(current, 0, 0, 50, 50, 420);
      current = target;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      const max = Number(target.dataset.tilt) || 7;
      pose(target, (0.5 - y) * max, (x - 0.5) * max, x * 100, y * 100, 120);
    };

    const move = (event: PointerEvent) => {
      last = event;
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const leave = () => {
      if (current) pose(current, 0, 0, 50, 50, 420);
      current = null;
    };

    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    return () => {
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
      cancelAnimationFrame(frame);
      live.forEach((entry) => {
        entry.tilt.cancel();
        entry.sheen?.cancel();
      });
    };
  }, []);

  return null;
}
