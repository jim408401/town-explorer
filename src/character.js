import * as THREE from 'three';
import { mesh } from './materials.js';

/**
 * Builds an anime-style kid from simple shapes; the ink outline pass gives it
 * the hand-drawn look. Callers only rely on `root`, `animate()` and `height`,
 * so this can later be swapped for a glTF model.
 */
export function createCharacter({
  skin = 0xf3d2b5,
  hair = 0x23272b,
  shirt = 0xf4f4ee,
  shorts = 0x23272b,
  shoes = 0x5cc8b0,
  bag = 0xc8463c,
  hairStyle = 'bob',
} = {}) {
  const root = new THREE.Group();
  const rig = new THREE.Group();
  root.add(rig);

  // ---- Torso ----
  const torso = new THREE.Group();
  torso.position.y = 0.95;
  rig.add(torso);
  const shirtMesh = mesh(new THREE.CylinderGeometry(0.27, 0.32, 0.62, 12), shirt);
  shirtMesh.position.y = 0.3;
  const shortsMesh = mesh(new THREE.CylinderGeometry(0.3, 0.33, 0.32, 12), shorts);
  shortsMesh.position.y = -0.08;
  const neck = mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 8), skin);
  neck.position.y = 0.66;
  torso.add(shirtMesh, shortsMesh, neck);

  if (bag !== null) {
    const pouch = mesh(new THREE.BoxGeometry(0.34, 0.3, 0.12), bag);
    pouch.position.set(-0.22, 0.02, -0.3);
    pouch.rotation.y = 0.25;
    const flap = mesh(new THREE.BoxGeometry(0.36, 0.14, 0.14), bag);
    flap.position.set(-0.22, 0.13, -0.3);
    flap.rotation.y = 0.25;
    torso.add(pouch, flap);
    // Strap across the chest and back
    const strapFront = mesh(new THREE.BoxGeometry(0.06, 0.8, 0.04), 0x7a2a25);
    strapFront.position.set(0.0, 0.33, 0.29);
    strapFront.rotation.z = -0.62;
    const strapBack = strapFront.clone();
    strapBack.position.z = -0.29;
    torso.add(strapFront, strapBack);
  }

  // ---- Head ----
  const head = new THREE.Group();
  head.position.y = 1.86;
  rig.add(head);
  const skull = mesh(new THREE.SphereGeometry(0.27, 16, 12), skin);
  skull.scale.set(1, 1.08, 1);
  head.add(skull);
  for (const sx of [-1, 1]) {
    const eye = mesh(new THREE.CapsuleGeometry(0.025, 0.05, 2, 6), 0x1d2a2b, { cast: false });
    eye.position.set(sx * 0.1, 0.0, 0.25);
    head.add(eye);
  }
  const hairCap = mesh(new THREE.SphereGeometry(0.31, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), hair);
  hairCap.position.y = 0.03;
  hairCap.rotation.x = -0.25;
  head.add(hairCap);
  if (hairStyle === 'bob') {
    const back = mesh(new THREE.SphereGeometry(0.31, 14, 10), hair);
    back.scale.set(1.02, 0.95, 0.85);
    back.position.set(0, -0.02, -0.06);
    head.add(back);
    for (const sx of [-1, 1]) {
      const side = mesh(new THREE.BoxGeometry(0.1, 0.32, 0.26), hair);
      side.position.set(sx * 0.26, -0.08, -0.02);
      head.add(side);
    }
  } else if (hairStyle === 'cap') {
    const brim = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 12), hair);
    brim.scale.set(1, 1, 1.5);
    brim.position.set(0, 0.12, 0.26);
    head.add(brim);
  } else if (hairStyle === 'hat') {
    const brim = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.03, 16), hair);
    brim.position.y = 0.16;
    const crown = mesh(new THREE.CylinderGeometry(0.27, 0.3, 0.2, 14), hair);
    crown.position.y = 0.26;
    head.add(brim, crown);
  }
  // Bangs
  for (let i = -2; i <= 2; i++) {
    const bang = mesh(new THREE.ConeGeometry(0.06, 0.18, 4), hair, { cast: false });
    bang.position.set(i * 0.075, 0.12, 0.25);
    bang.rotation.x = Math.PI + 0.35;
    head.add(bang);
  }

  // ---- Limbs ----
  const limbs = {};
  for (const [name, x] of [
    ['legL', -0.14],
    ['legR', 0.14],
  ]) {
    const hip = new THREE.Group();
    hip.position.set(x, 0.85, 0);
    const thigh = mesh(new THREE.CylinderGeometry(0.1, 0.085, 0.72, 8), skin);
    thigh.position.y = -0.4;
    const sock = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.14, 8), 0xf4f4ee);
    sock.position.y = -0.74;
    const shoe = mesh(new THREE.BoxGeometry(0.17, 0.12, 0.3), shoes);
    shoe.position.set(0, -0.83, 0.05);
    hip.add(thigh, sock, shoe);
    rig.add(hip);
    limbs[name] = hip;
  }
  for (const [name, x] of [
    ['armL', -0.34],
    ['armR', 0.34],
  ]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(x, 1.52, 0);
    const sleeve = mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.22, 8), shirt);
    sleeve.position.y = -0.08;
    const arm = mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.5, 8), skin);
    arm.position.y = -0.38;
    const hand = mesh(new THREE.SphereGeometry(0.07, 8, 6), skin);
    hand.position.y = -0.65;
    shoulder.add(sleeve, arm, hand);
    shoulder.rotation.z = x < 0 ? -0.1 : 0.1;
    rig.add(shoulder);
    limbs[name] = shoulder;
  }

  let phase = 0;
  /** speed01: 0 = idle, 1 = walking, ~1.8 = running */
  function animate(dt, speed01, time) {
    if (speed01 > 0.05) {
      phase += dt * (5 + speed01 * 4.5);
      const swing = Math.sin(phase) * 0.55 * Math.min(speed01, 1.5);
      limbs.legL.rotation.x = swing;
      limbs.legR.rotation.x = -swing;
      limbs.armL.rotation.x = -swing * 0.9;
      limbs.armR.rotation.x = swing * 0.9;
      rig.position.y = Math.abs(Math.cos(phase)) * 0.06 * speed01;
      rig.rotation.x = 0.06 * speed01;
    } else {
      for (const l of Object.values(limbs)) l.rotation.x *= 0.85;
      rig.rotation.x *= 0.85;
      rig.position.y = 0;
      torso.scale.y = 1 + Math.sin(time * 2.2) * 0.01;
    }
  }

  return { root, animate, height: 2.15 };
}
