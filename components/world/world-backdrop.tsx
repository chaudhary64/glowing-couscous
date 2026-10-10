"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useCallback, useState, useSyncExternalStore } from "react";

import type { WorldTier } from "./world-scene";

/**
 * Mounts the 3D world behind every page (root layout), and decides how much of it a
 * device gets:
 *
 *   no WebGL         nothing — the page stands on the CSS ground in globals.css
 *   reduced motion   one still frame at the page's station
 *   phone / tablet   one still frame ("low"): a lit board, no running loop
 *   desktop          the live world; "high" with bloom on 8+ cores, "mid" without
 *
 * The scene's code and the board model load after the page has painted (dynamic
 * import, no SSR), and the canvas fades in only once the board is in, so the world
 * never holds up the content or flashes half-built.
 */

const WorldScene = dynamic(() => import("./world-scene"), { ssr: false });

type Mode = "off" | `${WorldTier}:${"live" | "still"}`;

const QUERIES = ["(prefers-reduced-motion: reduce)", "(pointer: coarse)", "(max-width: 900px)"];

function subscribe(notify: () => void) {
  const lists = QUERIES.map((query) => window.matchMedia(query));
  lists.forEach((list) => list.addEventListener("change", notify));
  return () => lists.forEach((list) => list.removeEventListener("change", notify));
}

let webgl: boolean | undefined;
function hasWebGL(): boolean {
  if (webgl === undefined) {
    try {
      webgl = Boolean(document.createElement("canvas").getContext("webgl2"));
    } catch {
      webgl = false;
    }
  }
  return webgl;
}

function snapshot(): Mode {
  if (!hasWebGL()) return "off";
  const [reduced, coarse, narrow] = QUERIES.map((query) => window.matchMedia(query).matches);
  if (coarse || narrow) return "low:still";
  const cores = navigator.hardwareConcurrency ?? 4;
  const tier: WorldTier = cores >= 8 ? "high" : "mid";
  return `${tier}:${reduced ? "still" : "live"}`;
}

export function WorldBackdrop() {
  const pathname = usePathname();
  const mode = useSyncExternalStore(subscribe, snapshot, () => "off" as Mode);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  if (mode === "off") return null;
  const [tier, motion] = mode.split(":") as [WorldTier, "live" | "still"];

  return (
    <div aria-hidden className="world-backdrop" data-ready={ready ? "" : undefined}>
      <WorldScene pathname={pathname} tier={tier} still={motion === "still"} onReady={onReady} />
      <div className="world-veil" />
    </div>
  );
}
