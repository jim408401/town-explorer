import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { faceted, mesh, seededRandom, toon } from './materials.js';

export const ISLAND_RADIUS = 92;
const ROAD_WIDTH = 5;
const ROAD_LINES = [-48, -24, 0, 24, 48];
const BLOCK_CENTERS = [-60, -36, -12, 12, 36, 60];
const PLAZA_RADIUS = 13;
const ROAD_END = ISLAND_RADIUS - 8;

const PIER = { halfWidth: 2, start: ISLAND_RADIUS - 6, end: ISLAND_RADIUS + 22 };
const LIGHTHOUSE = { x: -58, z: -58 };
const PARK_BLOCKS = new Set(['-12,36', '36,-12', '-36,-36', '60,12', '-60,12', '12,-60']);

const WALL_COLORS = [0xf6d6ad, 0xf2b5a7, 0xfbe7c6, 0xb8d8e0, 0xd9c2e9, 0xf7f0e1, 0xc8e6c9];
const ROOF_COLORS = [0xd9534f, 0x5b7db1, 0x8c5a3c, 0x4f8a6b, 0xe07a3f, 0x6b5b95];
const LEAF_COLORS = [0x7cc36b, 0x5fae5a, 0x9bd27a, 0x4e9a55];

/**
 * Builds the whole town.
 * Returns { group, colliders, isWalkable, navNodes, update }.
 * Colliders are { type: 'box', minX, maxX, minZ, maxZ } or { type: 'circle', x, z, r }.
 */
export function createTown() {
  const rand = seededRandom(20261008);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const statics = new THREE.Group(); // merged into a few draw calls at the end
  const dynamic = new THREE.Group(); // things that animate every frame
  const colliders = [];
  const updaters = [];

  // ---- Island, beach and sea ----
  const top = mesh(faceted(new THREE.CircleGeometry(ISLAND_RADIUS, 64)), 0x9ed36a, { cast: false });
  top.rotation.x = -Math.PI / 2;
  const beach = mesh(new THREE.RingGeometry(ISLAND_RADIUS - 7, ISLAND_RADIUS, 64, 1), 0xf3dfae, { cast: false });
  beach.rotation.x = -Math.PI / 2;
  beach.position.y = 0.02;
  const cliff = mesh(
    faceted(new THREE.CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS - 8, 8, 64, 1, true)),
    0xd8b47e,
    { cast: false }
  );
  cliff.position.y = -4;
  statics.add(top, beach, cliff);

  const water = createWater();
  dynamic.add(water.mesh);
  updaters.push(water.update);

  // ---- Roads and the central plaza ----
  for (const p of ROAD_LINES) {
    const len = 2 * Math.sqrt(ROAD_END * ROAD_END - p * p);
    const rx = mesh(new THREE.BoxGeometry(len, 0.1, ROAD_WIDTH), 0xe9d8b4, { cast: false });
    rx.position.set(0, 0.05, p);
    const rz = mesh(new THREE.BoxGeometry(ROAD_WIDTH, 0.1, len), 0xe9d8b4, { cast: false });
    rz.position.set(p, 0.05, 0);
    statics.add(rx, rz);
  }
  // Road x=0 continues to the pier on the south shore
  const pierRoad = mesh(new THREE.BoxGeometry(ROAD_WIDTH, 0.1, PIER.start - ROAD_END + 2), 0xe9d8b4, {
    cast: false,
  });
  pierRoad.position.set(0, 0.05, (ROAD_END + PIER.start) / 2);
  statics.add(pierRoad);

  const plaza = mesh(faceted(new THREE.CylinderGeometry(PLAZA_RADIUS, PLAZA_RADIUS, 0.14, 16)), 0xf1e3c4, {
    cast: false,
  });
  plaza.position.y = 0.07;
  statics.add(plaza);
  addFountain(statics, colliders);
  const stallColors = [0xe85d5d, 0x4f9bd9, 0xf2b84b, 0x63b37a];
  [
    [8, 8],
    [-8, 8],
    [-8, -8],
    [8, -8],
  ].forEach(([x, z], i) => addStall(statics, colliders, x, z, Math.atan2(-x, -z), stallColors[i]));

  // ---- Landmarks ----
  addPier(statics, dynamic, updaters);
  addLighthouse(statics, dynamic, colliders, updaters);

  // ---- City blocks: houses or parks ----
  for (const bx of BLOCK_CENTERS) {
    for (const bz of BLOCK_CENTERS) {
      if (Math.hypot(bx, bz) > ISLAND_RADIUS - 16) continue;
      if (PARK_BLOCKS.has(`${bx},${bz}`)) addPark(statics, colliders, bx, bz, rand, pick);
      else addHouseBlock(statics, colliders, bx, bz, rand, pick);
    }
  }

  // ---- Woods and rocks around the edge ----
  for (let i = 0; i < 160; i++) {
    const a = rand() * Math.PI * 2;
    const r = ISLAND_RADIUS - 9 - rand() * 12;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (onRoad(x, z, 2) || inLandmark(x, z) || inBlock(x, z)) continue;
    if (rand() < 0.8) addTree(statics, colliders, x, z, rand, pick);
    else addRock(statics, colliders, x, z, rand);
  }
  // Rocks on the beach
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2;
    const r = ISLAND_RADIUS - 2 - rand() * 3;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (inLandmark(x, z)) continue;
    addRock(statics, colliders, x, z, rand);
  }
  // Grass tufts and flowers for texture
  const flowerColors = [0xff7aa2, 0xffd166, 0xffffff, 0xb28dff];
  for (let i = 0; i < 500; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * (ISLAND_RADIUS - 8);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (onRoad(x, z, 0.5) || inLandmark(x, z)) continue;
    if (rand() < 0.75) {
      const tuft = mesh(new THREE.ConeGeometry(0.18, 0.5, 3), 0x7fbf55, { cast: false });
      tuft.position.set(x, 0.25, z);
      tuft.rotation.y = rand() * Math.PI;
      statics.add(tuft);
    } else {
      const f = mesh(new THREE.IcosahedronGeometry(0.16, 0), pick(flowerColors), { cast: false });
      f.position.set(x, 0.2, z);
      statics.add(f);
    }
  }

  // ---- Street lamps ----
  for (const p of ROAD_LINES) {
    for (let t = -72; t <= 72; t += 24) {
      addLamp(statics, colliders, p + ROAD_WIDTH / 2 + 0.6, t + 12);
      addLamp(statics, colliders, t - 12, p - ROAD_WIDTH / 2 - 0.6);
    }
  }

  const group = new THREE.Group();
  group.add(bakeStatic(statics), dynamic);

  return {
    group,
    colliders,
    isWalkable,
    navNodes: buildNavNodes(),
    update: (time) => updaters.forEach((u) => u(time)),
  };
}

