"use client";

import { Environment, Grid, Lightformer, PerformanceMonitor, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import { MODEL_URL } from "@/components/features/landing/board-model";
import { boardMaterial } from "@/components/features/landing/board-material";

import { alongPath, stationFor } from "./stations";
import "./quiet-three";

/**
 * The world the whole site is set in: the CC0 circuit board from the landing page,
 * scaled into a landscape and flown over at low altitude, so chips stand like buildings
 * and the traces run like streets. Copper signal pulses travel the traces, dust drifts
 * in the light, the board's edges fall away into a dark circuit floor and fog.
 *
 * One scene for every page (it is mounted in the root layout, which persists across
 * navigation); each route has a camera station (`stations.ts`) and changing page flies
 * the camera there. The camera also leans with the pointer and dips as the page scrolls.
 *
 * Cost control, by tier (`world-backdrop.tsx` decides the tier):
 *   high  DPR up to 1.5, bloom, 2 200 dust motes, 56 pulses
 *   mid   DPR 1, no bloom, 1 200 motes, 36 pulses
 *   low   one still frame (phones, reduced motion)
 * PerformanceMonitor drops bloom and DPR at runtime if the frame rate sags.
 */

export type WorldTier = "high" | "mid" | "low";

const COPPER = new THREE.Color("#e8894d");
/** Over-bright, so only the pulses cross bloom's threshold. */
const HOT = COPPER.clone().multiplyScalar(4);
const GROUND = "#05080b";
/** Fog at a page's resting distance; the camera rig thins it as the view pulls back. */
const FOG_DENSITY = 0.32;

/** The board is about 0.5 model units across; this makes it ±1. */
const BOARD_SPAN = 2;

export default function WorldScene({
  pathname,
  tier,
  still,
  onReady,
}: {
  pathname: string;
  tier: WorldTier;
  /** Reduced motion, or a low tier: draw a single frame at the station and stop. */
  still: boolean;
  onReady: () => void;
}) {
  const [dpr, setDpr] = useState(tier === "high" ? 1.5 : 1);
  const [bloom, setBloom] = useState(tier === "high");

  return (
    <Canvas
      frameloop={still ? "demand" : "always"}
      dpr={dpr}
      camera={{ fov: 38, near: 0.01, far: 40, position: stationFor(pathname).eye }}
      gl={{ antialias: tier !== "low", powerPreference: "high-performance", alpha: false }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 0.95;
        scene.background = new THREE.Color(GROUND);
        scene.fog = new THREE.FogExp2(GROUND, FOG_DENSITY);
      }}
    >
      <PerformanceMonitor
        onDecline={() => {
          setBloom(false);
          setDpr(1);
        }}
        onIncline={() => {
          if (tier === "high") setDpr(1.5);
        }}
      />

      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={1.6} color="#ffd9bf" position={[0, 3, 1]} scale={[5, 2, 1]} />
        <Lightformer form="rect" intensity={1.1} color="#e8894d" position={[-4, 0.8, -1]} rotation={[0, Math.PI / 2, 0]} scale={[4, 1, 1]} />
        <Lightformer form="rect" intensity={0.7} color="#7fb8c9" position={[4, 0.8, 1]} rotation={[0, -Math.PI / 2, 0]} scale={[4, 1.5, 1]} />
      </Environment>
      <ambientLight intensity={0.15} />
      <directionalLight position={[2.5, 4, 1.5]} intensity={0.9} color="#ffe2cc" />
      <directionalLight position={[-3, 1.5, -2.5]} intensity={0.45} color="#6fb3c8" />

      <Suspense fallback={null}>
        <Board onReady={onReady} />
      </Suspense>
      <CircuitFloor />
      <SignalPulses count={tier === "high" ? 56 : 36} />
      {tier !== "low" ? <Dust count={tier === "high" ? 2200 : 1200} /> : null}
      <CameraRig pathname={pathname} still={still} />

      {bloom && !still ? (
        <EffectComposer multisampling={0}>
          <Bloom luminanceThreshold={1} luminanceSmoothing={0.2} intensity={1.15} mipmapBlur />
        </EffectComposer>
      ) : null}
    </Canvas>
  );
}

/* ------------------------------------------------------------------ the board */

function Board({ onReady }: { onReady: () => void }) {
  const { scene } = useGLTF(MODEL_URL);
  const gl = useThree((state) => state.gl);
  const invalidate = useThree((state) => state.invalidate);

  const board = useMemo(() => {
    const root = scene.clone(true);
    const anisotropy = gl.capabilities.getMaxAnisotropy();
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = boardMaterial(mesh.material as THREE.MeshStandardMaterial, anisotropy);
    });
    // Centre it, sit it on y = 0, and scale it into the landscape.
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const scale = BOARD_SPAN / Math.max(size.x, size.z);
    const center = box.getCenter(new THREE.Vector3());
    root.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    root.scale.setScalar(scale);
    return root;
  }, [scene, gl]);

  useEffect(() => {
    invalidate();
    onReady();
  }, [board, invalidate, onReady]);

  return <primitive object={board} />;
}

