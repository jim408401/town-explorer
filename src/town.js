import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cel, mesh, seededRandom, signTexture } from './materials.js';

// ---- Layout ----
export const ISLAND_RADIUS = 100;
const ROAD_LINES = [-60, -30, 0, 30, 60];
const BLOCK_CENTERS = [-75, -45, -15, 15, 45, 75];
const ROAD_HALF = 3.5; // asphalt half-width
const WALK = 2.4; // sidewalk width
const CORRIDOR = ROAD_HALF + WALK;
const LOT_HALF = 15 - CORRIDOR; // half-size of a block's buildable area
const ROAD_END = ISLAND_RADIUS - 10;
const CURB = 0.14; // sidewalk / lot height above the asphalt

const PIER = { halfWidth: 2.2, start: ISLAND_RADIUS - 3, end: ISLAND_RADIUS + 24 };
const LIGHTHOUSE = { x: -75, z: -45 };
const PARK_BLOCKS = new Set(['-15,45', '45,-15', '-45,-45', '75,15', '15,-75']);
const SQUARE_BLOCK = '-15,-15';

// Lots and spots that can hold an optional downloaded GLB model (see models.js).
// Each slot keeps a procedural fallback that is removed once its model loads.
const MODEL_BUILDINGS = {
  '15,15': 'convenience-store-01',
  '-15,15': 'corner-store-01',
  '45,15': 'apartment-block-01',
};
const SIDEWALK_MODELS = ['bench-01', 'trash-bin-01', 'flower-planter-01', 'street-lamp-01', 'bus-shelter-01'];
const CAR_MODELS = ['car-sedan-01', 'taxi-01'];

// ---- Palette (desaturated, sun-bleached, like the reference) ----
const C = {
  asphalt: 0x56686a,
  lane: 0xeef0e6,
  sidewalk: 0xbcc6ba,
  curb: 0xdfe3d6,
  lot: 0xc4cbbf,
  grass: 0x9cc58f,
  ink: 0x2a3434,
  windowGlass: 0x40504f,
  frame: 0xe9ebe2,
  pole: 0x8e9c94,
  metal: 0x7d8a86,
  red: 0xc8463c,
  leaf: 0x6fae7a,
  leafDark: 0x4f9466,
  trunk: 0x7a6250,
  water: 0x5bbcb0,
};
const WALLS = [0xe5e3d7, 0xd7dccd, 0xcfd7d0, 0xe9dccf, 0xe7bdb4, 0xc8dad3, 0xece7d9, 0xd9d2c4];
const ACCENTS = [0x3f9e86, 0xc8463c, 0xe0a33a, 0x4f7fa8, 0x8f6aa0];
const SHOP_NAMES = ['早餐店', '咖啡', '麵包', '雜貨店', '藥局', '書店', '洗衣', '理髮', '麵店', '花店', '文具', '茶飲', '水果', '豆花', '便當', '五金'];

/**
 * Builds the town. Returns { group, colliders, isWalkable, groundHeight, navNodes, update }.
 * Colliders are { type: 'box', minX, maxX, minZ, maxZ } or { type: 'circle', x, z, r }.
 */
