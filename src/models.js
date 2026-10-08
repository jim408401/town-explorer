import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { celFrom } from './materials.js';

/**
 * Optional GLB models from public/models/. Model files are not committed (see
 * public/models/CREDITS.md for sources and licence), so every model is optional:
 * when a file is missing its slot keeps the procedural fallback.
 */

// Target height in metres for props; buildings are fitted to their lot instead
const TARGET_HEIGHT = {
  'bench-01': 0.95,
  'trash-bin-01': 1.0,
  'flower-planter-01': 0.9,
  'street-lamp-01': 5.5,
  'bus-shelter-01': 2.8,
  'traffic-light-01': 5.0,
  'street-sign-01': 2.9,
  'telegraph-pole': 8.5,
  'car-sedan-01': 1.5,
  'taxi-01': 1.6,
};
// Extra yaw per model so its front faces local +z like the procedural pieces
const YAW_FIX = {};

export async function loadModels(town) {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('./draco/');
  loader.setDRACOLoader(draco);

  const names = [...new Set(town.slots.map((s) => s.model))];
  const prepared = {};
  await Promise.all(
    names.map(async (name) => {
      const url = `./models/${name}.glb`;
      try {
        const res = await fetch(url);
        // Dev servers answer missing files with index.html; treat that as "not there"
        if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return;
        const gltf = await loader.parseAsync(await res.arrayBuffer(), './models/');
        prepared[name] = prepare(gltf.scene);
      } catch (err) {
        console.warn(`Could not load ${url}`, err);
      }
    })
  );
  draco.dispose();

  const loaded = Object.keys(prepared);
  for (const slot of town.slots) {
    const src = prepared[slot.model];
    if (!src) continue;
    const obj = place(src, slot);
    town.group.add(obj);
    if (slot.fallback) slot.fallback.removeFromParent();
    if (slot.collider) addCollider(town.colliders, obj);
  }
  return loaded;
}

/** Converts materials to the cel look, enables shadows and measures the model once. */
function prepare(scene) {
  scene.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(celFrom) : celFrom(o.material);
    o.castShadow = true;
    o.receiveShadow = true;
  });
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  return { scene, size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()), min: box.min.clone() };
}

function place({ scene, size, center, min }, slot) {
  const inner = scene.clone(true);
  let scale;
  if (slot.kind === 'building') {
    // Fit the footprint inside the lot
    scale = Math.min(slot.w / size.x, slot.d / size.z);
  } else {
    scale = (TARGET_HEIGHT[slot.model] ?? size.y) / size.y;
  }
  inner.scale.setScalar(scale);
  // Centre on the slot and stand on the ground
  inner.position.set(-center.x * scale, -min.y * scale, -center.z * scale);
  const holder = new THREE.Group();
  holder.add(inner);
  holder.position.set(slot.x, slot.y, slot.z);
  holder.rotation.y = slot.rotation + (YAW_FIX[slot.model] ?? 0);
  holder.userData.model = slot.model;
  holder.userData.footprint = { x: size.x * scale, z: size.z * scale };
  return holder;
}

function addCollider(colliders, obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  colliders.push({ type: 'box', minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z });
}
