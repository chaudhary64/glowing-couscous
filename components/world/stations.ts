/**
 * Where the camera stands for each page, over the circuit board the whole site is set
 * on. Moving between pages flies the camera between these, so the product reads as one
 * place: intake is the collection lane at the board's edge connectors, valuation the
 * assay lab by the heatsink, the gatekeeper a scanner over a chip row, pickups the long
 * traces between them, the map a view from above, the dashboard the control room over
 * the middle.
 *
 * Coordinates are in board units after `WORLD_SCALE`: the board spans roughly ±1 on x
 * and z, y is up. `eye` is the camera, `look` what it faces. Kept as data so a station
 * can be retuned without touching the scene.
 */

export interface Station {
  eye: [number, number, number];
  look: [number, number, number];
  /** How far the idle drift wanders, as a fraction of the eye's distance. */
  drift?: number;
  /**
   * A flight tied to the page's scroll instead of one spot: keyframes at scroll
   * progress `at` (0..1). The landing page uses it to dive into the board as you read.
   */
  path?: { at: number; eye: [number, number, number]; look: [number, number, number] }[];
}

const OVERVIEW: Station = { eye: [2.2, 1.5, 2.4], look: [0, 0, 0], drift: 0.08 };

/** The landing page's flight: it opens close over the board and pulls back as you
 *  scroll — up past the heatsink, out over the whole board, and finally high above it
 *  with the circuit floor running off into the dark. */
const LANDING: Station = {
  ...OVERVIEW,
  eye: [1.05, 0.55, 1.15],
  look: [0.1, 0.05, 0],
  drift: 0.04,
  path: [
    { at: 0, eye: [1.05, 0.55, 1.15], look: [0.1, 0.05, 0] },
    { at: 0.3, eye: [1.55, 0.9, 1.6], look: [0.05, 0.04, -0.05] },
    { at: 0.65, eye: [2.3, 1.55, 2.4], look: [0, 0, 0] },
    { at: 1, eye: [3.1, 2.6, 3.0], look: [0, 0, 0] },
  ],
};

// Text-heavy screens stand further back and higher, so the board reads as a landscape
// behind the panels rather than as single parts; the demo screens come in closer.
export const STATIONS: Record<string, Station> = {
  "/": LANDING,
  "/dashboard": { eye: [0.2, 1.9, 2.2], look: [0, 0, 0.1], drift: 0.06 },
  "/intake": { eye: [-2.0, 0.75, 1.4], look: [-0.6, 0.05, 0.2] },
  "/valuation": { eye: [0.95, 0.85, 1.1], look: [0.08, 0.1, -0.08] },
  "/validation": { eye: [-0.85, 0.95, 0.45], look: [0.15, 0.04, -0.55] },
  "/evidence": { eye: [-1.5, 1.0, -1.2], look: [-0.3, 0.02, -0.2] },
  "/pickups": { eye: [2.1, 0.7, -0.8], look: [0.4, 0.03, -0.05] },
  "/handoff": { eye: [1.7, 0.6, 0.9], look: [0.35, 0.03, 0.15] },
  "/gate": { eye: [1.4, 0.7, -1.5], look: [0.2, 0.04, -0.35] },
  "/demo": { eye: [2.0, 0.8, 0.2], look: [0.25, 0.03, 0] },
  "/map": { eye: [0.2, 3.2, 0.5], look: [0, 0, 0], drift: 0.04 },
  "/collectors": { eye: [-2.1, 0.9, -0.2], look: [-0.5, 0.03, 0] },
  "/recyclers": { eye: [0.3, 0.85, -2.0], look: [0.05, 0.03, -0.5] },
};

/** Docs, sign-in and anything unlisted: a slow high pass over the whole board. */
export function stationFor(pathname: string): Station {
  if (STATIONS[pathname]) return STATIONS[pathname];
  const section = `/${pathname.split("/")[1] ?? ""}`;
  return STATIONS[section] ?? OVERVIEW;
}

/** Eye and look along a station's scroll path at progress `p`, eased between keyframes. */
export function alongPath(path: NonNullable<Station["path"]>, p: number) {
  const t = Math.min(1, Math.max(0, p));
  let i = 0;
  while (i < path.length - 2 && t > path[i + 1].at) i += 1;
  const a = path[i];
  const b = path[i + 1];
  const k0 = (t - a.at) / (b.at - a.at || 1);
  const k = k0 * k0 * (3 - 2 * k0);
  const mix = (u: number[], v: number[]) => u.map((x, j) => x + (v[j] - x) * k) as [number, number, number];
  return { eye: mix(a.eye, b.eye), look: mix(a.look, b.look) };
}