/** True if the point is on land or on the pier. */
export function isWalkable(x, z, margin = 0.6) {
  if (Math.hypot(x, z) < ISLAND_RADIUS - 1.5 - margin) return true;
  return Math.abs(x) < PIER.halfWidth - margin && z > PIER.start - 2 && z < PIER.end - margin;
}

/** Road intersections that villagers wander between, with their neighbours. */
function buildNavNodes() {
  const nodes = [];
  const key = (x, z) => `${x},${z}`;
  const index = new Map();
  for (const x of ROAD_LINES) {
    for (const z of ROAD_LINES) {
      if (x === 0 && z === 0) continue; // the fountain sits here
      if (Math.hypot(x, z) > ROAD_END - 4) continue;
      index.set(key(x, z), nodes.length);
      nodes.push({ x, z, links: [] });
    }
  }
  for (const n of nodes) {
    const i = ROAD_LINES.indexOf(n.x);
    const j = ROAD_LINES.indexOf(n.z);
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const k = key(ROAD_LINES[i + di], ROAD_LINES[j + dj]);
      if (index.has(k)) n.links.push(index.get(k));
    }
  }
  return nodes;
}

function onRoad(x, z, margin = 0) {
  const half = ROAD_WIDTH / 2 + margin;
  if (Math.hypot(x, z) < PLAZA_RADIUS + margin) return true;
  return ROAD_LINES.some((p) => Math.abs(x - p) < half || Math.abs(z - p) < half);
}

function inBlock(x, z) {
  return BLOCK_CENTERS.some(
    (bx) =>
      Math.abs(x - bx) < 8 &&
      BLOCK_CENTERS.some((bz) => Math.abs(z - bz) < 8 && Math.hypot(bx, bz) <= ISLAND_RADIUS - 16)
  );
}

function inLandmark(x, z) {
  if (Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.z) < 10) return true;
  return Math.abs(x) < 7 && z > ISLAND_RADIUS - 16;
}

/**
 * Merges every static mesh into one mesh per material, turning thousands of draw
 * calls into a few dozen.
 */
