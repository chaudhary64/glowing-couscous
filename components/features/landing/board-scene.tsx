"use client";

import { ContactShadows, Environment, Lightformer, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";

import { MODEL_URL } from "./board-model";
import { explodeAttributes, footprint, partition } from "./board-parts";

/**
 * The 3D board behind the assay sequence.
 *
 * One scroll-driven timeline, no loops and no auto-rotation: the camera pushes in on the
 * board as collected, the components lift off it into strata, the camera drops to the
 * side so the strata read as layers, and the parts settle back once the board is priced.
 *
 * Built to stay cheap at runtime:
 *
 * - **Two draw calls.** The explode happens in the vertex shader, from per-vertex
 *   offsets computed once on load (`board-parts.ts`), not by moving 647 objects.
 * - **No network lighting.** Reflections come from `Lightformer` panels rendered
 *   locally; there is no HDR file to fetch.
 * - **Renders on demand.** A frame is drawn only while scroll or easing changes
 *   something, and nothing at all while the section is off screen.
 */


/** Camera keyframes over the sequence progress (0..1). */
const SHOTS: { at: number; pos: [number, number, number]; look: [number, number, number]; explode: number }[] = [
  { at: 0.0, pos: [0.66, 0.82, 0.9], look: [0, 0.0, 0], explode: 0 }, // as collected: high three-quarter, whole board
  { at: 0.22, pos: [0.5, 0.62, 0.7], look: [0, 0.02, 0], explode: 0 }, // slow push in
  { at: 0.55, pos: [0.98, 0.6, 0.66], look: [0.03, 0.1, -0.03], explode: 1 }, // taken apart, orbiting
  { at: 0.78, pos: [1.18, 0.3, 0.36], look: [0.03, 0.11, -0.05], explode: 1 }, // low and side on: the strata
  { at: 1.0, pos: [0.6, 0.74, 0.8], look: [0, 0.01, 0], explode: 0 }, // settled, priced
];

const ease = (x: number) => x * x * (3 - 2 * x);

/** Interpolated shot at progress `p`. */
function shotAt(p: number) {
  const t = Math.min(1, Math.max(0, p));
  let i = 0;
  while (i < SHOTS.length - 2 && t > SHOTS[i + 1].at) i++;
  const a = SHOTS[i];
  const b = SHOTS[i + 1];
  const k = ease((t - a.at) / (b.at - a.at || 1));
  const mix = (u: number, v: number) => u + (v - u) * k;
  return {
    pos: a.pos.map((v, j) => mix(v, b.pos[j])) as [number, number, number],
    look: a.look.map((v, j) => mix(v, b.look[j])) as [number, number, number],
    explode: mix(a.explode, b.explode),
  };
}

type ExplodeUniform = { value: number };
type ExplodeShader = { uniforms: { uExplode: ExplodeUniform } };

/**
 * Adds the per-part lift to a glTF material, keeping all of its PBR maps. The uniform is
 * read through the ref when the shader compiles, so one animated value drives both meshes.
 */
function withExplode(material: THREE.MeshStandardMaterial, uniform: RefObject<ExplodeUniform>) {
  material.onBeforeCompile = (shader) => {
    (shader as unknown as ExplodeShader).uniforms.uExplode = uniform.current;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute vec3 aOffset;
attribute float aDelay;
uniform float uExplode;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
float eLocal = clamp((uExplode - aDelay) / 0.55, 0.0, 1.0);
transformed += aOffset * (eLocal * eLocal * (3.0 - 2.0 * eLocal));`,
      );
  };
  material.customProgramCacheKey = () => "board-explode";
  material.needsUpdate = true;
}

function Board({ progress, live }: { progress: RefObject<number>; live: boolean }) {
  const { scene } = useGLTF(MODEL_URL);
  const { camera, invalidate } = useThree();
  const explode = useRef<ExplodeUniform>({ value: 0 });
  const look = useRef(new THREE.Vector3());
  const ready = useRef(false);

  const { object, offset, materials } = useMemo(() => {
    const root = scene.clone(true);
    const meshes: THREE.Mesh[] = [];
    root.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) meshes.push(node as THREE.Mesh);
    });

    const arrays = meshes.map((mesh) => ({
      positions: mesh.geometry.getAttribute("position").array,
      indices: mesh.geometry.getIndex()!.array,
    }));
    const partitions = arrays.map((a) => partition(a));
    const board = footprint(partitions.map((p) => p.parts));

    const materials: THREE.MeshStandardMaterial[] = [];
    meshes.forEach((mesh, i) => {
      const geometry = mesh.geometry.clone();
      const { offset: o, delay } = explodeAttributes(arrays[i], partitions[i], board);
      geometry.setAttribute("aOffset", new THREE.BufferAttribute(o, 3));
      geometry.setAttribute("aDelay", new THREE.BufferAttribute(delay, 1));
      mesh.geometry = geometry;

      const material = (mesh.material as THREE.MeshStandardMaterial).clone();
      // The PCB ships as alpha *blend*, which sorts badly against its own parts once
      // they separate. A cut-out is exact for a board with drilled holes.
      if (material.transparent) {
        material.transparent = false;
        material.alphaTest = 0.5;
        material.depthWrite = true;
      }
      material.envMapIntensity = 1.1;
      materials.push(material);
      mesh.material = material;
      mesh.castShadow = true;
      // Displaced vertices leave the original bounds; culling would clip them.
      mesh.frustumCulled = false;
    });

    // Sit the board on the ground at the origin.
    return { object: root, offset: [-board.centre[0], -board.floor, -board.centre[1]] as const, materials };
  }, [scene]);

  // Hooked up after render: the shader reads the animated value through the ref.
  useEffect(() => {
    for (const material of materials) withExplode(material, explode);
    invalidate();
  }, [materials, invalidate]);

  // The camera and the explode follow the scroll, damped; reduced motion jumps straight
  // to the shot. Settled means no further frames are requested.
  useFrame((_, delta) => {
    const target = shotAt(progress.current ?? 0);
    const goal = new THREE.Vector3(...target.pos);
    const goalLook = new THREE.Vector3(...target.look);
    // First frame (and reduced motion) jumps straight to the shot; after that, damp.
    const k = !ready.current || !live ? 1 : 1 - Math.exp(-delta * 4.5);
    ready.current = true;
    camera.position.lerp(goal, k);
    look.current.lerp(goalLook, k);
    camera.lookAt(look.current);
    const e = explode.current;
    e.value += (target.explode - e.value) * k;

    const settled = camera.position.distanceToSquared(goal) < 1e-8 && Math.abs(target.explode - e.value) < 1e-4;
    if (!settled) invalidate();
  });

  return <primitive object={object} position={offset} />;
}

export default function BoardScene({
  progress,
  live,
  onReady,
}: {
  /** Sequence progress 0..1, written by the scroll handler; read every frame. */
  progress: RefObject<number>;
  /** False under reduced motion: no easing, one still frame per change. */
  live: boolean;
  onReady?: () => void;
}) {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 1.75]}
      camera={{ fov: 30, near: 0.01, far: 10, position: SHOTS[0].pos }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        onReady?.();
      }}
      aria-hidden
    >
      <Invalidator progress={progress} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[0.6, 1.2, 0.4]} intensity={1.6} castShadow={false} />
      <Environment resolution={256} frames={1}>
        {/* A studio: a broad soft key, a warm copper-toned rim, a cool fill. */}
        <Lightformer form="rect" intensity={2.4} color="#f5f6f1" position={[0, 2.5, 1]} scale={[4, 2, 1]} />
        <Lightformer form="rect" intensity={1.6} color="#e9b48f" position={[-3, 0.6, -1]} rotation={[0, Math.PI / 2, 0]} scale={[3, 1, 1]} />
        <Lightformer form="rect" intensity={0.9} color="#c9d6e0" position={[3, 0.8, 1]} rotation={[0, -Math.PI / 2, 0]} scale={[3, 1.5, 1]} />
        <Lightformer form="ring" intensity={1.2} color="#ffffff" position={[0.5, 1.5, 2]} scale={0.8} />
      </Environment>
      {/* One boundary, so the single-frame shadow is cast by a board that is there. */}
      <Suspense fallback={null}>
        <Board progress={progress} live={live} />
        <ContactShadows position={[0, 0, 0]} scale={1.2} blur={2.4} opacity={0.55} far={0.35} resolution={512} color="#12171b" frames={1} />
      </Suspense>
    </Canvas>
  );
}

/** Redraws when the page scrolls; the scroll handler itself lives outside the canvas. */
function Invalidator({ progress }: { progress: RefObject<number> }) {
  const { invalidate } = useThree();
  useEffect(() => {
    const redraw = () => invalidate();
    window.addEventListener("scroll", redraw, { passive: true });
    window.addEventListener("resize", redraw);
    return () => {
      window.removeEventListener("scroll", redraw);
      window.removeEventListener("resize", redraw);
    };
  }, [invalidate, progress]);
  return null;
}

useGLTF.preload(MODEL_URL);
