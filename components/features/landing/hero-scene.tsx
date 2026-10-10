"use client";

import { Environment, Lightformer, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, Noise } from "@react-three/postprocessing";
import { Suspense, useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";

import { MODEL_URL } from "./board-model";
import { boardMaterial } from "./board-material";

/**
 * The hero: the gatekeeper sees through it.
 *
 * The CC0 board lies low-lit on the ink ground. A copper scan line crosses it, and the
 * line is a real boundary: behind it the board becomes its X-ray — every component
 * edge as a copper schematic over a dark body — and ahead of it the board is still the
 * photograph. The line crosses, holds, and crosses back. The pointer turns the board a
 * few degrees.
 *
 * How, cheaply:
 *
 * - Two **clipping planes** that share one position split the scene. The photoreal
 *   board keeps what lies ahead of the line; the X-ray keeps what lies behind it.
 * - The X-ray is `EdgesGeometry` (creases over 28°, so a CAD drawing rather than a
 *   triangle mesh) over a dark body that hides the far side's edges.
 * - The line and the X-ray are drawn brighter than white, so **bloom** picks out only
 *   them; nothing else on the board is bright enough to glow.
 *
 * Loops only while on screen (`active`); reduced motion parks the line mid-board and
 * draws one still frame.
 */

/** Seconds per phase of the loop: rest, cross, hold, cross back. */
const PHASES = [1.4, 2.6, 1.8, 2.6] as const;
const CYCLE = PHASES.reduce((a, b) => a + b, 0);
/** World x the line travels between (the turned board spans about ±0.24). */
const FROM = -0.3;
const TO = 0.3;

const COPPER = new THREE.Color("#d9783f");
/** Over-bright copper for the parts that should bloom. */
const HOT = COPPER.clone().multiplyScalar(3.2);

const smooth = (x: number) => x * x * (3 - 2 * x);

/** Where the line is at time `t`, in world x. */
function lineAt(t: number): number {
  let p = t % CYCLE;
  const [rest, cross, hold] = PHASES;
  if (p < rest) return FROM;
  p -= rest;
  if (p < cross) return FROM + (TO - FROM) * smooth(p / cross);
  p -= cross;
  if (p < hold) return TO;
  p -= hold;
  return TO - (TO - FROM) * smooth(p / PHASES[3]);
}

function XrayBoard({ live, pointer }: { live: boolean; pointer: RefObject<{ x: number; y: number }> }) {
  const { scene } = useGLTF(MODEL_URL);
  const { gl, invalidate } = useThree();
  const group = useRef<THREE.Group>(null);
  const beam = useRef<THREE.Group>(null);

  // Ahead of the line: x > line. Behind it: x < line. Both move together each frame.
  const { object, planes } = useMemo(() => {
    // Ahead of the line keeps x > line; behind it keeps x < line. Moved every frame.
    const planes = { ahead: new THREE.Plane(new THREE.Vector3(1, 0, 0), 0), behind: new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0) };
    const root = scene.clone(true);
    const box = new THREE.Box3().setFromObject(root);
    const centre = box.getCenter(new THREE.Vector3());
    root.position.set(-centre.x, -box.min.y, -centre.z);
    const maxAniso = gl.capabilities.getMaxAnisotropy();

    const body = new THREE.MeshBasicMaterial({
      color: "#0d1114",
      side: THREE.DoubleSide,
      clippingPlanes: [planes.behind],
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const lines = new THREE.LineBasicMaterial({
      color: HOT,
      transparent: true,
      opacity: 0.9,
      toneMapped: false,
      clippingPlanes: [planes.behind],
    });

    const meshes: THREE.Mesh[] = [];
    root.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) meshes.push(node as THREE.Mesh);
    });
    for (const mesh of meshes) {
      const photo = boardMaterial(mesh.material as THREE.MeshStandardMaterial, maxAniso);
      photo.clippingPlanes = [planes.ahead];
      mesh.material = photo;

      // The X-ray rides on the same transform as the mesh it draws.
      const xrayBody = new THREE.Mesh(mesh.geometry, body);
      const xrayLines = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 28), lines);
      mesh.add(xrayBody, xrayLines);
    }

    const holder = new THREE.Group();
    holder.add(root);
    return { object: holder, planes };
  }, [scene, gl]);

  useEffect(() => invalidate(), [object, invalidate]);

  useFrame(({ clock }, delta) => {
    const x = live ? lineAt(clock.elapsedTime) : 0.02;
    planes.ahead.setComponents(1, 0, 0, -x);
    planes.behind.setComponents(-1, 0, 0, x);
    if (beam.current) {
      beam.current.position.x = x;
      // The line is only lit while it is over the board.
      beam.current.visible = Math.abs(x) < 0.27;
    }

    const g = group.current;
    if (!g) return;
    const p = pointer.current ?? { x: 0, y: 0 };
    const k = live ? 1 - Math.exp(-delta * 3) : 1;
    g.rotation.y += (-0.42 + p.x * 0.1 - g.rotation.y) * k;
    g.rotation.x += (p.y * 0.04 - g.rotation.x) * k;
  });

  return (
    <>
      <group ref={group} rotation={[0, -0.42, 0]}>
        <primitive object={object} />
      </group>
      {/* The scan line: a hairline on the bench, with a faint skirt of light rising off it. */}
      <group ref={beam}>
        <mesh position={[0, 0.012, 0]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[0.62, 0.024]} />
          <meshBasicMaterial
            color={HOT}
            transparent
            opacity={0.16}
            toneMapped={false}
            side={THREE.DoubleSide}
            depthWrite={false}
            alphaMap={BEAM_FADE}
          />
        </mesh>
        <mesh position={[0, 0.0005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.0022, 0.62]} />
          <meshBasicMaterial color={HOT} toneMapped={false} />
        </mesh>
      </group>
    </>
  );
}