export function createTown() {
  const rand = seededRandom(20261008);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const statics = new THREE.Group();
  const dynamic = new THREE.Group();
  const colliders = [];
  const updaters = [];
  const fallbacks = new THREE.Group(); // kept un-merged so they can be swapped for models
  const slots = [];
  const ctx = { statics, dynamic, colliders, updaters, rand, pick, slots, fallbacks };

  addGround(ctx);
  addRoads(ctx);
  addUtilityPoles(ctx);

  for (const bx of BLOCK_CENTERS) {
    for (const bz of BLOCK_CENTERS) {
      if (!blockExists(bx, bz)) continue;
      const key = `${bx},${bz}`;
      if (key === SQUARE_BLOCK) addSquare(ctx, bx, bz);
      else if (PARK_BLOCKS.has(key)) addPark(ctx, bx, bz);
      else addBuildingBlock(ctx, bx, bz);
    }
  }
  addStreetProps(ctx);
  addPier(ctx);
  addLighthouse(ctx);
  addOuterGreenery(ctx);

  const water = createWater();
  dynamic.add(water.mesh);
  updaters.push(water.update);

  const group = new THREE.Group();
  group.add(bakeStatic(statics), dynamic, fallbacks);
  return {
    group,
    colliders,
    slots,
    isWalkable,
    groundHeight,
    navNodes: buildNavNodes(),
    update: (time) => updaters.forEach((u) => u(time)),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function blockExists(bx, bz) {
  return Math.hypot(bx, bz) < ISLAND_RADIUS - 20;
}

function onAsphalt(x, z) {
  if (Math.abs(x) < ROAD_HALF && z > 0) return true; // includes the pier road
  if (Math.hypot(x, z) > ROAD_END) return false;
  return ROAD_LINES.some((p) => Math.abs(x - p) < ROAD_HALF || Math.abs(z - p) < ROAD_HALF);
}

function inCorridor(x, z, margin = 0) {
  return ROAD_LINES.some((p) => Math.abs(x - p) < CORRIDOR + margin || Math.abs(z - p) < CORRIDOR + margin);
}

/** True if the point is on land (inside the sea wall) or on the pier. */
export function isWalkable(x, z, margin = 0.6) {
  if (Math.hypot(x, z) < ISLAND_RADIUS - 1.2 - margin) return true;
  return Math.abs(x) < PIER.halfWidth - margin && z > PIER.start - 3 && z < PIER.end - margin;
}

/** Height of the walkable surface: asphalt is lower than sidewalks and lots. */
export function groundHeight(x, z) {
  if (Math.hypot(x, z) > ISLAND_RADIUS - 2) return 0.35; // pier deck
  return onAsphalt(x, z) ? 0 : CURB;
}

function buildNavNodes() {
  const nodes = [];
  const index = new Map();
  const key = (x, z) => `${x},${z}`;
  for (const x of ROAD_LINES) {
    for (const z of ROAD_LINES) {
      if (Math.hypot(x, z) > ROAD_END - 6) continue;
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

// ---------------------------------------------------------------------------
// Ground, roads and sea
// ---------------------------------------------------------------------------

function addGround({ statics }) {
  const top = mesh(new THREE.RingGeometry(0.01, ISLAND_RADIUS, 96, 50), C.grass, { cast: false });
  top.rotation.x = -Math.PI / 2;
  top.position.y = -0.12; // well below the asphalt to avoid z-fighting far away
  statics.add(top);

  // Concrete sea wall with a railing all around the island
  const wall = mesh(new THREE.CylinderGeometry(ISLAND_RADIUS, ISLAND_RADIUS + 1, 6, 96, 1, true), 0xb9c1b6, {
    cast: false,
  });
  wall.position.y = -3;
  const cap = mesh(new THREE.RingGeometry(ISLAND_RADIUS - 1.2, ISLAND_RADIUS, 96, 1), C.curb, { cast: false });
  cap.rotation.x = -Math.PI / 2;
  cap.position.y = CURB;
  statics.add(wall, cap);
  const railR = ISLAND_RADIUS - 0.5;
  const rail = mesh(new THREE.TorusGeometry(railR, 0.05, 4, 160), C.metal);
  rail.rotation.x = Math.PI / 2;
  rail.position.y = 1.15;
  statics.add(rail);
  for (let i = 0; i < 160; i++) {
    const a = (i / 160) * Math.PI * 2;
    const x = Math.cos(a) * railR;
    const z = Math.sin(a) * railR;
    const post = mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 5), C.metal);
    post.position.set(x, 0.65, z);
    statics.add(post);
  }
}

function xz3([x, z], y) {
  return [x, y, z];
}

function addRoads({ statics, rand, slots }) {
  let carIndex = 0;
  for (const p of ROAD_LINES) {
    const len = 2 * Math.sqrt(ROAD_END * ROAD_END - p * p);
    for (const axis of ['x', 'z']) {
      // (along, across) -> (x, z)
      const along = (a, b) => (axis === 'x' ? [a, b] : [b, a]);
      // Long pieces are split into ~2 m segments so the planet bend stays smooth
      const box = (l, w, h) => {
        const n = Math.max(1, Math.ceil(l / 2));
        return axis === 'x' ? new THREE.BoxGeometry(l, h, w, n, 1, 1) : new THREE.BoxGeometry(w, h, l, 1, 1, n);
      };

      const road = mesh(box(len, ROAD_HALF * 2, 0.04), C.asphalt, { cast: false });
      road.position.set(...xz3(along(0, p), 0));
      statics.add(road);

      // Segments between crossing roads: sidewalks, lane markings and crosswalks
      const stops = [-len / 2, ...ROAD_LINES.filter((q) => Math.abs(q) < len / 2), len / 2];
      for (let i = 0; i < stops.length - 1; i++) {
        const first = i === 0;
        const last = i === stops.length - 2;
        const a = stops[i] + (first ? 0 : CORRIDOR);
        const b = stops[i + 1] - (last ? 0 : CORRIDOR);
        if (b - a < 1) continue;
        const mid = (a + b) / 2;
        const segLen = b - a;
        for (const side of [-1, 1]) {
          const walk = mesh(box(segLen, WALK, CURB), C.sidewalk, { cast: false });
          walk.position.set(...xz3(along(mid, p + side * (ROAD_HALF + WALK / 2)), CURB / 2));
          const curb = mesh(box(segLen, 0.25, CURB + 0.02), C.curb, { cast: false });
          curb.position.set(...xz3(along(mid, p + side * (ROAD_HALF + 0.12)), (CURB + 0.02) / 2));
          const edge = mesh(box(segLen, 0.14, 0.02), C.lane, { cast: false });
          edge.position.set(...xz3(along(mid, p + side * (ROAD_HALF - 0.45)), 0.03));
          statics.add(walk, curb, edge);
        }
        // Dashed centre line
        for (let t = a + 1.5; t < b - 3; t += 4) {
          const dash = mesh(box(2, 0.16, 0.02), C.lane, { cast: false });
          dash.position.set(...xz3(along(t + 1, p), 0.03));
          statics.add(dash);
        }
        // Zebra crossings next to each intersection
        for (const [end, dir, skip] of [
          [a, 1, first],
          [b, -1, last],
        ]) {
          if (skip) continue;
          for (let s = -ROAD_HALF + 0.7; s < ROAD_HALF - 0.4; s += 1.1) {
            const stripe = mesh(box(1.8, 0.6, 0.02), C.lane, { cast: false });
            stripe.position.set(...xz3(along(end + dir * 1.4, p + s), 0.03));
            statics.add(stripe);
          }
        }
        // Parked car spot (model only, no procedural fallback)
        if (segLen > 14 && rand() < 0.35) {
          const side = rand() < 0.5 ? -1 : 1;
          const [cx, cz] = along(a + segLen * (0.3 + rand() * 0.4), p + side * (ROAD_HALF - 1.3));
          const rotation = (axis === 'x' ? Math.PI / 2 : 0) + (side > 0 ? 0 : Math.PI);
          slots.push({ model: CAR_MODELS[carIndex++ % 2], kind: 'car', x: cx, y: 0, z: cz, rotation, collider: true });
        }
        if (rand() < 0.6) {
          const hole = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.03, 14), 0x4e6462, { cast: false });
          hole.position.set(...xz3(along(a + rand() * segLen, p + (rand() - 0.5) * 3), 0.03));
          statics.add(hole);
        }
      }
    }
  }
  // Short road from the grid to the pier
  const pierRoad = mesh(new THREE.BoxGeometry(ROAD_HALF * 2, 0.04, PIER.start - ROAD_END + 2, 1, 1, 5), C.asphalt, {
    cast: false,
  });
  pierRoad.position.set(0, 0, (ROAD_END + PIER.start) / 2);
  statics.add(pierRoad);
}

function createWater() {
  const geo = new THREE.PlaneGeometry(700, 700, 80, 80);
  geo.rotateX(-Math.PI / 2);
  const g = geo.toNonIndexed();
  const base = g.attributes.position.array.slice();
  const m = new THREE.Mesh(g, cel(C.water));
  m.receiveShadow = true;
  m.position.y = -1.6;
  m.userData.noOutline = true;
  function update(time) {
    const pos = g.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const x = base[i];
      const z = base[i + 2];
      pos[i + 1] = Math.sin(x * 0.1 + time * 0.8) * 0.2 + Math.cos(z * 0.13 + time * 0.6) * 0.2;
    }
    g.attributes.position.needsUpdate = true;
    g.computeVertexNormals();
  }
  update(0);
  return { mesh: m, update };
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

function addBuildingBlock(ctx, bx, bz) {
  const { statics, rand } = ctx;
  const lot = mesh(new THREE.BoxGeometry(LOT_HALF * 2, CURB, LOT_HALF * 2, 9, 1, 9), C.lot, { cast: false });
  lot.position.set(bx, CURB / 2, bz);
  statics.add(lot);

  // Split the block into a 2x2 grid of lots; sometimes merge two into a wide building
  const half = LOT_HALF;
  const lots = [];
  const r = rand();
  if (r < 0.25) {
    lots.push({ x: bx, z: bz - half / 2, w: half * 2, d: half, faceZ: -1 });
    lots.push({ x: bx, z: bz + half / 2, w: half * 2, d: half, faceZ: 1 });
  } else if (r < 0.5) {
    lots.push({ x: bx - half / 2, z: bz, w: half, d: half * 2, faceX: -1 });
    lots.push({ x: bx + half / 2, z: bz, w: half, d: half * 2, faceX: 1 });
  } else {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        lots.push({ x: bx + (sx * half) / 2, z: bz + (sz * half) / 2, w: half, d: half, faceX: sx, faceZ: sz });
      }
    }
  }
  const modelName = MODEL_BUILDINGS[`${bx},${bz}`];
  lots.forEach((l, li) => {
    // Front faces a road: along z if possible, otherwise along x
    const faceRoadZ = l.faceZ !== undefined && (l.faceX === undefined || rand() < 0.5);
    const rotation = faceRoadZ ? (l.faceZ > 0 ? 0 : Math.PI) : l.faceX > 0 ? Math.PI / 2 : -Math.PI / 2;
    const w = (faceRoadZ ? l.w : l.d) - 0.4 - rand() * 0.5;
    const d = (faceRoadZ ? l.d : l.w) - 0.4 - rand() * 0.5;
    if (modelName && li === 0) {
      const fallback = new THREE.Group();
      addBuilding({ ...ctx, statics: fallback }, l.x, l.z, w, d, rotation);
      ctx.fallbacks.add(fallback);
      ctx.slots.push({ model: modelName, kind: 'building', x: l.x, y: CURB, z: l.z, rotation, w, d, fallback });
    } else {
      addBuilding(ctx, l.x, l.z, w, d, rotation);
    }
  });
}

