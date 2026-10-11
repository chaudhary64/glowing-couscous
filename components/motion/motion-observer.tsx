"use client";

import { useEffect } from "react";

/**
 * One observer for the whole site's scroll motion.
 *
 * Any element, from any server component, opts in with an attribute and nothing else:
 *
 * - `data-motion="scan"`  — wiped in left to right behind a copper scan line.
 * - `data-motion="rows"`  — its children type in one after another.
 * - `data-motion="print"` — its figures settle digit by digit, like a receipt printer.
 * - `data-motion="stamp"` — struck down with weight.
 *
 * Everything runs through the Web Animations API, and this component never writes an
 * attribute or a style: an element React has not hydrated yet would report any such
 * write as a hydration mismatch. Which elements are armed or done lives in memory.
 *
 * An element that is on screen when the page loads is left exactly as rendered, so
 * nothing visible blinks; one below the fold is held in its starting pose (a zero-
 * length animation that fills forwards) until it scrolls into view. With no
 * JavaScript, or under reduced motion, nothing is ever held back.
 *
 * New elements (client navigation, streamed content) are picked up by a
 * MutationObserver, so pages need no wiring of their own.
 */

const SELECTOR = "[data-motion]";
const DIGITS = "0123456789";
const EASE_PRINT = "cubic-bezier(0.22, 1, 0.36, 1)";
const EASE_STRIKE = "cubic-bezier(0.2, 0.9, 0.25, 1)";

type Kind = "scan" | "rows" | "print" | "stamp";

/** The pose each kind waits in, and the animation that releases it. */
const MOTIONS: Record<Kind, { from: Keyframe; play: (el: HTMLElement) => Animation[] }> = {
  scan: {
    from: { clipPath: "inset(0 100% 0 0)" },
    play: (el) => {
      const run = el.animate([{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }], {
        duration: 900,
        easing: EASE_PRINT,
        fill: "forwards",
      });
      return [run, scanLine(el)];
    },
  },
  rows: {
    from: {},
    play: (el) =>
      [...el.children].map((child, i) =>
        (child as HTMLElement).animate(
          [
            { opacity: 0, transform: "translateY(10px)", clipPath: "inset(0 0 100% 0)" },
            { opacity: 1, transform: "none", clipPath: "inset(0 0 0 0)" },
          ],
          { duration: 520, delay: i * 70, easing: EASE_PRINT, fill: "both" },
        ),
      ),
  },
  print: {
    from: { clipPath: "inset(0 0 100% 0)" },
    play: (el) => {
      printDigits(el);
      return [
        el.animate([{ clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 0 0)" }], {
          duration: 700,
          easing: "steps(7, end)",
          fill: "forwards",
        }),
      ];
    },
  },
  stamp: {
    from: { opacity: 0 },
    play: (el) => [
      el.animate(
        [
          { opacity: 0, transform: "translateY(-18px) scale(1.9)" },
          { opacity: 1, transform: "translateY(0) scale(0.94)", offset: 0.55 },
          { transform: "scale(1.03)", offset: 0.72 },
          { opacity: 1, transform: "scale(1)" },
        ],
        { duration: 560, delay: 120, easing: EASE_STRIKE, fill: "both" },
      ),
    ],
  },
};

/** A copper hairline that rides the edge of a scan, drawn on a detached overlay. */
function scanLine(el: HTMLElement): Animation {
  const rect = el.getBoundingClientRect();
  const line = document.createElement("div");
  Object.assign(line.style, {
    position: "absolute",
    top: `${rect.top + window.scrollY - 4}px`,
    left: `${rect.left + window.scrollX}px`,
    width: "2px",
    height: `${rect.height + 8}px`,
    background: "var(--color-copper)",
    boxShadow: "0 0 12px 2px color-mix(in oklab, var(--color-copper) 70%, transparent)",
    pointerEvents: "none",
    zIndex: "30",
  });
  document.body.appendChild(line);
  const run = line.animate(
    [
      { transform: "translateX(0)", opacity: 1 },
      { transform: `translateX(${rect.width}px)`, opacity: 1, offset: 0.85 },
      { transform: `translateX(${rect.width}px)`, opacity: 0 },
    ],
    { duration: 900, easing: EASE_PRINT, fill: "forwards" },
  );
  run.onfinish = () => line.remove();
  return run;
}

/**
 * Settle each digit of `el`'s text left to right, cycling through others first.
 *
 * Works on React's own text node (never `textContent`, which would swap the node out
 * from under React and strand later updates), and stops the moment anything else
 * writes to it: a re-render with a new figure always wins.
 */
function printDigits(el: HTMLElement) {
  const node = [...el.childNodes].find((n): n is Text => n instanceof Text && /\d/.test(n.data));
  if (!node) return;
  const final = node.data;
  const positions = [...final].map((ch, i) => (/\d/.test(ch) ? i : -1)).filter((i) => i >= 0);
  const frames = 14 + positions.length * 2;
  let frame = 0;
  let written = final;
  const tick = () => {
    if (node.data !== written) return; // React updated it: leave it alone
    frame++;
    const settled = Math.floor((frame / frames) * (positions.length + 1));
    const chars = [...final];
    positions.forEach((pos, k) => {
      if (k >= settled) chars[pos] = DIGITS[(frame * 7 + k * 3) % 10];
    });
    written = frame < frames ? chars.join("") : final;
    node.data = written;
    if (frame < frames) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Holds an element (or a list's rows) in its starting pose until released. */
function hold(el: HTMLElement, kind: Kind): Animation[] {
  const pose = (target: Element, keyframe: Keyframe) =>
    target.animate([keyframe, keyframe], { duration: 1, fill: "forwards" });
  if (kind === "rows") return [...el.children].map((child) => pose(child, { opacity: 0 }));
  return [pose(el, MOTIONS[kind].from)];
}

export function MotionObserver() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const seen = new WeakSet<Element>();
    const held = new WeakMap<Element, Animation[]>();

    const release = (el: HTMLElement) => {
      const kind = el.dataset.motion as Kind;
      const played = MOTIONS[kind].play(el);
      // The real animation now covers the pose; drop the hold.
      for (const a of held.get(el) ?? []) a.cancel();
      held.delete(el);
      // Once finished, let the animations go so the element is plain DOM again.
      Promise.all(played.map((a) => a.finished))
        .then(() => played.forEach((a) => a.cancel()))
        .catch(() => {});
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.unobserve(entry.target);
          release(entry.target as HTMLElement);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );

    const adopt = (el: HTMLElement) => {
      if (seen.has(el)) return;
      seen.add(el);
      if (!((el.dataset.motion ?? "") in MOTIONS)) return;
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.88 && rect.bottom > 0) return; // already in view: leave it be
      held.set(el, hold(el, el.dataset.motion as Kind));
      io.observe(el);
    };

    document.querySelectorAll<HTMLElement>(SELECTOR).forEach(adopt);

    const mo = new MutationObserver((records) => {
      for (const record of records)
        record.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches(SELECTOR)) adopt(node);
          node.querySelectorAll<HTMLElement>(SELECTOR).forEach(adopt);
        });
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);

  return null;
}
