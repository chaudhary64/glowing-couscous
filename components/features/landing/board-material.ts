import * as THREE from "three";

/**
 * The board's surfaces, rebuilt from the glTF's own maps as a physical material.
 *
 * Three things the stock import gets wrong for a board seen at a glancing angle:
 *
 * - **Texture filtering.** Without anisotropy, every map smears to mush as the board
 *   tilts away from the camera, which is exactly the angle both scenes use. It is set
 *   to the most the GPU offers.
 * - **The lacquer.** A real PCB is coated in solder mask, a thin gloss over the copper
 *   and fibreglass. A clearcoat layer gives the board that second, sharper reflection.
 * - **Contact shadow.** Poly Haven packs ambient occlusion into the red channel of the
 *   same "ARM" texture the glTF uses for roughness and metalness, but glTF has nowhere
 *   to say so and the import leaves it unused. Wiring it back puts the dark seams
 *   between components where a real board has them.
 *
 * The PCB itself ships as alpha *blend*, which sorts badly against its own parts; a
 * cut-out is exact for a board with drilled holes.
 */
export function boardMaterial(source: THREE.MeshStandardMaterial, maxAnisotropy: number): THREE.MeshPhysicalMaterial {
  const maps = [source.map, source.normalMap, source.roughnessMap, source.metalnessMap, source.aoMap, source.alphaMap];
  for (const map of maps) {
    if (map) {
      map.anisotropy = maxAnisotropy;
      map.needsUpdate = true;
    }
  }
  const cutOut = source.transparent || source.alphaMap !== null;
  return new THREE.MeshPhysicalMaterial({
    name: source.name,
    color: source.color,
    map: source.map,
    normalMap: source.normalMap,
    normalScale: source.normalScale,
    roughnessMap: source.roughnessMap,
    roughness: source.roughness,
    metalnessMap: source.metalnessMap,
    metalness: source.metalness,
    aoMap: source.aoMap ?? source.roughnessMap,
    aoMapIntensity: 1,
    alphaMap: source.alphaMap,
    side: source.side,
    transparent: false,
    alphaTest: cutOut ? 0.5 : 0,
    depthWrite: true,
    clearcoat: 0.55,
    clearcoatRoughness: 0.22,
    envMapIntensity: 1,
  });
}