/** The board's edges fall away onto an endless dark circuit floor, lost in fog. */
function CircuitFloor() {
  return (
    <Grid
      position={[0, -0.002, 0]}
      args={[10, 10]}
      cellSize={0.1}
      cellThickness={0.6}
      cellColor="#1a242c"
      sectionSize={0.8}
      sectionThickness={1}
      sectionColor="#4a3020"
      fadeDistance={9}
      fadeStrength={1.6}
      infiniteGrid
    />
  );
}

/* ------------------------------------------------------------ signal pulses */

/** Trail length (instances per pulse, head first). */
const TRAIL = 7;

/**
 * Copper signals travelling the board like current: each runs a Manhattan route
 * (alternating x and z legs, the way traces are laid) at its own speed, a bright head
 * with a fading tail, and starts a new route when it arrives.
 */
/** Per-frame scratch, shared: one world is ever mounted. */
const scratch = { m: new THREE.Matrix4(), p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() };

function SignalPulses({ count }: { count: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  // Mutable per-frame state lives in a ref, created on the first frame.
  const live = useRef<{ routes: Route[]; progress: number[]; speed: number[] } | null>(null);

  useFrame((_, delta) => {
    const instanced = mesh.current;
    if (!instanced) return;
    if (!live.current || live.current.routes.length !== count) {
      const routes = Array.from({ length: count }, () => makeRoute());
      live.current = {
        routes,
        progress: routes.map(() => Math.random()),
        speed: routes.map(() => 0.06 + Math.random() * 0.1),
      };
    }
    const { routes, progress, speed } = live.current;
    const step = Math.min(delta, 0.05);
    for (let i = 0; i < routes.length; i += 1) {
      progress[i] += (step * speed[i]) / routes[i].length;
      if (progress[i] >= 1) {
        routes[i] = makeRoute();
        progress[i] = 0;
      }
      for (let k = 0; k < TRAIL; k += 1) {
        const t = Math.max(0, progress[i] - k * (0.012 / routes[i].length) * 6);
        pointAlong(routes[i], t, scratch.p);
        const size = (1 - k / TRAIL) * 0.009;
        scratch.s.setScalar(size);
        scratch.m.compose(scratch.p, scratch.q, scratch.s);
        instanced.setMatrixAt(i * TRAIL + k, scratch.m);
      }
    }
    instanced.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count * TRAIL]} frustumCulled={false}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial color={HOT} toneMapped={false} />
    </instancedMesh>
  );
}

interface Route {
  points: THREE.Vector3[];
  /** Cumulative length at each point. */
  at: number[];
  length: number;
}

function makeRoute(): Route {
  const y = 0.012;
  // Most routes live on the board; a few run out across the floor into the dark.
  const reach = Math.random() < 0.75 ? 0.95 : 2.6;
  let x = (Math.random() * 2 - 1) * reach;
  let z = (Math.random() * 2 - 1) * reach;
  const points = [new THREE.Vector3(x, y, z)];
  const legs = 3 + Math.floor(Math.random() * 4);
  let alongX = Math.random() < 0.5;
  for (let i = 0; i < legs; i += 1) {
    const length = (0.15 + Math.random() * 0.55) * (Math.random() < 0.5 ? -1 : 1);
    if (alongX) x = THREE.MathUtils.clamp(x + length, -reach, reach);
    else z = THREE.MathUtils.clamp(z + length, -reach, reach);
    points.push(new THREE.Vector3(x, y, z));
    alongX = !alongX;
  }
  const at = [0];
  for (let i = 1; i < points.length; i += 1) at.push(at[i - 1] + points[i].distanceTo(points[i - 1]));
  return { points, at, length: Math.max(at[at.length - 1], 0.001) };
}

function pointAlong(route: Route, t: number, out: THREE.Vector3) {
  const d = t * route.length;
  let i = 1;
  while (i < route.at.length - 1 && route.at[i] < d) i += 1;
  const a = route.at[i - 1];
  const b = route.at[i];
  const k = b > a ? (d - a) / (b - a) : 0;
  out.lerpVectors(route.points[i - 1], route.points[i], THREE.MathUtils.clamp(k, 0, 1));
}

/* --------------------------------------------------------------------- dust */

