import * as THREE from 'three';

/**
 * Uniforms shared by every world material:
 * - uCurveCenter / uCurvature bend the world downwards away from the player,
 *   giving the "tiny planet" horizon of the reference game.
 * - uCutCam / uCutTarget / uCutRadius discard fragments between the camera and
 *   the player so buildings never hide the character.
 */
export const world = {
  uCurveCenter: { value: new THREE.Vector3() },
  uCurvature: { value: 0.0035 },
  uCutCam: { value: new THREE.Vector3() },
  uCutTarget: { value: new THREE.Vector3() },
  uCutRadius: { value: 1.6 },
};

const VERT_PARS = /* glsl */ `
uniform vec3 uCurveCenter;
uniform float uCurvature;
varying vec3 vCutWorld;
`;

// Replaces three's <project_vertex> chunk: same maths plus the planet bend
const VERT_PROJECT = /* glsl */ `
vec4 mvPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
vec4 curvedWorld = modelMatrix * mvPosition;
vCutWorld = curvedWorld.xyz;
vec2 fromCenter = curvedWorld.xz - uCurveCenter.xz;
curvedWorld.y -= dot(fromCenter, fromCenter) * uCurvature;
mvPosition = viewMatrix * curvedWorld;
gl_Position = projectionMatrix * mvPosition;
`;

const FRAG_PARS = /* glsl */ `
varying vec3 vCutWorld;
uniform vec3 uCutCam;
uniform vec3 uCutTarget;
uniform float uCutRadius;
`;

const FRAG_CUTOUT = /* glsl */ `
if (vCutWorld.y > 0.5) {
  vec3 seg = uCutTarget - uCutCam;
  float t = dot(vCutWorld - uCutCam, seg) / dot(seg, seg);
  if (t > 0.0 && t < 0.88 && distance(vCutWorld, uCutCam + seg * t) < uCutRadius * (0.4 + t)) discard;
}
`;

/** Adds planet curvature and the see-through cutout to any built-in material. */
export function worldify(material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, world);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', VERT_PROJECT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('void main() {', `void main() {\n${FRAG_CUTOUT}`);
  };
  return material;
}

/**
 * Material used for the outline pre-pass: view-space normal in RGB and linear
 * depth in A. It shares the curvature and cutout so lines match the image.
 */
export function createNormalDepthMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { ...world, uFar: { value: 200 } },
    vertexShader: /* glsl */ `
      ${VERT_PARS}
      varying vec3 vNormalView;
      varying float vDepth;
      void main() {
        vec3 transformed = position;
        ${VERT_PROJECT}
        vNormalView = normalize(normalMatrix * normal);
        vDepth = -mvPosition.z;
      }
    `,
    fragmentShader: /* glsl */ `
      ${FRAG_PARS}
      uniform float uFar;
      varying vec3 vNormalView;
      varying float vDepth;
      void main() {
        ${FRAG_CUTOUT}
        gl_FragColor = vec4(normalize(vNormalView) * 0.5 + 0.5, vDepth / uFar);
      }
    `,
  });
}

// Two-tone gradient: a flat lit colour and a flat shadow colour, like cel animation
const gradient = new THREE.DataTexture(new Uint8Array([150, 255]), 2, 1, THREE.RedFormat);
gradient.minFilter = THREE.NearestFilter;
gradient.magFilter = THREE.NearestFilter;
gradient.needsUpdate = true;

const cache = new Map();

/** Cached cel-shaded material for a colour (and optional texture). */
export function cel(color, map = null) {
  const key = `${new THREE.Color(color).getHexString()}|${map ? map.uuid : ''}`;
  if (!cache.has(key)) {
    cache.set(key, worldify(new THREE.MeshToonMaterial({ color, map, gradientMap: gradient })));
  }
  return cache.get(key);
}

/** Converts a material from a loaded model into the cel look, keeping its colour and texture. */
export function celFrom(original) {
  return worldify(
    new THREE.MeshToonMaterial({
      color: original.color ? original.color.clone() : new THREE.Color(0xffffff),
      map: original.map ?? null,
      vertexColors: original.vertexColors ?? false,
      transparent: original.transparent ?? false,
      opacity: original.opacity ?? 1,
      alphaTest: original.alphaTest ?? 0,
      side: original.side ?? THREE.FrontSide,
      gradientMap: gradient,
    })
  );
}

/** Non-indexed geometry + recomputed normals = flat, faceted shading */
export function faceted(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.computeVertexNormals();
  return g;
}

/** Seeded PRNG (mulberry32) so the town layout is identical on every load */
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

export function mesh(geometry, color, { cast = true, receive = true, map = null } = {}) {
  const m = new THREE.Mesh(geometry, cel(color, map));
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

const signCache = new Map();

/**
 * Canvas texture for shop signs. `vertical` stacks the characters top to bottom
 * like the hanging signs on Taiwanese and Japanese streets.
 */
export function signTexture(text, { bg = '#f4f1e6', fg = '#2f8f6b', vertical = false, border = '#2a3333' } = {}) {
  const key = `${text}|${bg}|${fg}|${vertical}`;
  if (signCache.has(key)) return signCache.get(key);
  const chars = [...text];
  const cell = 128;
  const c = document.createElement('canvas');
  c.width = vertical ? cell : cell * chars.length;
  c.height = vertical ? cell * chars.length : cell;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.lineWidth = 10;
  g.strokeStyle = border;
  g.strokeRect(5, 5, c.width - 10, c.height - 10);
  g.fillStyle = fg;
  g.font = `bold ${cell * 0.68}px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  chars.forEach((ch, i) => {
    const x = vertical ? cell / 2 : cell * (i + 0.5);
    const y = vertical ? cell * (i + 0.5) : cell / 2;
    g.fillText(ch, x, y + cell * 0.04);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  signCache.set(key, tex);
  return tex;
}