/** Vertical fade so the beam is brightest at the bench and dissolves upward. */
const BEAM_FADE = (() => {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 64);
  gradient.addColorStop(0, "#000");
  gradient.addColorStop(0.7, "#333");
  gradient.addColorStop(1, "#fff");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 4, 64);
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
})();

/** Desktop: low and wide, behind the copy. Phone: higher and further back, the whole board in a portrait frame. */
const FRAMING = {
  wide: { position: [0.24, 0.74, 0.56] as [number, number, number], look: [0.03, 0, 0.02] as [number, number, number], fov: 24 },
  compact: { position: [0.2, 0.66, 0.5] as [number, number, number], look: [0, 0.02, 0.01] as [number, number, number], fov: 30 },
};

export default function HeroScene({
  live,
  active,
  compact = false,
  onReady,
}: {
  /** Portrait phone framing and a lighter render. */
  compact?: boolean;
  /** False under reduced motion: one still frame. */
  live: boolean;
  /** False while the hero is off screen: the loop stops. */
  active: boolean;
  onReady?: () => void;
}) {
  const pointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!live) return;
    const move = (e: PointerEvent) => {
      pointer.current = { x: (e.clientX / window.innerWidth) * 2 - 1, y: (e.clientY / window.innerHeight) * 2 - 1 };
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, [live]);

  return (
    <Canvas
      frameloop={live && active ? "always" : "demand"}
      key={compact ? "compact" : "wide"}
      dpr={compact ? [1, 1.5] : [1, 1.75]}
      camera={{ fov: (compact ? FRAMING.compact : FRAMING.wide).fov, near: 0.01, far: 10, position: (compact ? FRAMING.compact : FRAMING.wide).position }}
      gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
      onCreated={({ gl, camera }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.25;
        gl.localClippingEnabled = true;
        camera.lookAt(...(compact ? FRAMING.compact : FRAMING.wide).look);
        onReady?.();
      }}
      aria-hidden
    >
      {/* Opaque ink, matching the section, so the post-processing has a ground to work on. */}
      <color attach="background" args={["#12171b"]} />
      <ambientLight intensity={0.12} />
      {/* A low raking key from the left: components throw long shadows across the board. */}
      <directionalLight position={[-1.2, 0.55, 0.4]} intensity={3.2} color="#f5f6f1" />
      {/* A cool kicker from behind so the far edges of parts separate from the ground. */}
      <directionalLight position={[0.6, 0.4, -1.2]} intensity={1.2} color="#9fb4c4" />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2} color="#f5f6f1" position={[0, 2.5, 0.5]} scale={[3, 1, 1]} />
        <Lightformer form="rect" intensity={2.4} color="#d9783f" position={[3, 0.4, -1]} rotation={[0, -Math.PI / 2, 0]} scale={[3, 0.6, 1]} />
        <Lightformer form="rect" intensity={0.6} color="#8fa6b8" position={[-3, 0.8, 1]} rotation={[0, Math.PI / 2, 0]} scale={[3, 1, 1]} />
      </Environment>
      <Suspense fallback={null}>
        <XrayBoard live={live} pointer={pointer} />
      </Suspense>
      <EffectComposer multisampling={compact ? 0 : 4}>
        <Bloom mipmapBlur intensity={1.15} luminanceThreshold={1} luminanceSmoothing={0.15} radius={0.7} />
        <Noise premultiply opacity={0.35} />
      </EffectComposer>
    </Canvas>
  );
}
