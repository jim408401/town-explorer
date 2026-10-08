import * as THREE from 'three';

// 3-step gradient so MeshToonMaterial gets banded, cartoon-style shading
const gradient = new THREE.DataTexture(new Uint8Array([90, 170, 255]), 3, 1, THREE.RedFormat);
gradient.minFilter = THREE.NearestFilter;
gradient.magFilter = THREE.NearestFilter;
gradient.needsUpdate = true;

const cache = new Map();

/**
 * Shared uniforms for the "see-through" cutout: fragments that sit between the
 * camera and the player get discarded, so houses never hide the character.
 */
export const cutout = {
  uCutCam: { value: new THREE.Vector3() },
  uCutTarget: { value: new THREE.Vector3() },
  uCutRadius: { value: 2.2 },
};

function addCutout(material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cutout);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCutWorld;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvCutWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vCutWorld;\nuniform vec3 uCutCam;\nuniform vec3 uCutTarget;\nuniform float uCutRadius;'
      )
      .replace(
        'void main() {',
        `void main() {
  if (vCutWorld.y > 0.4) {
    vec3 seg = uCutTarget - uCutCam;
    float t = dot(vCutWorld - uCutCam, seg) / dot(seg, seg);
    if (t > 0.0 && t < 0.9 && distance(vCutWorld, uCutCam + seg * t) < uCutRadius * t) discard;
  }`
      );
  };
  return material;
}

export function toon(color) {
  const key = new THREE.Color(color).getHexString();
  if (!cache.has(key)) {
    cache.set(key, addCutout(new THREE.MeshToonMaterial({ color, gradientMap: gradient })));
  }
  return cache.get(key);
}

// Non-indexed geometry + recomputed normals = flat, faceted low-poly shading
export function faceted(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.computeVertexNormals();
  return g;
}

// Seeded PRNG (mulberry32) so the town layout is identical on every load
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mesh(geometry, color, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geometry, toon(color));
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