/** A multi-storey concrete building; local +z is the street-facing front. */
function addBuilding({ statics, colliders, rand, pick }, x, z, w, d, rotation) {
  const b = new THREE.Group();
  const floors = 2 + Math.floor(rand() * 3);
  const FH = 3.2;
  const h = floors * FH + 0.4;
  const wall = pick(WALLS);
  const trim = new THREE.Color(wall).multiplyScalar(0.9).getHex();
  const accent = pick(ACCENTS);

  const body = mesh(new THREE.BoxGeometry(w, h, d), wall);
  body.position.y = h / 2;
  b.add(body);

  for (let f = 1; f <= floors; f++) {
    const ledge = mesh(new THREE.BoxGeometry(w + 0.24, 0.2, d + 0.24), trim);
    ledge.position.y = f * FH;
    b.add(ledge);
  }

  // Faces: front (+z), back (-z), right (+x), left (-x)
  const faces = [
    { len: w, nx: 0, nz: 1, rot: 0, off: d / 2 },
    { len: w, nx: 0, nz: -1, rot: Math.PI, off: d / 2 },
    { len: d, nx: 1, nz: 0, rot: Math.PI / 2, off: w / 2 },
    { len: d, nx: -1, nz: 0, rot: -Math.PI / 2, off: w / 2 },
  ];
  const wide = rand() < 0.5;
  faces.forEach((face, fi) => {
    const count = Math.max(1, Math.floor(face.len / (wide ? 3.4 : 2.4)));
    const spacing = face.len / count;
    for (let f = 1; f < floors; f++) {
      for (let i = 0; i < count; i++) {
        const t = -face.len / 2 + spacing * (i + 0.5);
        const y = f * FH + 1.55;
        addWindow(b, face, t, y, wide ? Math.min(2.6, spacing - 0.6) : 1.3);
        if (rand() < 0.22) addAC(b, face, t + 0.5, y - 1.15);
      }
      if (fi === 0 && rand() < 0.35) {
        addBalcony(b, face, (rand() - 0.5) * (face.len - 3.5), f * FH, Math.min(3.2, face.len - 1));
      }
    }
    if (fi === 0) addShopfront(b, face, w, accent, rand, pick);
    else if (rand() < 0.6) addWindow(b, face, (rand() - 0.5) * (face.len - 2), 1.7, 1.0);
  });

  const pipe = mesh(new THREE.CylinderGeometry(0.08, 0.08, h, 6), 0x9aa59f);
  pipe.position.set(w / 2 - 0.15, h / 2, d / 2 + 0.12);
  b.add(pipe);

  addRoof(b, w, d, h, wall, rand);

  b.position.set(x, CURB, z);
  b.rotation.y = rotation;
  statics.add(b);

  const sideways = Math.abs(Math.sin(rotation)) > 0.5;
  const hw = (sideways ? d : w) / 2 + 0.2;
  const hd = (sideways ? w : d) / 2 + 0.2;
  colliders.push({ type: 'box', minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd });
}

/** Places a child on a building face: t along the face, y up, `out` away from the wall. */
function onFace(obj, face, t, y, out) {
  if (face.nz !== 0) obj.position.set(t * face.nz, y, face.nz * (face.off + out));
  else obj.position.set(face.nx * (face.off + out), y, -t * face.nx);
  obj.rotation.y = face.rot;
}

