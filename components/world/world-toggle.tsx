"use client";

import { useSyncExternalStore } from "react";

import { WORLD_COOKIE, WORLD_EVENT, worldSwitchedOff } from "./world-backdrop";

/**
 * The "3D world" switch: for a laptop on battery, a slow machine, or a visitor who
 * simply prefers a still page. The choice is a first-party cookie, read by
 * world-backdrop.tsx, and takes effect at once.
 */
function subscribe(notify: () => void) {
  window.addEventListener(WORLD_EVENT, notify);
  return () => window.removeEventListener(WORLD_EVENT, notify);
}

export function WorldToggle() {
  const off = useSyncExternalStore(subscribe, worldSwitchedOff, () => false);

  const flip = () => {
    const year = 365 * 24 * 60 * 60;
    document.cookie = off
      ? `${WORLD_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
      : `${WORLD_COOKIE}=off; Path=/; Max-Age=${year}; SameSite=Lax`;
    window.dispatchEvent(new Event(WORLD_EVENT));
  };

  return (
    <button
      type="button"
      onClick={flip}
      aria-pressed={!off}
      className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper/60 underline decoration-paper/25 underline-offset-2 hover:text-paper hover:decoration-copper"
    >
      3D world: {off ? "off" : "on"}
    </button>
  );
}