function bakeStatic(group) {
  group.updateMatrixWorld(true);
  const buckets = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const k = `${o.material.uuid}|${o.castShadow}`;
    if (!buckets.has(k)) buckets.set(k, { material: o.material, cast: o.castShadow, geos: [] });
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    buckets.get(k).geos.push(g);
  });
  const baked = new THREE.Group();
  for (const { material, cast, geos } of buckets.values()) {
    const m = new THREE.Mesh(mergeGeometries(geos), material);
    m.castShadow = cast;
    m.receiveShadow = true;
    baked.add(m);
    geos.forEach((g) => g.dispose());
  }
  return baked;
}

function createWater() {
  const geo = new THREE.PlaneGeometry(600, 600, 70, 70);
  geo.rotateX(-Math.PI / 2);
  const g = geo.toNonIndexed();
  const base = g.attributes.position.array.slice();
  const material = toon(0x6cc4dc).clone();
  material.transparent = true;
  material.opacity = 0.92;
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  m.position.y = -1.0;

  function update(time) {
    const pos = g.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const x = base[i];
      const z = base[i + 2];
      pos[i + 1] = Math.sin(x * 0.12 + time * 0.9) * 0.22 + Math.cos(z * 0.15 + time * 0.7) * 0.22;
    }
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
  }
  update(0);
  return { mesh: m, update };
}

function addFountain(group, colliders) {
  const basin = mesh(faceted(new THREE.CylinderGeometry(3.2, 3.6, 1, 10)), 0xd6d0c4);
  basin.position.y = 0.5;
  const pool = mesh(faceted(new THREE.CylinderGeometry(2.7, 2.7, 0.1, 10)), 0x7fd0e6, { cast: false });
  pool.position.y = 1.0;
  const pillar = mesh(faceted(new THREE.CylinderGeometry(0.4, 0.6, 2.2, 6)), 0xd6d0c4);
  pillar.position.y = 1.8;
  const bowl = mesh(faceted(new THREE.CylinderGeometry(1.3, 0.5, 0.6, 8)), 0xd6d0c4);
  bowl.position.y = 2.9;
  const spout = mesh(faceted(new THREE.IcosahedronGeometry(0.5, 0)), 0xa8e4f2);
  spout.position.y = 3.5;
  group.add(basin, pool, pillar, bowl, spout);
  colliders.push({ type: 'circle', x: 0, z: 0, r: 3.6 });
}

function addStall(group, colliders, x, z, rotation, color) {
  const stall = new THREE.Group();
  const counter = mesh(new THREE.BoxGeometry(2.6, 1, 1.2), 0xc8945f);
  counter.position.y = 0.5;
  stall.add(counter);
  for (const sx of [-1.2, 1.2]) {
    for (const sz of [-0.5, 0.5]) {
      const post = mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), 0x8b5a3c);
      post.position.set(sx, 1.2, sz);
      stall.add(post);
    }
  }
  // Striped awning
  for (let i = 0; i < 5; i++) {
    const stripe = mesh(new THREE.BoxGeometry(0.6, 0.1, 1.8), i % 2 ? 0xffffff : color);
    stripe.position.set(-1.2 + i * 0.6, 2.5, 0.1);
    stripe.rotation.x = -0.2;
    stall.add(stripe);
  }
  const goods = [0xf2c94c, 0xe85d5d, 0x8fcf5f];
  goods.forEach((c, i) => {
    const g = mesh(faceted(new THREE.IcosahedronGeometry(0.25, 0)), c);
    g.position.set(-0.7 + i * 0.7, 1.2, 0.1);
    stall.add(g);
  });
  stall.position.set(x, 0, z);
  stall.rotation.y = rotation;
  group.add(stall);
  colliders.push({ type: 'circle', x, z, r: 1.5 });
}