function addWindow(b, face, t, y, width) {
  const g = new THREE.Group();
  const frame = mesh(new THREE.BoxGeometry(width + 0.24, 1.5, 0.12), C.frame, { cast: false });
  const glass = mesh(new THREE.BoxGeometry(width, 1.26, 0.16), C.windowGlass, { cast: false });
  const mullion = mesh(new THREE.BoxGeometry(0.08, 1.26, 0.2), C.frame, { cast: false });
  const sill = mesh(new THREE.BoxGeometry(width + 0.4, 0.1, 0.3), C.frame, { cast: false });
  sill.position.y = -0.78;
  g.add(frame, glass, mullion, sill);
  onFace(g, face, t, y, 0.03);
  b.add(g);
}

function addAC(b, face, t, y) {
  const g = new THREE.Group();
  const box = mesh(new THREE.BoxGeometry(0.85, 0.55, 0.38), 0xe8e8e0);
  const fan = mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.05, 10), 0x5f6b69, { cast: false });
  fan.rotation.x = Math.PI / 2;
  fan.position.set(0.12, 0, 0.2);
  g.add(box, fan);
  onFace(g, face, t, y, 0.22);
  b.add(g);
}

function addBalcony(b, face, t, y, width) {
  const g = new THREE.Group();
  const slab = mesh(new THREE.BoxGeometry(width, 0.18, 1.0), 0xd9dcd2);
  slab.position.set(0, 0.09, 0.5);
  const rail = mesh(new THREE.BoxGeometry(width, 0.06, 0.06), C.metal);
  rail.position.set(0, 1.0, 0.95);
  g.add(slab, rail);
  for (let i = 0; i <= Math.floor(width / 0.35); i++) {
    const bar = mesh(new THREE.BoxGeometry(0.04, 0.85, 0.04), C.metal, { cast: false });
    bar.position.set(-width / 2 + i * 0.35 + 0.05, 0.55, 0.95);
    g.add(bar);
  }
  for (const sx of [-1, 1]) {
    const side = mesh(new THREE.BoxGeometry(0.06, 0.06, 1.0), C.metal);
    side.position.set((sx * width) / 2, 1.0, 0.5);
    g.add(side);
  }
  onFace(g, face, t, y, 0);
  b.add(g);
}

function addShopfront(b, face, w, accent, rand, pick) {
  const width = Math.min(w - 1.2, 6);
  const g = new THREE.Group();
  if (rand() < 0.3) {
    // Closed rolling shutter
    const shutter = mesh(new THREE.BoxGeometry(width, 2.6, 0.12), 0xc9cec8);
    shutter.position.y = 1.3;
    g.add(shutter);
    for (let y = 0.3; y < 2.6; y += 0.28) {
      const groove = mesh(new THREE.BoxGeometry(width, 0.04, 0.16), 0xa9b0aa, { cast: false });
      groove.position.y = y;
      g.add(groove);
    }
    const housing = mesh(new THREE.BoxGeometry(width + 0.2, 0.4, 0.4), 0xb5bcb6);
    housing.position.set(0, 2.8, 0.15);
    g.add(housing);
  } else {
    // Open shop: dark interior, frame, awning and a sign
    const inside = mesh(new THREE.BoxGeometry(width, 2.5, 0.12), 0x3b4a49, { cast: false });
    inside.position.y = 1.25;
    const lintel = mesh(new THREE.BoxGeometry(width + 0.3, 0.25, 0.25), C.frame);
    lintel.position.y = 2.6;
    g.add(inside, lintel);
    for (const sx of [-1, 0, 1]) {
      const post = mesh(new THREE.BoxGeometry(0.1, 2.5, 0.2), C.frame, { cast: false });
      post.position.set((sx * width) / 2.02, 1.25, 0.02);
      g.add(post);
    }
    const awning = mesh(new THREE.BoxGeometry(width + 0.4, 0.08, 1.2), accent);
    awning.position.set(0, 2.85, 0.55);
    awning.rotation.x = 0.28;
    g.add(awning);
    const name = pick(SHOP_NAMES);
    const tex = signTexture(name, { fg: `#${new THREE.Color(accent).getHexString()}` });
    const signW = Math.min(width, 0.9 * [...name].length);
    const sign = mesh(new THREE.BoxGeometry(signW, 0.9, 0.12), 0xffffff, { map: tex, cast: false });
    sign.position.set(0, 3.45, 0.08);
    g.add(sign);
    if (rand() < 0.6) {
      for (const sx of [-1, 1]) {
        const pot = mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.4, 8), 0xb6795a);
        pot.position.set((sx * (width + 0.3)) / 2, 0.2, 0.45);
        const leaves = mesh(new THREE.IcosahedronGeometry(0.38, 1), C.leaf);
        leaves.position.set((sx * (width + 0.3)) / 2, 0.65, 0.45);
        g.add(pot, leaves);
      }
    }
  }
  // Vertical hanging sign sticking out from the wall, readable along the street
  if (rand() < 0.45) {
    const name = pick(SHOP_NAMES);
    const tex = signTexture(name, { vertical: true, bg: '#fbf6e4', fg: '#c8463c' });
    const n = [...name].length;
    const vs = mesh(new THREE.BoxGeometry(0.14, 0.75 * n, 0.75), 0xffffff, { map: tex });
    vs.position.set(w / 2 - 0.5, 4.2 + 0.375 * n, 0.55);
    const bracket = mesh(new THREE.BoxGeometry(0.06, 0.06, 0.6), C.metal);
    bracket.position.set(w / 2 - 0.5, 4.3 + 0.75 * n, 0.3);
    g.add(vs, bracket);
  }
  onFace(g, face, 0, 0, 0.04);
  b.add(g);
}

