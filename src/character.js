import * as THREE from 'three';
import { faceted, mesh } from './materials.js';

/**
 * Builds a chubby low-poly villager. Everything is procedural so it can later be
 * swapped for a glTF model: callers only rely on `root`, `animate()` and `height`.
 */
export function createCharacter({ body = 0xf28c6b, skin = 0xffd9b8, hat = 0x4f6db3, pants = 0x55606e } = {}) {
  const root = new THREE.Group();
  const rig = new THREE.Group(); // bobbing happens on the rig so root.position stays clean
  root.add(rig);

  const torso = mesh(faceted(new THREE.SphereGeometry(0.62, 8, 6)), body);
  torso.scale.set(1, 1.05, 0.9);
  torso.position.y = 1.0;
  rig.add(torso);

  const head = new THREE.Group();
  head.position.y = 1.85;
  const skull = mesh(faceted(new THREE.SphereGeometry(0.5, 8, 6)), skin);
  head.add(skull);
  for (const sx of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.07, 6, 4), 0x2b2b2b, { cast: false });
    eye.position.set(sx * 0.18, 0.05, 0.45);
    head.add(eye);
    const cheek = mesh(new THREE.SphereGeometry(0.08, 6, 4), 0xff9e9e, { cast: false });
    cheek.position.set(sx * 0.3, -0.1, 0.38);
    head.add(cheek);
  }
  const cap = mesh(faceted(new THREE.SphereGeometry(0.53, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2)), hat);
  cap.position.y = 0.06;
  const brim = mesh(faceted(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 8)), hat);
  brim.scale.set(1, 1, 1.4);
  brim.position.set(0, 0.08, 0.45);
  head.add(cap, brim);
  rig.add(head);

  const limbs = {};
  for (const [name, x] of [
    ['legL', -0.25],
    ['legR', 0.25],
  ]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.55, 0);
    const leg = mesh(faceted(new THREE.CylinderGeometry(0.14, 0.12, 0.5, 6)), pants);
    leg.position.y = -0.25;
    const foot = mesh(new THREE.BoxGeometry(0.26, 0.14, 0.36), 0x4a3b30);
    foot.position.set(0, -0.5, 0.06);
    pivot.add(leg, foot);
    rig.add(pivot);
    limbs[name] = pivot;
  }
  for (const [name, x] of [
    ['armL', -0.62],
    ['armR', 0.62],
  ]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.3, 0);
    const arm = mesh(faceted(new THREE.CylinderGeometry(0.11, 0.1, 0.55, 6)), body);
    arm.position.y = -0.27;
    const hand = mesh(faceted(new THREE.SphereGeometry(0.12, 6, 4)), skin);
    hand.position.y = -0.58;
    pivot.add(arm, hand);
    pivot.rotation.z = x < 0 ? -0.15 : 0.15;
    rig.add(pivot);
    limbs[name] = pivot;
  }

  let phase = 0;
  /** speed01: 0 = idle, 1 = walking, ~1.8 = running */
  function animate(dt, speed01, time) {
    if (speed01 > 0.05) {
      phase += dt * (6 + speed01 * 4);
      const swing = Math.sin(phase) * 0.6 * Math.min(speed01, 1.4);
      limbs.legL.rotation.x = swing;
      limbs.legR.rotation.x = -swing;
      limbs.armL.rotation.x = -swing * 0.8;
      limbs.armR.rotation.x = swing * 0.8;
      rig.position.y = Math.abs(Math.sin(phase)) * 0.12 * speed01;
    } else {
      // Ease limbs back and breathe a little while idle
      for (const l of Object.values(limbs)) l.rotation.x *= 0.85;
      rig.position.y = Math.sin(time * 2) * 0.03;
    }
  }

  return { root, animate, height: 2.4 };
}
