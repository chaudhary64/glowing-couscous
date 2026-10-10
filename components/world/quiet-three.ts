import { setConsoleFunction } from "three";

/**
 * three.js r183+ deprecates THREE.Clock and warns once per instance; @react-three/fiber
 * 9.8 (the latest) still creates one per <Canvas>, so every 3D scene printed a warning
 * that is the library's to fix, not ours. This drops exactly that message and passes
 * every other three.js log, warning and error through unchanged.
 *
 * Imported for its side effect by each module that mounts a Canvas, so it is set before
 * the first one is created whichever scene loads first.
 */
const CLOCK_DEPRECATION = "THREE.Clock: This module has been deprecated";

setConsoleFunction((type: "log" | "warn" | "error", message: string, ...params: unknown[]) => {
  if (type === "warn" && typeof message === "string" && message.startsWith(CLOCK_DEPRECATION)) return;
  console[type](message, ...params);
});