function addRoof(b, w, d, h, wall, rand) {
  const pc = new THREE.Color(wall).multiplyScalar(0.94).getHex();
  for (const [sx, sz, lw, ld] of [
    [0, 1, w, 0.25],
    [0, -1, w, 0.25],
    [1, 0, 0.25, d],
    [-1, 0, 0.25, d],
  ]) {
    const p = mesh(new THREE.BoxGeometry(lw, 0.7, ld), pc);
    p.position.set((sx * (w - 0.25)) / 2, h + 0.35, (sz * (d - 0.25)) / 2);
    b.add(p);
  }
  if (rand() < 0.4) {
    const rail = mesh(new THREE.BoxGeometry(w, 0.06, 0.06), C.metal);
    rail.position.set(0, h + 1.4, d / 2 - 0.12);
    b.add(rail);
    for (let i = 0; i <= Math.floor(w / 1.2); i++) {
      const post = mesh(new THREE.BoxGeometry(0.05, 0.7, 0.05), C.metal, { cast: false });
      post.position.set(-w / 2 + i * 1.2 + 0.1, h + 1.05, d / 2 - 0.12);
      b.add(post);
    }
  }
  // Water tank on a little stand
  if (rand() < 0.55) {
    const tx = (rand() - 0.5) * (w - 3);
    const tz = (rand() - 0.5) * (d - 3);
    const tankColor = rand() < 0.5 ? 0x8fcf8a : 0xe9ece4;
    const stand = mesh(new THREE.BoxGeometry(1.8, 0.9, 1.8), C.metal);
    stand.position.set(tx, h + 0.45, tz);
    const tank = mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.8, 14), tankColor);
    tank.position.set(tx, h + 1.8, tz);
    const lid = mesh(new THREE.CylinderGeometry(0.6, 0.85, 0.3, 14), tankColor);
    lid.position.set(tx, h + 2.85, tz);
    b.add(stand, tank, lid);
  }
  // Stair hut
  if (rand() < 0.5) {
    const hut = mesh(new THREE.BoxGeometry(2.4, 2.4, 2.2), wall);
    hut.position.set(-w / 2 + 1.6, h + 1.2, -d / 2 + 1.5);
    const door = mesh(new THREE.BoxGeometry(0.9, 1.8, 0.1), 0x5f6b69, { cast: false });
    door.position.set(-w / 2 + 1.6, h + 0.9, -d / 2 + 2.62);
    b.add(hut, door);
  }
  // TV antenna
  if (rand() < 0.4) {
    const mast = mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 4), C.ink);
    mast.position.set(w / 2 - 1, h + 1.1, -d / 2 + 1);
    const bar = mesh(new THREE.BoxGeometry(1.2, 0.04, 0.04), C.ink);
    bar.position.set(w / 2 - 1, h + 2, -d / 2 + 1);
    b.add(mast, bar);
  }
}

// ---------------------------------------------------------------------------
// Parks, square and street furniture
// ---------------------------------------------------------------------------

function addPark(ctx, bx, bz) {
  const { statics, colliders, rand } = ctx;
  const lawn = mesh(new THREE.BoxGeometry(LOT_HALF * 2, CURB, LOT_HALF * 2, 9, 1, 9), C.grass, { cast: false });
  lawn.position.set(bx, CURB / 2, bz);
  const path = mesh(new THREE.BoxGeometry(LOT_HALF * 2, 0.04, 2), C.sidewalk, { cast: false });
  path.position.set(bx, CURB + 0.02, bz);
  statics.add(lawn, path);
  for (let i = 0; i < 9; i++) {
    const x = bx + (rand() - 0.5) * (LOT_HALF * 2 - 3);
    const z = bz + (rand() - 0.5) * (LOT_HALF * 2 - 3);
    if (Math.abs(z - bz) < 2.5) continue;
    addTree(ctx, x, z, 0.9 + rand() * 0.5);
  }
  for (const side of [-1, 1]) addBench(ctx, bx + side * 3, bz + side * 1.9, side > 0 ? Math.PI : 0);
  // Low hedges along two edges, open on the path ends
  for (const sz of [-1, 1]) {
    const hedge = mesh(new THREE.BoxGeometry(LOT_HALF * 2 - 1, 0.8, 0.8), C.leafDark);
    hedge.position.set(bx, CURB + 0.4, bz + sz * (LOT_HALF - 0.5));
    statics.add(hedge);
    colliders.push({
      type: 'box',
      minX: bx - LOT_HALF,
      maxX: bx + LOT_HALF,
      minZ: bz + sz * (LOT_HALF - 0.5) - 0.4,
      maxZ: bz + sz * (LOT_HALF - 0.5) + 0.4,
    });
  }
}

function addSquare(ctx, bx, bz) {
  const { statics, colliders } = ctx;
  const paving = mesh(new THREE.BoxGeometry(LOT_HALF * 2, CURB, LOT_HALF * 2, 9, 1, 9), 0xd7d6c8, { cast: false });
  paving.position.set(bx, CURB / 2, bz);
  statics.add(paving);
  for (let i = -3; i <= 3; i++) {
    const line = mesh(new THREE.BoxGeometry(LOT_HALF * 2, 0.02, 0.06), 0xbfbfb0, { cast: false });
    line.position.set(bx, CURB + 0.01, bz + i * 2.4);
    const line2 = mesh(new THREE.BoxGeometry(0.06, 0.02, LOT_HALF * 2), 0xbfbfb0, { cast: false });
    line2.position.set(bx + i * 2.4, CURB + 0.01, bz);
    statics.add(line, line2);
  }
  const basin = mesh(new THREE.CylinderGeometry(3, 3.2, 0.8, 20), 0xc9cbc0);
  basin.position.set(bx, CURB + 0.4, bz);
  const pool = mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.1, 20), C.water, { cast: false });
  pool.position.set(bx, CURB + 0.75, bz);
  const pillar = mesh(new THREE.CylinderGeometry(0.35, 0.5, 2, 10), 0xc9cbc0);
  pillar.position.set(bx, CURB + 1.6, bz);
  const bowl = mesh(new THREE.CylinderGeometry(1.2, 0.45, 0.5, 14), 0xc9cbc0);
  bowl.position.set(bx, CURB + 2.6, bz);
  statics.add(basin, pool, pillar, bowl);
  colliders.push({ type: 'circle', x: bx, z: bz, r: 3.3 });
  addTree(ctx, bx - 6, bz - 6, 1.4);
  addTree(ctx, bx + 6, bz + 6, 1.3);
  addBench(ctx, bx + 6, bz - 5, Math.PI / 2);
  addBench(ctx, bx - 6, bz + 5, -Math.PI / 2);
}