function addPier(statics, dynamic, updaters) {
  const len = PIER.end - PIER.start;
  const deck = mesh(new THREE.BoxGeometry(PIER.halfWidth * 2, 0.2, len), 0xb7835a);
  deck.position.set(0, -0.05, PIER.start + len / 2);
  statics.add(deck);
  // Planks seams and posts
  for (let z = PIER.start + 1; z < PIER.end; z += 1.2) {
    const seam = mesh(new THREE.BoxGeometry(PIER.halfWidth * 2, 0.02, 0.08), 0x8f6141, { cast: false });
    seam.position.set(0, 0.06, z);
    statics.add(seam);
  }
  for (let z = PIER.start + 3; z <= PIER.end; z += 4) {
    for (const sx of [-1, 1]) {
      const post = mesh(faceted(new THREE.CylinderGeometry(0.18, 0.18, 3, 6)), 0x7a5236);
      post.position.set(sx * (PIER.halfWidth - 0.1), -0.9, z);
      const cap = mesh(faceted(new THREE.CylinderGeometry(0.2, 0.2, 0.7, 6)), 0x7a5236);
      cap.position.set(sx * (PIER.halfWidth - 0.1), 0.35, z);
      statics.add(post, cap);
    }
  }

  // A little rowing boat bobbing next to the pier
  const boat = new THREE.Group();
  const hullGeo = new THREE.CylinderGeometry(1.1, 0.7, 0.8, 8, 1, false, 0, Math.PI);
  hullGeo.rotateZ(Math.PI / 2);
  hullGeo.rotateX(Math.PI / 2);
  const hull = mesh(faceted(hullGeo), 0xe85d5d);
  hull.scale.set(1, 1, 2.6);
  hull.rotation.z = Math.PI / 2;
  const bench = mesh(new THREE.BoxGeometry(1.6, 0.1, 0.4), 0xb7835a);
  bench.position.y = 0.1;
  boat.add(hull, bench);
  boat.position.set(4.5, -0.8, PIER.end - 6);
  dynamic.add(boat);
  updaters.push((t) => {
    boat.position.y = -0.85 + Math.sin(t * 1.3) * 0.12;
    boat.rotation.z = Math.sin(t * 1.1) * 0.06;
    boat.rotation.x = Math.cos(t * 0.9) * 0.04;
  });
}

function addLighthouse(statics, dynamic, colliders, updaters) {
  const { x, z } = LIGHTHOUSE;
  const base = mesh(faceted(new THREE.CylinderGeometry(6, 6.5, 0.4, 12)), 0xcfc8bb, { cast: false });
  base.position.set(x, 0.2, z);
  statics.add(base);

  const segments = 6;
  const towerH = 14;
  for (let i = 0; i < segments; i++) {
    const r0 = 2.6 - (i / segments) * 1.0;
    const r1 = 2.6 - ((i + 1) / segments) * 1.0;
    const seg = mesh(
      faceted(new THREE.CylinderGeometry(r1, r0, towerH / segments, 10)),
      i % 2 ? 0xffffff : 0xe05a4f
    );
    seg.position.set(x, 0.4 + (i + 0.5) * (towerH / segments), z);
    statics.add(seg);
  }
  const gallery = mesh(faceted(new THREE.CylinderGeometry(2.2, 2.2, 0.3, 10)), 0x3e4a59);
  gallery.position.set(x, towerH + 0.55, z);
  const lamp = mesh(faceted(new THREE.CylinderGeometry(1.1, 1.1, 1.6, 8)), 0xfff1b0);
  lamp.position.set(x, towerH + 1.5, z);
  const roof = mesh(faceted(new THREE.ConeGeometry(1.6, 1.6, 8)), 0xe05a4f);
  roof.position.set(x, towerH + 3.1, z);
  const door = mesh(new THREE.BoxGeometry(1.1, 2, 0.3), 0x8b5a3c, { cast: false });
  door.position.set(x + 1.85, 1.4, z + 1.85);
  door.rotation.y = Math.PI / 4;
  statics.add(gallery, lamp, roof, door);
  colliders.push({ type: 'circle', x, z, r: 2.8 });

  // Rotating light beam
  const beamGeo = new THREE.ConeGeometry(1.4, 18, 8, 1, true);
  beamGeo.translate(0, -9, 0);
  beamGeo.rotateZ(Math.PI / 2);
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xfff3c4,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.set(x, towerH + 1.5, z);
  dynamic.add(beam);
  updaters.push((t) => (beam.rotation.y = t * 0.6));
}

function addHouseBlock(group, colliders, bx, bz, rand, pick) {
  // Each block has 15x15 usable space: a 2x2 grid of houses
  const offsets = [
    [-3.8, -3.8],
    [3.8, -3.8],
    [-3.8, 3.8],
    [3.8, 3.8],
  ];
  for (const [ox, oz] of offsets) {
    const x = bx + ox;
    const z = bz + oz;
    if (Math.hypot(x, z) > ISLAND_RADIUS - 12) continue;
    if (Math.hypot(x, z) < PLAZA_RADIUS + 4) continue; // keep the plaza open
    if (rand() < 0.15) {
      addTree(group, colliders, x, z, rand, pick);
      continue;
    }
    // Door is on local +z; face one of the two roads bordering this corner
    const rot = rand() < 0.5 ? (oz > 0 ? 0 : Math.PI) : ox > 0 ? Math.PI / 2 : -Math.PI / 2;
    addHouse(group, colliders, x, z, rot, rand, pick);
  }
}

