"use client";

import { Environment, Lightformer, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";

import { MODEL_URL } from "./board-model";

/**
 * The hero: the gatekeeper's eye.
 *
 * The same CC0 board as the assay sequence, large and low-lit on the ink ground, with a
 * copper scan line crossing it. Where the line passes, metal answers: the shader lifts
 * each fragment by how metallic the model's own ARM map says it is, so solder, pins and
 * the heatsink flare copper while the resin board barely does. Between sweeps the board
 * rests, and the pointer turns it a few degrees.
 *
 * Runs a continuous loop only while on screen (`active`); under reduced motion it draws
 * one still frame with the line parked mid-board.
 */

type Uniform<T> = { value: T };
interface ScanUniforms {
  uScan: Uniform<number>;
  uScanWidth: Uniform<number>;
  uScanColor: Uniform<THREE.Color>;
}

/** Sweep period and the share of it the line is moving (the rest is a pause). */
const SWEEP_S = 6.5;
const MOVING = 0.55;
/** Board-space x range the line travels (the board spans about ±0.2). */
const FROM = -0.32;
const TO = 0.32;

function withScan(material: THREE.MeshStandardMaterial, uniforms: RefObject<ScanUniforms>) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms.current);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vScanPos;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvScanPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vScanPos;
uniform float uScan;
uniform float uScanWidth;
uniform vec3 uScanColor;`,
      )
      .replace(
        "#include <dithering_fragment>",
        `float d = (vScanPos.x - uScan) / uScanWidth;
float glow = exp(-d * d);                       // the soft band
float edge = exp(-d * d * 180.0);              // the hard line at its centre
float metal = clamp(metalnessFactor, 0.0, 1.0);
gl_FragColor.rgb += uScanColor * (glow * (0.06 + 1.6 * metal) + edge * 0.55);
#include <dithering_fragment>`,
      );
  };
  material.customProgramCacheKey = () => "board-scan";
  material.needsUpdate = true;
}

function ScannedBoard({ live, pointer }: { live: boolean; pointer: RefObject<{ x: number; y: number }> }) {
  const { scene } = useGLTF(MODEL_URL);
  const { invalidate } = useThree();
  const group = useRef<THREE.Group>(null);
  const uniforms = useRef<ScanUniforms>({
    uScan: { value: live ? FROM : 0.02 },
    uScanWidth: { value: 0.045 },
    uScanColor: { value: new THREE.Color("#d9783f") },
  });

  const { object, materials } = useMemo(() => {
    const root = scene.clone(true);
    const box = new THREE.Box3().setFromObject(root);
    const centre = box.getCenter(new THREE.Vector3());
    root.position.set(-centre.x, -box.min.y, -centre.z);
    const materials: THREE.MeshStandardMaterial[] = [];
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = (mesh.material as THREE.MeshStandardMaterial).clone();
      if (material.transparent) {
        material.transparent = false;
        material.alphaTest = 0.5;
        material.depthWrite = true;
      }
      material.envMapIntensity = 0.9;
      materials.push(material);
      mesh.material = material;
    });
    const holder = new THREE.Group();
    holder.add(root);
    return { object: holder, materials };
  }, [scene]);

  useEffect(() => {
    for (const material of materials) withScan(material, uniforms);
    invalidate();
  }, [materials, invalidate]);

  useFrame(({ clock }, delta) => {
    const g = group.current;
    if (!g) return;
    if (live) {
      const phase = (clock.elapsedTime % SWEEP_S) / SWEEP_S;
      const t = Math.min(1, phase / MOVING);
      const eased = t * t * (3 - 2 * t);
      uniforms.current.uScan.value = phase < MOVING ? FROM + (TO - FROM) * eased : TO + 1; // parked off-board
    }
    // A few degrees toward the pointer, damped.
    const p = pointer.current ?? { x: 0, y: 0 };
    const k = live ? 1 - Math.exp(-delta * 3) : 1;
    g.rotation.y += (-0.38 + p.x * 0.12 - g.rotation.y) * k;
    g.rotation.x += (p.y * 0.05 - g.rotation.x) * k;
  });

  return (
    <group ref={group} rotation={[0, -0.38, 0]}>
      <primitive object={object} />
    </group>
  );
}

export default function HeroScene({
  live,
  active,
  onReady,
}: {
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
      dpr={[1, 1.75]}
      camera={{ fov: 26, near: 0.01, far: 10, position: [0.2, 0.78, 0.5] }}
      gl={{ antialias: true, powerPreference: "high-performance", alpha: true }}
      onCreated={({ gl, camera }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 0.95;
        camera.lookAt(0.02, 0, 0.02);
        onReady?.();
      }}
      aria-hidden
    >
      <ambientLight intensity={0.08} />
      {/* Low raking key from the left so components throw long shadows across the board. */}
      <directionalLight position={[-1.2, 0.5, 0.3]} intensity={1.4} color="#f5f6f1" />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={1.2} color="#f5f6f1" position={[0, 2.5, 0.5]} scale={[3, 1, 1]} />
        <Lightformer form="rect" intensity={2.2} color="#d9783f" position={[3, 0.4, -1]} rotation={[0, -Math.PI / 2, 0]} scale={[3, 0.6, 1]} />
        <Lightformer form="rect" intensity={0.6} color="#8fa6b8" position={[-3, 0.8, 1]} rotation={[0, Math.PI / 2, 0]} scale={[3, 1, 1]} />
      </Environment>
      <Suspense fallback={null}>
        <ScannedBoard live={live} pointer={pointer} />
      </Suspense>
    </Canvas>
  );
}