/** Motes drifting up through the light, for depth: near ones large, far ones lost in fog. */
function Dust({ count }: { count: number }) {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    // Seeded, so the same motes stand in the same places on every render.
    const random = mulberry32(count);
    const array = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      array[i * 3] = (random() * 2 - 1) * 3.2;
      array[i * 3 + 1] = random() * 1.6;
      array[i * 3 + 2] = (random() * 2 - 1) * 3.2;
    }
    return array;
  }, [count]);

  useFrame((_, delta) => {
    const geometry = points.current?.geometry;
    if (!geometry) return;
    const attribute = geometry.getAttribute("position") as THREE.BufferAttribute;
    const array = attribute.array as Float32Array;
    const rise = Math.min(delta, 0.05) * 0.035;
    for (let i = 1; i < array.length; i += 3) {
      array[i] += rise;
      if (array[i] > 1.6) array[i] = 0;
    }
    attribute.needsUpdate = true;
  });

  return (
    <points ref={points} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.0065}
        color="#f2c4a2"
        alphaMap={moteTexture()}
        transparent
        opacity={0.55}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

let mote: THREE.Texture | null = null;
/**
 * A soft round mote. GL points are squares, which never shows at a distance, but a
 * mote that drifts close to the camera grows to a hard-edged grey block. Used as the
 * alpha map, this round falloff makes every mote a soft disc at any size.
 */
function moteTexture(): THREE.Texture {
  if (mote) return mote;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    const glow = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // Alpha maps read the green channel, so the falloff is drawn in grey.
    glow.addColorStop(0, "#fff");
    glow.addColorStop(0.45, "#888");
    glow.addColorStop(1, "#000");
    context.fillStyle = glow;
    context.fillRect(0, 0, size, size);
  }
  mote = new THREE.CanvasTexture(canvas);
  return mote;
}

/** A small seeded PRNG (mulberry32): deterministic "random" layouts during render. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --------------------------------------------------------------- camera rig */

/**
 * Flies to the page's station and lives there: a slow orbit (the drift), a lean toward
 * the pointer, and a dip forward as the page scrolls. Everything is damped, so a route
 * change is a flight, never a cut. Under `still` it jumps to the station and stops.
 */
/** The rig's per-frame targets (module scratch: one world is ever mounted). */
const target = { eye: new THREE.Vector3(), look: new THREE.Vector3(), forward: new THREE.Vector3() };

function CameraRig({ pathname, still }: { pathname: string; still: boolean }) {
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);
  const station = stationFor(pathname);
  const eye = useRef(new THREE.Vector3(...station.eye));
  const look = useRef(new THREE.Vector3(...station.look));
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const move = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  // A still world jumps to the station and draws once.
  useEffect(() => {
    if (!still) return;
    camera.position.set(...station.eye);
    camera.lookAt(...station.look);
    invalidate();
  }, [still, station, camera, invalidate]);

  useFrame((state, delta) => {
    if (still) return;
    const t = state.clock.elapsedTime;
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    const scroll = scrollable > 0 ? window.scrollY / scrollable : 0;

    // A station with a path flies it with the scroll; otherwise it stands at its spot.
    const spot = station.path ? alongPath(station.path, scroll) : station;
    target.eye.set(...spot.eye);
    target.look.set(...spot.look);
    const distance = target.eye.distanceTo(target.look);
    const drift = (station.drift ?? 0.05) * distance;
    target.eye.x += Math.sin(t * 0.07) * drift + pointer.current.x * 0.09 * distance;
    target.eye.z += Math.cos(t * 0.05) * drift * 0.6;
    target.eye.y += -pointer.current.y * 0.05 * distance;
    if (!station.path) {
      // Scrolling down pulls the camera back and up: the further you read, the more of
      // the board comes into view, as if stepping back from it.
      target.forward.copy(target.eye).sub(target.look).normalize();
      target.eye.addScaledVector(target.forward, scroll * 0.7 * distance);
      target.eye.y += scroll * 0.35 * distance;
    }

    // Settles a page-to-page flight in about 1.5 s: quick enough to keep up with a click,
    // slow enough to read as travel rather than a cut.
    const lambda = 2.2;
    const dt = Math.min(delta, 0.1);
    eye.current.set(
      THREE.MathUtils.damp(eye.current.x, target.eye.x, lambda, dt),
      THREE.MathUtils.damp(eye.current.y, target.eye.y, lambda, dt),
      THREE.MathUtils.damp(eye.current.z, target.eye.z, lambda, dt),
    );
    look.current.set(
      THREE.MathUtils.damp(look.current.x, target.look.x, lambda * 1.2, dt),
      THREE.MathUtils.damp(look.current.y, target.look.y, lambda * 1.2, dt),
      THREE.MathUtils.damp(look.current.z, target.look.z, lambda * 1.2, dt),
    );
    camera.position.copy(eye.current);
    camera.lookAt(look.current);

    // Thinner fog the further back the camera stands, so a zoomed-out view still shows
    // the board instead of a wall of haze.
    const fog = state.scene.fog as THREE.FogExp2 | null;
    if (fog) fog.density = FOG_DENSITY * THREE.MathUtils.clamp(2.6 / eye.current.distanceTo(look.current), 0.38, 1);
  });

  return null;
}

useGLTF.preload(MODEL_URL);