function addHouse(group, colliders, x, z, rotation, rand, pick) {
  const w = 4.2 + rand() * 1.6;
  const d = 4.2 + rand() * 1.4;
  const floors = rand() < 0.3 ? 2 : 1;
  const h = 2.6 * floors + 0.4;
  const wall = pick(WALL_COLORS);
  const roofColor = pick(ROOF_COLORS);
  const house = new THREE.Group();

  const body = mesh(new THREE.BoxGeometry(w, h, d), wall);
  body.position.y = h / 2;
  house.add(body);

  // Gable roof: a 3-sided cylinder lying along z is a triangular prism
  const roofH = 1.8 + rand() * 0.8;
  const roofGeo = new THREE.CylinderGeometry(1, 1, d + 0.6, 3, 1);
  roofGeo.rotateX(Math.PI / 2);
  roofGeo.rotateZ(Math.PI); // point the apex up
  const roof = mesh(faceted(roofGeo), roofColor);
  roof.scale.set((w + 0.8) / Math.sqrt(3), roofH / 1.5, 1);
  roof.position.y = h + roofH / 3;
  house.add(roof);

  if (rand() < 0.6) {
    const chimney = mesh(new THREE.BoxGeometry(0.6, 1.6, 0.6), 0x9c6b4e);
    chimney.position.set(w * 0.25, h + roofH * 0.6, -d * 0.15);
    house.add(chimney);
  }

  // Door and windows (front faces +z)
  const door = mesh(new THREE.BoxGeometry(0.9, 1.6, 0.1), 0x8b5a3c, { cast: false });
  door.position.set(0, 0.8, d / 2 + 0.05);
  const knob = mesh(new THREE.SphereGeometry(0.07, 6, 4), 0xf2c94c, { cast: false });
  knob.position.set(0.28, 0.8, d / 2 + 0.12);
  house.add(door, knob);
  for (let f = 0; f < floors; f++) {
    const y = 1.5 + f * 2.6;
    for (const sx of [-1, 1]) addWindow(house, sx * w * 0.3, y, d / 2 + 0.05, 0);
    addWindow(house, w / 2 + 0.05, y, 0, Math.PI / 2);
    addWindow(house, -w / 2 - 0.05, y, 0, -Math.PI / 2);
  }

  const step = mesh(new THREE.BoxGeometry(1.4, 0.2, 0.7), 0xcfc6b8, { cast: false });
  step.position.set(0, 0.1, d / 2 + 0.35);
  house.add(step);
  if (rand() < 0.7) {
    const pot = mesh(faceted(new THREE.CylinderGeometry(0.3, 0.22, 0.4, 6)), 0xc8734a);
    pot.position.set(-0.95, 0.2, d / 2 + 0.4);
    const bush = mesh(faceted(new THREE.IcosahedronGeometry(0.35, 0)), 0x6dbb5a);
    bush.position.set(-0.95, 0.6, d / 2 + 0.4);
    house.add(pot, bush);
  }

  house.position.set(x, 0, z);
  house.rotation.y = rotation;
  group.add(house);

  // Axis-aligned collider from the rotated footprint
  const sideways = Math.abs(Math.sin(rotation)) > 0.5;
  const hw = (sideways ? d : w) / 2 + 0.1;
  const hd = (sideways ? w : d) / 2 + 0.1;
  colliders.push({ type: 'box', minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd });
}

function addWindow(parent, x, y, z, rotY) {
  const g = new THREE.Group();
  const frame = mesh(new THREE.BoxGeometry(1.0, 1.0, 0.08), 0xffffff, { cast: false });
  const glass = mesh(new THREE.BoxGeometry(0.8, 0.8, 0.1), 0x8fc9e8, { cast: false });
  g.add(frame, glass);
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  parent.add(g);
}