function addTree({ statics, colliders, rand }, x, z, s = 1) {
  const tree = new THREE.Group();
  const trunk = mesh(new THREE.CylinderGeometry(0.18, 0.28, 2.6, 7), C.trunk);
  trunk.position.y = 1.3;
  tree.add(trunk);
  const crowns = 3 + Math.floor(rand() * 3);
  for (let i = 0; i < crowns; i++) {
    const r = 1.0 + rand() * 0.7;
    const crown = mesh(new THREE.IcosahedronGeometry(r, 1), i % 2 ? C.leaf : C.leafDark);
    crown.position.set((rand() - 0.5) * 1.8, 3 + rand() * 1.4, (rand() - 0.5) * 1.8);
    tree.add(crown);
  }
  tree.scale.setScalar(s);
  tree.position.set(x, CURB, z);
  tree.rotation.y = rand() * Math.PI * 2;
  statics.add(tree);
  colliders.push({ type: 'circle', x, z, r: 0.35 * s + 0.1 });
}

function addBench({ statics, colliders }, x, z, rot) {
  const bench = new THREE.Group();
  const seat = mesh(new THREE.BoxGeometry(2.2, 0.12, 0.6), 0x9c7a5c);
  seat.position.y = 0.5;
  const back = mesh(new THREE.BoxGeometry(2.2, 0.45, 0.1), 0x9c7a5c);
  back.position.set(0, 0.85, -0.28);
  bench.add(seat, back);
  for (const sx of [-1, 1]) {
    const leg = mesh(new THREE.BoxGeometry(0.1, 0.5, 0.55), C.metal);
    leg.position.set(sx * 0.9, 0.25, 0);
    bench.add(leg);
  }
  bench.position.set(x, CURB, z);
  bench.rotation.y = rot;
  statics.add(bench);
  colliders.push({ type: 'circle', x, z, r: 0.9 });
}

function addUtilityPoles({ statics, colliders }) {
  // Poles run along one sidewalk of every road; wires hang between neighbours
  const SPACING = 15;
  for (const p of ROAD_LINES) {
    const len = Math.sqrt(ROAD_END * ROAD_END - p * p) - 4;
    for (const axis of ['x', 'z']) {
      const across = p + ROAD_HALF + 0.6;
      let prev = null;
      for (let t = -len; t <= len; t += SPACING) {
        if (ROAD_LINES.some((q) => Math.abs(t - q) < CORRIDOR + 0.5)) {
          prev = null;
          continue;
        }
        const [x, z] = axis === 'x' ? [t, across] : [across, t];
        const top = addPole(statics, x, z, axis);
        colliders.push({ type: 'circle', x, z, r: 0.3 });
        if (prev) for (const off of [-0.9, 0, 0.9]) addWire(statics, prev, top, off, axis);
        prev = top;
      }
    }
  }
}

function addPole(statics, x, z, axis) {
  const H = 9;
  // Offsets perpendicular to the road
  const px = axis === 'z' ? 1 : 0;
  const pz = axis === 'x' ? 1 : 0;
  const pole = mesh(new THREE.CylinderGeometry(0.13, 0.18, H, 8), C.pole);
  pole.position.set(x, CURB + H / 2, z);
  const arm = mesh(new THREE.BoxGeometry(px ? 2.2 : 0.12, 0.12, pz ? 2.2 : 0.12), C.pole);
  arm.position.set(x, CURB + H - 0.6, z);
  statics.add(pole, arm);
  for (const off of [-0.9, 0, 0.9]) {
    const ins = mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.2, 6), 0xe9ece4, { cast: false });
    ins.position.set(x + px * off, CURB + H - 0.45, z + pz * off);
    statics.add(ins);
  }
  if (Math.round(Math.abs(x * 7 + z * 13)) % 3 === 0) {
    const tr = mesh(new THREE.CylinderGeometry(0.35, 0.35, 1, 10), 0x9aa59f);
    tr.position.set(x + px * 0.45, CURB + H - 2.3, z + pz * 0.45);
    statics.add(tr);
  }
  const guard = mesh(new THREE.CylinderGeometry(0.21, 0.21, 1.4, 8), 0xe0b43a, { cast: false });
  guard.position.set(x, CURB + 0.7, z);
  statics.add(guard);
  return { top: new THREE.Vector3(x, CURB + H - 0.45, z), px, pz };
}

function addWire(statics, a, b, off) {
  const pa = a.top.clone().add(new THREE.Vector3(a.px * off, 0, a.pz * off));
  const pb = b.top.clone().add(new THREE.Vector3(b.px * off, 0, b.pz * off));
  const mid = pa.clone().lerp(pb, 0.5);
  mid.y -= 0.7;
  const curve = new THREE.QuadraticBezierCurve3(pa, mid, pb);
  const wire = mesh(new THREE.TubeGeometry(curve, 10, 0.03, 4), C.ink, { cast: false, receive: false });
  statics.add(wire);
}

function addStreetProps(ctx) {
  const { statics, colliders, rand, pick, slots, fallbacks } = ctx;
  let modelIndex = 0;
  // Props sit on the building side of each sidewalk, between intersections
  for (const p of ROAD_LINES) {
    const len = Math.sqrt(ROAD_END * ROAD_END - p * p) - 6;
    for (const axis of ['x', 'z']) {
      for (let t = -len; t <= len; t += 5 + rand() * 6) {
        if (ROAD_LINES.some((q) => Math.abs(t - q) < CORRIDOR + 1.5)) continue;
        const side = rand() < 0.5 ? -1 : 1;
        const across = p + side * (ROAD_HALF + WALK - 0.55);
        const [x, z] = axis === 'x' ? [t, across] : [across, t];
        if (Math.hypot(x, z) > ISLAND_RADIUS - 12) continue;
        const rot = axis === 'x' ? (side > 0 ? Math.PI : 0) : side > 0 ? -Math.PI / 2 : Math.PI / 2;
        const r = rand();
        if (r < 0.18) addVendingMachine(statics, x, z, rot, pick);
        else if (r < 0.28) addMailbox(statics, x, z, rot);
        else if (r < 0.45) addPlants(statics, x, z, rand);
        else if (r < 0.55) addCone(statics, x, z);
        else if (r < 0.78) {
          const model = SIDEWALK_MODELS[modelIndex++ % SIDEWALK_MODELS.length];
          const fallback = new THREE.Group();
          if (model === 'bench-01') addBench({ statics: fallback, colliders: [] }, x, z, rot);
          else if (model === 'flower-planter-01') addPlants(fallback, x, z, rand);
          else if (model === 'trash-bin-01') addTrashBin(fallback, x, z);
          fallbacks.add(fallback);
          slots.push({ model, kind: 'prop', x, y: CURB, z, rotation: rot, fallback });
        } else continue;
        colliders.push({ type: 'circle', x, z, r: 0.55 });
      }
    }
  }
  // Bollards and warning signs at intersection corners
  for (const px of ROAD_LINES) {
    for (const pz of ROAD_LINES) {
      if (Math.hypot(px, pz) > ROAD_END - 8) continue;
      for (const [sx, sz] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const cx = px + sx * (CORRIDOR - 0.5);
        const cz = pz + sz * (CORRIDOR - 0.5);
        if (Math.abs(px) <= 30 && Math.abs(pz) <= 30 && sx === sz) {
          const fallback = new THREE.Group();
          addTrafficLight(fallback, cx, cz, Math.atan2(-sx, -sz));
          fallbacks.add(fallback);
          const rotation = Math.atan2(-sx, -sz);
          slots.push({ model: 'traffic-light-01', kind: 'prop', x: cx, y: CURB, z: cz, rotation, fallback });
          colliders.push({ type: 'circle', x: cx, z: cz, r: 0.3 });
        } else if (rand() < 0.5) {
          addBollard(statics, cx, cz);
          colliders.push({ type: 'circle', x: cx, z: cz, r: 0.25 });
        } else if (rand() < 0.4) {
          const fallback = new THREE.Group();
          addRoadSign(fallback, cx, cz, rand);
          fallbacks.add(fallback);
          slots.push({ model: 'street-sign-01', kind: 'prop', x: cx, y: CURB, z: cz, rotation: Math.atan2(sx, sz), fallback });
          colliders.push({ type: 'circle', x: cx, z: cz, r: 0.2 });
        }
      }
    }
  }
}

