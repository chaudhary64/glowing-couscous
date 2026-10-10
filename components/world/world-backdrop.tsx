"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useCallback, useState, useSyncExternalStore } from "react";

import type { WorldTier } from "./world-scene";

/**
 * Mounts the 3D world behind every page (root layout), and decides how much of it a
 * device gets:
 *
 *   no WebGL, or WebGL only in software (SwiftShader, llvmpipe, a VM's basic
 *                    renderer — measured at 1 fps here, against 60 on the GPU):
 *                    nothing; the page stands on the CSS ground in globals.css
 *   switched off     the sidebar's "3D world" switch (cookie `ecoepr.world=off`)
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

/** Fired by the 3D world switch (world-toggle.tsx) after it writes the cookie. */
export const WORLD_EVENT = "ecoepr:world";
export const WORLD_COOKIE = "ecoepr.world";

function subscribe(notify: () => void) {
  const lists = QUERIES.map((query) => window.matchMedia(query));
  lists.forEach((list) => list.addEventListener("change", notify));
  window.addEventListener(WORLD_EVENT, notify);
  return () => {
    lists.forEach((list) => list.removeEventListener("change", notify));
    window.removeEventListener(WORLD_EVENT, notify);
  };
}

export function worldSwitchedOff(): boolean {
  return document.cookie.split("; ").includes(`${WORLD_COOKIE}=off`);
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;

let gpu: boolean | undefined;
/**
 * WebGL on real graphics hardware. `failIfMajorPerformanceCaveat` makes the browser
 * refuse a context it would have to emulate in software; the renderer string catches
 * the browsers that hand one out anyway.
 */
function hasGpuWebGL(): boolean {
  if (gpu === undefined) {
    try {
      const gl = document.createElement("canvas").getContext("webgl2", { failIfMajorPerformanceCaveat: true });
      if (!gl) {
        gpu = false;
      } else {
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
        gpu = !SOFTWARE.test(renderer);
        gl.getExtension("WEBGL_lose_context")?.loseContext();
      }
    } catch {
      gpu = false;
    }
  }
  return gpu;
}

function snapshot(): Mode {
  if (worldSwitchedOff() || !hasGpuWebGL()) return "off";
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
