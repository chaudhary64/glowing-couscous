"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useCallback, useState, useSyncExternalStore } from "react";

import { hasGpuWebGL } from "@/lib/gpu";

import { stationKey, stillName } from "./stations";
import type { WorldTier } from "./world-scene";

/**
 * Mounts the 3D world behind every page (root layout), and decides how much of it a
 * device gets:
 *
 *   switched off     the sidebar's "3D world" switch (cookie `ecoepr.world=off`)
 *   phone / tablet   a picture of the page's station: `public/world/<station>.webp`,
 *                    rendered from this scene by `scripts/render-world-stills.mjs`.
 *                    A phone used to load three.js and the board (about 2.5 MB) and
 *                    block its main thread for seconds to draw that one frame.
 *   no WebGL, or WebGL only in software (SwiftShader, llvmpipe, a VM's basic
 *                    renderer — measured at 1 fps here, against 60 on the GPU):
 *                    nothing; the page stands on the CSS ground in globals.css
 *   reduced motion   one still frame at the page's station
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

function snapshot(): Mode {
  if (worldSwitchedOff()) return "off";
  const [reduced, coarse, narrow] = QUERIES.map((query) => window.matchMedia(query).matches);
  if ((coarse || narrow) && !stationOverride()) return "low:still";
  if (!hasGpuWebGL()) return "off";
  if (coarse || narrow) return "low:still";
  const cores = navigator.hardwareConcurrency ?? 4;
  const tier: WorldTier = cores >= 8 ? "high" : "mid";
  return `${tier}:${reduced ? "still" : "live"}`;
}

/**
 * Development only, for `scripts/render-world-stills.mjs`: `?world-station=/intake`
 * draws that page's station with the 3D scene on any page (the product's pages need a
 * sign-in the script does not have). Compiled out of production builds.
 */
function stationOverride(): string | null {
  if (process.env.NODE_ENV !== "development") return null;
  return new URLSearchParams(window.location.search).get("world-station");
}

export function WorldBackdrop() {
  const pathname = usePathname();
  const mode = useSyncExternalStore(subscribe, snapshot, () => "off" as Mode);
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);

  if (mode === "off") return null;
  const [tier, motion] = mode.split(":") as [WorldTier, "live" | "still"];

  const override = stationOverride();

  return (
    <div aria-hidden className="world-backdrop" data-ready={ready ? "" : undefined}>
      {tier === "low" && !override ? (
        // A plain <img>: one fixed, full-bleed picture with no layout to reserve, and
        // the optimizer would only re-encode a file that is already sized for phones.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/world/${stillName(stationKey(pathname))}.webp`}
          alt=""
          decoding="async"
          className="world-still"
          onLoad={onReady}
        />
      ) : (
        <WorldScene pathname={override ?? pathname} tier={tier} still={motion === "still"} onReady={onReady} />
      )}
      <div className="world-veil" />
    </div>
  );
}