function addVendingMachine(statics, x, z, rot, pick) {
  const g = new THREE.Group();
  const body = mesh(new THREE.BoxGeometry(1.1, 1.9, 0.8), pick([0xc8463c, 0x3f8fc4, 0xeeeeea, 0x3f9e86]));
  body.position.y = 0.95;
  const panel = mesh(new THREE.BoxGeometry(0.9, 1.0, 0.05), 0xf3f6f0, { cast: false });
  panel.position.set(0, 1.3, 0.41);
  g.add(body, panel);
  const drinks = [0xe85d5d, 0xf2c94c, 0x5fbf8f, 0x4f7fa8, 0xffffff];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 5; c++) {
      const can = mesh(new THREE.BoxGeometry(0.11, 0.2, 0.06), drinks[(r + c) % 5], { cast: false });
      can.position.set(-0.34 + c * 0.17, 1.05 + r * 0.3, 0.44);
      g.add(can);
    }
  }
  const slot = mesh(new THREE.BoxGeometry(0.7, 0.2, 0.06), C.ink, { cast: false });
  slot.position.set(0, 0.35, 0.42);
  g.add(slot);
  g.position.set(x, CURB, z);
  g.rotation.y = rot;
  statics.add(g);
}

function addMailbox(statics, x, z, rot) {
  const g = new THREE.Group();
  const post = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 6), C.metal);
  post.position.y = 0.3;
  const box = mesh(new THREE.BoxGeometry(0.75, 1.0, 0.6), C.red);
  box.position.y = 1.05;
  const roof = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.75, 10, 1, false, 0, Math.PI), C.red);
  roof.rotation.z = Math.PI / 2;
  roof.position.y = 1.55;
  const slot = mesh(new THREE.BoxGeometry(0.4, 0.06, 0.05), C.ink, { cast: false });
  slot.position.set(0, 1.3, 0.31);
  g.add(post, box, roof, slot);
  g.position.set(x, CURB, z);
  g.rotation.y = rot;
  statics.add(g);
}

function addPlants(statics, x, z, rand) {
  for (let i = 0; i < 3; i++) {
    const ox = (rand() - 0.5) * 0.9;
    const oz = (rand() - 0.5) * 0.6;
    const s = 0.7 + rand() * 0.6;
    const pot = mesh(new THREE.CylinderGeometry(0.22 * s, 0.17 * s, 0.4 * s, 8), rand() < 0.5 ? 0xb6795a : 0xd9dcd2);
    pot.position.set(x + ox, CURB + 0.2 * s, z + oz);
    const leaves = mesh(new THREE.IcosahedronGeometry(0.35 * s, 1), rand() < 0.5 ? C.leaf : C.leafDark);
    leaves.position.set(x + ox, CURB + 0.55 * s, z + oz);
    leaves.scale.y = 1.3;
    statics.add(pot, leaves);
  }
}

function addCone(statics, x, z) {
  const base = mesh(new THREE.BoxGeometry(0.55, 0.06, 0.55), 0xe2702f);
  base.position.set(x, CURB + 0.03, z);
  const cone = mesh(new THREE.ConeGeometry(0.22, 0.8, 10), 0xe2702f);
  cone.position.set(x, CURB + 0.46, z);
  const band = mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.14, 10), 0xf4f4ee, { cast: false });
  band.position.set(x, CURB + 0.5, z);
  statics.add(base, cone, band);
}

function addTrashBin(group, x, z) {
  const bin = mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.9, 10), 0x5f8f86);
  bin.position.set(x, CURB + 0.45, z);
  const lid = mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.08, 10), 0x4e6462);
  lid.position.set(x, CURB + 0.94, z);
  group.add(bin, lid);
}

function addTrafficLight(group, x, z, rot) {
  const pole = mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 8), C.metal);
  pole.position.set(x, CURB + 2.1, z);
  const head = new THREE.Group();
  const box = mesh(new THREE.BoxGeometry(0.45, 1.3, 0.35), 0x3a4646);
  head.add(box);
  [0xc8463c, 0xe0b43a, 0x5fbf8f].forEach((c, i) => {
    const lamp = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 10), c, { cast: false });
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(0, 0.38 - i * 0.38, 0.19);
    head.add(lamp);
  });
  head.position.set(x, CURB + 4.6, z);
  head.rotation.y = rot;
  group.add(pole, head);
}

function addBollard(statics, x, z) {
  for (let i = 0; i < 4; i++) {
    const seg = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.22, 8), i % 2 ? C.ink : 0xe0b43a);
    seg.position.set(x, CURB + 0.11 + i * 0.22, z);
    statics.add(seg);
  }
}