function addTree(group, colliders, x, z, rand, pick) {
  const tree = new THREE.Group();
  const s = 0.8 + rand() * 0.6;
  const trunk = mesh(faceted(new THREE.CylinderGeometry(0.22, 0.32, 1.6, 5)), 0x8b5a3c);
  trunk.position.y = 0.8;
  tree.add(trunk);
  const leaf = pick(LEAF_COLORS);
  if (rand() < 0.5) {
    // Pine: stacked cones
    for (let i = 0; i < 3; i++) {
      const cone = mesh(faceted(new THREE.ConeGeometry(1.5 - i * 0.35, 1.6, 6)), leaf);
      cone.position.y = 1.9 + i * 0.85;
      cone.rotation.y = rand() * Math.PI;
      tree.add(cone);
    }
  } else {
    // Round tree: a couple of icosahedrons
    const blob = mesh(faceted(new THREE.IcosahedronGeometry(1.5, 0)), leaf);
    blob.position.y = 2.6;
    blob.rotation.set(rand(), rand(), rand());
    const blob2 = mesh(faceted(new THREE.IcosahedronGeometry(1.0, 0)), leaf);
    blob2.position.set(0.7, 3.4, 0.2);
    tree.add(blob, blob2);
  }
  tree.scale.setScalar(s);
  tree.position.set(x, 0, z);
  tree.rotation.y = rand() * Math.PI * 2;
  group.add(tree);
  colliders.push({ type: 'circle', x, z, r: 0.45 * s + 0.1 });
}

function addRock(group, colliders, x, z, rand) {
  const s = 0.6 + rand() * 0.9;
  const rock = mesh(faceted(new THREE.DodecahedronGeometry(s, 0)), 0xa9a49b);
  rock.scale.y = 0.6;
  rock.position.set(x, s * 0.3, z);
  rock.rotation.set(rand(), rand(), rand());
  group.add(rock);
  colliders.push({ type: 'circle', x, z, r: s * 0.9 });
}

function addPark(group, colliders, bx, bz, rand, pick) {
  const lawn = mesh(new THREE.BoxGeometry(14, 0.12, 14), 0x8fcf5f, { cast: false });
  lawn.position.set(bx, 0.06, bz);
  group.add(lawn);
  const path = mesh(new THREE.BoxGeometry(14, 0.14, 1.6), 0xe9d8b4, { cast: false });
  path.position.set(bx, 0.07, bz);
  group.add(path);
  for (let i = 0; i < 7; i++) {
    const x = bx + (rand() - 0.5) * 11;
    const z = bz + (rand() - 0.5) * 11;
    if (Math.abs(z - bz) < 2.2) continue;
    addTree(group, colliders, x, z, rand, pick);
  }
  const flowerColors = [0xff7aa2, 0xffd166, 0xffffff, 0xb28dff];
  for (let i = 0; i < 50; i++) {
    const z = bz + (rand() - 0.5) * 13;
    if (Math.abs(z - bz) < 1) continue;
    const f = mesh(new THREE.IcosahedronGeometry(0.16, 0), pick(flowerColors), { cast: false });
    f.position.set(bx + (rand() - 0.5) * 13, 0.22, z);
    group.add(f);
  }
  for (const side of [-1, 1]) {
    const bench = new THREE.Group();
    const seat = mesh(new THREE.BoxGeometry(2.4, 0.15, 0.7), 0xb07a4f);
    seat.position.y = 0.55;
    const back = mesh(new THREE.BoxGeometry(2.4, 0.6, 0.12), 0xb07a4f);
    back.position.set(0, 0.9, -0.3);
    bench.add(seat, back);
    for (const sx of [-1, 1]) {
      const leg = mesh(new THREE.BoxGeometry(0.12, 0.55, 0.6), 0x555555);
      leg.position.set(sx * 1.0, 0.27, 0);
      bench.add(leg);
    }
    const z = bz + side * 1.6;
    bench.position.set(bx, 0, z);
    bench.rotation.y = side > 0 ? Math.PI : 0;
    group.add(bench);
    colliders.push({ type: 'box', minX: bx - 1.3, maxX: bx + 1.3, minZ: z - 0.45, maxZ: z + 0.45 });
  }
}

function addLamp(group, colliders, x, z) {
  if (Math.hypot(x, z) > ROAD_END - 2 || Math.hypot(x, z) < PLAZA_RADIUS + 1) return;
  const pole = mesh(faceted(new THREE.CylinderGeometry(0.08, 0.12, 3, 6)), 0x3e4a59);
  pole.position.set(x, 1.5, z);
  const head = mesh(faceted(new THREE.OctahedronGeometry(0.35, 0)), 0xffe9a8);
  head.position.set(x, 3.2, z);
  group.add(pole, head);
  colliders.push({ type: 'circle', x, z, r: 0.2 });
}
