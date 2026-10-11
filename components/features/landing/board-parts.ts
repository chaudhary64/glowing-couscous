/**
 * How the circuit board comes apart.
 *
 * The model (Poly Haven "Circuit Board", CC0) is one mesh per material, not one per
 * component, so the parts are recovered here: vertices that share a position are welded
 * (Blender splits them at UV seams), triangles join what they touch, and what is left
 * connected is one physical part — a heatsink, a socket, a capacitor. On this model
 * that is 647 parts.
 *
 * Each vertex then gets two numbers the shader reads:
 *
 * - `offset` — where its part goes in the exploded view: up by how tall the part
 *   stands (heatsinks highest, flat resistors lowest, so the view reads as strata), and
 *   a little outward from the centre so stacked parts do not hide each other.
 * - `delay` — when it starts moving: parts near the centre lift first and the motion
 *   ripples outward.
 *
 * The board itself — the one part spanning most of the footprint — never moves.
 * Pure arithmetic over typed arrays; no three.js import, so it can be tested in Node.
 */

export interface MeshArrays {
  /** xyz per vertex. */
  positions: ArrayLike<number>;
  /** Three per triangle. */
  indices: ArrayLike<number>;
}

export interface PartBox {
  min: [number, number, number];
  max: [number, number, number];
}

export interface Partition {
  /** Part number per vertex, 0..parts.length-1. */
  partOf: Int32Array;
  parts: PartBox[];
}

/** Connected parts of one mesh, welding vertices closer than `weld` (model units). */
export function partition(mesh: MeshArrays, weld = 1e-5): Partition {
  const n = mesh.positions.length / 3;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const join = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const seen = new Map<string, number>();
  const p = mesh.positions;
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(p[i * 3] / weld)},${Math.round(p[i * 3 + 1] / weld)},${Math.round(p[i * 3 + 2] / weld)}`;
    const other = seen.get(key);
    if (other === undefined) seen.set(key, i);
    else join(i, other);
  }
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    join(idx[t], idx[t + 1]);
    join(idx[t], idx[t + 2]);
  }

  const partOf = new Int32Array(n);
  const number = new Map<number, number>();
  const parts: PartBox[] = [];
  for (let i = 0; i < n; i++) {
    const root = find(i);
    let id = number.get(root);
    if (id === undefined) {
      id = parts.length;
      number.set(root, id);
      parts.push({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
    }
    partOf[i] = id;
    const box = parts[id];
    for (let a = 0; a < 3; a++) {
      const v = p[i * 3 + a];
      if (v < box.min[a]) box.min[a] = v;
      if (v > box.max[a]) box.max[a] = v;
    }
  }
  return { partOf, parts };
}

export interface Footprint {
  /** Board centre in x/z. */
  centre: [number, number];
  /** Largest x/z span of the board. */
  span: number;
  /** Tallest part top, measured from the board's lowest point. */
  top: number;
  floor: number;
}

/** The board's footprint, across every mesh's parts. */
export function footprint(all: PartBox[][]): Footprint {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const parts of all)
    for (const box of parts)
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], box.min[a]);
        max[a] = Math.max(max[a], box.max[a]);
      }
  return {
    centre: [(min[0] + max[0]) / 2, (min[2] + max[2]) / 2],
    span: Math.max(max[0] - min[0], max[2] - min[2]),
    top: max[1] - min[1],
    floor: min[1],
  };
}

/** Exploded-view tuning, in fractions of the board's span. */
export const EXPLODE = {
  /** Lowest lift, for the flattest part. */
  baseLift: 0.08,
  /** Extra lift for the tallest part. */
  heightLift: 0.42,
  /** Outward spread from the centre. */
  spread: 0.22,
  /** Latest start, as a fraction of the explode timeline (centre starts at 0). */
  maxDelay: 0.45,
} as const;

/** Per-vertex offset (xyz) and delay for one mesh. */
export function explodeAttributes(
  mesh: MeshArrays,
  { partOf, parts }: Partition,
  board: Footprint,
): { offset: Float32Array; delay: Float32Array } {
  const span = board.span || 1;
  const halfSpan = span / 2;
  const partOffset = parts.map((box) => {
    const width = Math.max(box.max[0] - box.min[0], box.max[2] - box.min[2]);
    // The PCB itself: the part that covers most of the footprint stays put.
    if (width > span * 0.7) return { x: 0, y: 0, z: 0, delay: 0 };
    const cx = (box.min[0] + box.max[0]) / 2 - board.centre[0];
    const cz = (box.min[2] + box.max[2]) / 2 - board.centre[1];
    const stands = (box.max[1] - board.floor) / (board.top || 1); // 0 flat … 1 tallest
    const lift = span * (EXPLODE.baseLift + EXPLODE.heightLift * Math.sqrt(Math.max(0, stands)));
    const distance = Math.min(1, Math.hypot(cx, cz) / halfSpan);
    return {
      x: cx * EXPLODE.spread,
      y: lift,
      z: cz * EXPLODE.spread,
      delay: EXPLODE.maxDelay * distance,
    };
  });

  const n = mesh.positions.length / 3;
  const offset = new Float32Array(n * 3);
  const delay = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = partOffset[partOf[i]];
    offset[i * 3] = o.x;
    offset[i * 3 + 1] = o.y;
    offset[i * 3 + 2] = o.z;
    delay[i] = o.delay;
  }
  return { offset, delay };
}

/** Where a part with this delay is at overall explode progress `t` (0..1). Mirrors the shader. */
export function partProgress(t: number, delay: number): number {
  const span = 1 - EXPLODE.maxDelay;
  const x = Math.min(1, Math.max(0, (t - delay) / span));
  return x * x * (3 - 2 * x); // smoothstep
}