function addRoadSign(statics, x, z, rand) {
  const pole = mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6), C.metal);
  pole.position.set(x, CURB + 1.3, z);
  const yaw = rand() * Math.PI * 2;
  const plate = mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 3), C.red);
  const inner = mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 3), 0xf4f4ee, { cast: false });
  for (const m of [plate, inner]) {
    m.rotation.set(Math.PI / 2, yaw, Math.PI / 2, 'YXZ');
    m.position.set(x, CURB + 2.7, z);
  }
  statics.add(pole, plate, inner);
}

// ---------------------------------------------------------------------------
// Landmarks and the edge of town
// ---------------------------------------------------------------------------

function addPier({ statics, dynamic, updaters }) {
  const len = PIER.end - PIER.start;
  const deck = mesh(new THREE.BoxGeometry(PIER.halfWidth * 2, 0.25, len, 1, 1, 14), 0xa98a6c);
  deck.position.set(0, 0.22, PIER.start + len / 2);
  statics.add(deck);
  for (let z = PIER.start + 1; z < PIER.end; z += 1.1) {
    const seam = mesh(new THREE.BoxGeometry(PIER.halfWidth * 2, 0.02, 0.06), 0x8a6e55, { cast: false });
    seam.position.set(0, 0.36, z);
    statics.add(seam);
  }
  for (let z = PIER.start + 3; z <= PIER.end; z += 4) {
    for (const sx of [-1, 1]) {
      const post = mesh(new THREE.CylinderGeometry(0.16, 0.16, 3.4, 8), C.trunk);
      post.position.set(sx * (PIER.halfWidth - 0.1), -0.8, z);
      const cap = mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.7, 8), C.trunk);
      cap.position.set(sx * (PIER.halfWidth - 0.1), 0.6, z);
      statics.add(post, cap);
    }
  }
  const boat = new THREE.Group();
  const hull = mesh(new THREE.BoxGeometry(1.6, 0.6, 4), 0xe9ece4);
  const stripe = mesh(new THREE.BoxGeometry(1.62, 0.15, 4.02), C.red);
  stripe.position.y = 0.1;
  const cabin = mesh(new THREE.BoxGeometry(1.2, 0.9, 1.2), 0x6fb5c9);
  cabin.position.set(0, 0.7, -0.6);
  boat.add(hull, stripe, cabin);
  boat.position.set(4.8, -1.1, PIER.end - 7);
  dynamic.add(boat);
  updaters.push((t) => {
    boat.position.y = -1.15 + Math.sin(t * 1.2) * 0.1;
    boat.rotation.z = Math.sin(t * 1.0) * 0.05;
    boat.rotation.x = Math.cos(t * 0.8) * 0.03;
  });
}

function addLighthouse(ctx) {
  const { statics, dynamic, colliders, updaters } = ctx;
  const { x, z } = LIGHTHOUSE;
  const base = mesh(new THREE.CylinderGeometry(5.5, 6, CURB + 0.3, 20), 0xc9cbc0, { cast: false });
  base.position.set(x, (CURB + 0.3) / 2, z);
  statics.add(base);
  const towerH = 16;
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const r0 = 2.6 - (i / segs) * 0.9;
    const r1 = 2.6 - ((i + 1) / segs) * 0.9;
    const seg = mesh(new THREE.CylinderGeometry(r1, r0, towerH / segs, 16), i % 2 ? 0xf1f1ea : C.red);
    seg.position.set(x, 0.45 + (i + 0.5) * (towerH / segs), z);
    statics.add(seg);
  }
  const gallery = mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.3, 16), 0x4f5c5a);
  gallery.position.set(x, towerH + 0.6, z);
  const lamp = mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.6, 12), 0xfff3c4);
  lamp.position.set(x, towerH + 1.55, z);
  const roof = mesh(new THREE.ConeGeometry(1.5, 1.5, 12), C.red);
  roof.position.set(x, towerH + 3.1, z);
  const door = mesh(new THREE.BoxGeometry(1.2, 2.1, 0.3), 0x5f6b69, { cast: false });
  door.position.set(x + 1.9, 1.4, z + 1.9);
  door.rotation.y = Math.PI / 4;
  statics.add(gallery, lamp, roof, door);
  colliders.push({ type: 'circle', x, z, r: 2.8 });

  // A short line of old telegraph poles leading to the lighthouse (model only)
  for (let i = 0; i < 3; i++) {
    ctx.slots.push({ model: 'telegraph-pole', kind: 'prop', x: x + 7, y: CURB, z: z + 7 - i * 6, rotation: 0, collider: true });
  }

  const beamGeo = new THREE.ConeGeometry(1.4, 20, 10, 1, true);
  beamGeo.translate(0, -10, 0);
  beamGeo.rotateZ(Math.PI / 2);
  const beam = new THREE.Mesh(
    beamGeo,
    new THREE.MeshBasicMaterial({
      color: 0xfff6d0,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    })
  );
  beam.userData.noOutline = true;
  beam.position.set(x, towerH + 1.55, z);
  dynamic.add(beam);
  updaters.push((t) => (beam.rotation.y = t * 0.5));
}

function addOuterGreenery(ctx) {
  const { rand } = ctx;
  for (let i = 0; i < 260; i++) {
    const a = rand() * Math.PI * 2;
    const r = 20 + rand() * (ISLAND_RADIUS - 24);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (inCorridor(x, z, 1)) continue;
    if (Math.hypot(x - LIGHTHOUSE.x, z - LIGHTHOUSE.z) < 8) continue;
    const bx = BLOCK_CENTERS.find((c) => Math.abs(x - c) <= 15);
    const bz = BLOCK_CENTERS.find((c) => Math.abs(z - c) <= 15);
    if (bx !== undefined && bz !== undefined && blockExists(bx, bz)) continue;
    addTree(ctx, x, z, 0.8 + rand() * 0.6);
  }
}

/**
 * Merges every static mesh into one mesh per material, turning thousands of
 * draw calls into a few dozen.
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
      const keep = name === 'position' || name === 'normal' || (name === 'uv' && o.material.map);
      if (!keep) g.deleteAttribute(name);
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
