"use client";

import { useEffect, useRef } from "react";

/**
 * The gatekeeper's reticle, as the pointer.
 *
 * Mouse and trackpad only (`pointer: fine`), never under reduced motion, and the
 * system cursor stays: this is a companion, not a replacement.
 *
 * - **Reticle.** Four copper corners trail the pointer with a little lag and read out
 *   its coordinates. Over a link or button they **lock on**: the corners spring out to
 *   frame the target and the readout names it.
 * - **Magnetic buttons.** Elements marked `data-magnetic` lean toward the pointer when
 *   it comes close, and settle back when it leaves.
 *
 * One pointer listener and one animation frame drive both. This component writes only
 * to the element it renders itself: a link or button it pulls is moved through the Web
 * Animations API, never its `style` attribute, because the pointer can move before the
 * page under the cursor has hydrated, and React reads any attribute write on a
 * server-rendered element as a mismatch. (The dark sections' spotlight is
 * `spotlight-layer.tsx`, which follows the same rule.)
 */

const LOCK_SELECTOR = "a, button, [role='button']";

export function ScannerCursor() {
  const reticle = useRef<HTMLDivElement>(null);
  const readout = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)").matches;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const el = reticle.current;
    if (!fine || reduced || !el) return;

    const pointer = { x: -100, y: -100 };
    const box = { x: -100, y: -100, w: 34, h: 34 };
    let locked: Element | null = null;
    let visible = false;
    let frame = 0;
    const magnets = new Map<HTMLElement, { x: number; y: number; pull: Animation }>();
    const at = (x: number, y: number) => ({ transform: `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)` });

    const lockOn = (hit: Element | null) => {
      if (hit === locked) return;
      locked = hit;
      if (locked) el.dataset.locked = "1";
      else delete el.dataset.locked;
    };

    const label = (target: Element) =>
      (target.getAttribute("aria-label") ?? target.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 22).toUpperCase();

    // The loop sleeps once the reticle has caught up and no magnet is moving; the next
    // pointer move wakes it. An idle page then costs no frames at all.
    const wake = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };
    const tick = () => {
      frame = 0;
      // A target that left the page (a dismissed notice, a closed menu) lets go at once,
      // rather than leaving the reticle framing nothing until the next pointer move.
      if (locked && !locked.isConnected) lockOn(null);
      // Target box: the locked element's rect (padded), or a small square on the pointer.
      let tx = pointer.x - 17;
      let ty = pointer.y - 17;
      let tw = 34;
      let th = 34;
      if (locked) {
        const r = locked.getBoundingClientRect();
        tx = r.left - 6;
        ty = r.top - 6;
        tw = r.width + 12;
        th = r.height + 12;
      }
      const k = 0.22;
      box.x += (tx - box.x) * k;
      box.y += (ty - box.y) * k;
      box.w += (tw - box.w) * k;
      box.h += (th - box.h) * k;
      el.style.transform = `translate3d(${box.x}px, ${box.y}px, 0)`;
      el.style.width = `${box.w}px`;
      el.style.height = `${box.h}px`;
      if (readout.current) {
        readout.current.textContent = locked
          ? `LOCK · ${label(locked)}`
          : `X ${String(Math.round(pointer.x)).padStart(4, "0")} · Y ${String(Math.round(pointer.y)).padStart(4, "0")}`;
      }

      // Magnetic elements: ease toward their target offset.
      magnets.forEach((offset, target) => {
        const r = target.getBoundingClientRect();
        const cx = r.left + r.width / 2 - offset.x;
        const cy = r.top + r.height / 2 - offset.y;
        const dx = pointer.x - cx;
        const dy = pointer.y - cy;
        // Only within a short reach of the element's own edge, and never more than a
        // few pixels, so neighbouring buttons can never drift into each other.
        const near = Math.abs(dx) < r.width / 2 + 24 && Math.abs(dy) < r.height / 2 + 24;
        const clamp = (v: number) => Math.max(-6, Math.min(6, v));
        const gx = near ? clamp(dx * 0.12) : 0;
        const gy = near ? clamp(dy * 0.18) : 0;
        offset.x += (gx - offset.x) * 0.2;
        offset.y += (gy - offset.y) * 0.2;
        (offset.pull.effect as KeyframeEffect).setKeyframes([at(offset.x, offset.y), at(offset.x, offset.y)]);
        if (!near && Math.abs(offset.x) < 0.05 && Math.abs(offset.y) < 0.05) {
          offset.pull.cancel();
          magnets.delete(target);
        }
      });

      const moving = Math.abs(tx - box.x) + Math.abs(ty - box.y) + Math.abs(tw - box.w) + Math.abs(th - box.h) > 0.1;
      if (moving || magnets.size > 0) wake();
    };

    const onMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      if (!visible) {
        visible = true;
        el.dataset.on = "1";
        box.x = pointer.x - 17;
        box.y = pointer.y - 17;
      }
      lockOn((event.target as Element | null)?.closest?.(LOCK_SELECTOR) ?? null);
      // Magnets near the pointer join the animated set.
      document.querySelectorAll<HTMLElement>("[data-magnetic]").forEach((m) => {
        if (magnets.has(m)) return;
        const r = m.getBoundingClientRect();
        if (Math.abs(event.clientX - (r.left + r.width / 2)) < r.width / 2 + 24 && Math.abs(event.clientY - (r.top + r.height / 2)) < r.height / 2 + 24)
          magnets.set(m, { x: 0, y: 0, pull: m.animate([at(0, 0), at(0, 0)], { duration: 1, fill: "forwards" }) });
      });
      wake();
    };
    const onLeave = () => {
      visible = false;
      delete el.dataset.on;
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    // The page can change under a still pointer: a scroll moves another link beneath it,
    // and a click can remove the very button it framed (a dismissed notice, a closed
    // menu). Either way the reticle re-reads what is now under the pointer.
    const recheck = () => {
      if (visible) lockOn(document.elementFromPoint(pointer.x, pointer.y)?.closest(LOCK_SELECTOR) ?? null);
      wake();
    };
    // After a click, once React has applied whatever the click changed.
    let afterClick = 0;
    const onClick = () => {
      window.clearTimeout(afterClick);
      afterClick = window.setTimeout(recheck, 80);
    };
    window.addEventListener("scroll", recheck, { passive: true });
    window.addEventListener("click", onClick, { passive: true });
    wake();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.clearTimeout(afterClick);
      window.removeEventListener("scroll", recheck);
      window.removeEventListener("click", onClick);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      magnets.forEach((offset) => offset.pull.cancel());
    };
  }, []);

  return (
    <div ref={reticle} aria-hidden className="scanner-reticle">
      <span className="scanner-reticle__corner" data-c="tl" />
      <span className="scanner-reticle__corner" data-c="tr" />
      <span className="scanner-reticle__corner" data-c="bl" />
      <span className="scanner-reticle__corner" data-c="br" />
      <span ref={readout} className="scanner-reticle__readout" />
    </div>
  );
}
