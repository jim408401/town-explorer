import * as THREE from 'three';
import { createTown, ISLAND_RADIUS } from './town.js';
import { createCharacter } from './character.js';
import { createVillagers, faceTowards } from './villagers.js';
import { moveWithCollisions } from './physics.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { cutout, faceted, mesh } from './materials.js';

const WALK_SPEED = 6;
const RUN_SPEED = 11;
const PLAYER_RADIUS = 0.6;
const CAMERA_PITCH = 0.72;

// ---- Renderer, scene, lights ----
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = skyTexture();
scene.fog = new THREE.Fog(0xf6dcc0, 70, 190);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 600);

// Warm late-afternoon light
scene.add(new THREE.HemisphereLight(0xfff1dc, 0x8fb37a, 1.4));
const sun = new THREE.DirectionalLight(0xffd9a8, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 150 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(-35, 55, 25);

// ---- World ----
const town = createTown();
scene.add(town.group);
const clouds = createClouds();
scene.add(clouds.group);

const player = createCharacter();
scene.add(player.root);
const villagers = createVillagers(scene, town);

// URL params like ?x=0&z=20&yaw=0 are handy for testing specific spots
const params = new URLSearchParams(location.search);
player.root.position.set(Number(params.get('x') ?? 0), 0, Number(params.get('z') ?? 22));
player.root.rotation.y = Math.PI;

const cam = {
  yaw: Number(params.get('yaw') ?? 0),
  distance: Number(params.get('dist') ?? 20),
  target: player.root.position.clone().add(new THREE.Vector3(0, 1.4, 0)),
};

// ---- Input, audio, UI ----
const audio = createAudio();
const input = createInput(renderer.domElement, () => audio.start());
const ui = {
  mute: document.getElementById('mute'),
  prompt: document.getElementById('prompt'),
  bubble: document.getElementById('bubble'),
  bubbleName: document.getElementById('bubble-name'),
  bubbleText: document.getElementById('bubble-text'),
  talk: document.getElementById('talk'),
};
const isTouch = matchMedia('(pointer: coarse)').matches;

function toggleMute() {
  audio.start();
  ui.mute.textContent = audio.toggleMute() ? '🔇' : '🔊';
}
ui.mute.addEventListener('click', toggleMute);
input.onKey('KeyM', toggleMute);

let nearby = null;
let speaking = null;
function talk() {
  if (!nearby) return;
  speaking = nearby;
  ui.bubbleName.textContent = nearby.name;
  ui.bubbleText.textContent = villagers.talk(nearby);
  ui.bubble.style.display = 'block';
}
input.onKey('Space', talk);
input.onKey('Enter', talk);
ui.talk.addEventListener('click', talk);

// ---- Main loop ----
const clock = new THREE.Clock();
const move = new THREE.Vector3();
const headPos = new THREE.Vector3();
let stepDistance = 0;

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  // Camera rotation from drag / keys / wheel
  cam.yaw += input.consumeYaw() + input.yawKeys() * dt * 2;
  cam.distance = THREE.MathUtils.clamp(cam.distance + input.consumeZoom(), 9, 30);

  // Movement relative to the camera
  const { forward, right, run } = input.moveAxes();
  const fx = -Math.sin(cam.yaw);
  const fz = -Math.cos(cam.yaw);
  move.set(fx * forward - fz * right, 0, fz * forward + fx * right);
  const amount = Math.min(move.length(), 1);
  const p = player.root.position;
  if (amount > 0.05) {
    move.normalize().multiplyScalar(amount * (run ? RUN_SPEED : WALK_SPEED) * dt);
    const next = moveWithCollisions(p.x, p.z, move.x, move.z, PLAYER_RADIUS, town.colliders, town.isWalkable);
    const moved = Math.hypot(next.x - p.x, next.z - p.z);
    p.x = next.x;
    p.z = next.z;
    faceTowards(player.root, move.x, move.z, dt);
    player.animate(dt, run ? 1.8 : amount, time);

    stepDistance += moved;
    if (stepDistance > (run ? 2.2 : 1.6)) {
      stepDistance = 0;
      audio.footstep(Math.abs(p.x) < 2.2 && p.z > ISLAND_RADIUS - 6);
    }
  } else {
    player.animate(dt, 0, time);
  }
  audio.setShoreProximity(THREE.MathUtils.clamp((Math.hypot(p.x, p.z) - 50) / 40, 0, 1));

  // Villagers and chatting
  nearby = villagers.update(dt, time, p);
  if (speaking && speaking !== nearby) {
    speaking = null;
    ui.bubble.style.display = 'none';
  }
  if (nearby) {
    nearby.ch.root.getWorldPosition(headPos);
    headPos.y += nearby.ch.height + 0.4;
    const screen = toScreen(headPos);
    const el = speaking ? ui.bubble : ui.prompt;
    el.style.left = `${screen.x}px`;
    el.style.top = `${screen.y}px`;
    if (!speaking) {
      ui.prompt.textContent = isTouch ? nearby.name : `${nearby.name}　按空白鍵聊天`;
      ui.prompt.style.display = 'block';
    } else {
      ui.prompt.style.display = 'none';
    }
    ui.talk.style.display = isTouch ? 'block' : 'none';
  } else {
    ui.prompt.style.display = 'none';
    ui.talk.style.display = 'none';
  }

  // Smooth third-person follow camera
  cam.target.lerp(headPos.set(p.x, 1.4, p.z), 1 - Math.exp(-dt * 6));
  const horiz = Math.cos(CAMERA_PITCH) * cam.distance;
  camera.position.set(
    cam.target.x + Math.sin(cam.yaw) * horiz,
    cam.target.y + Math.sin(CAMERA_PITCH) * cam.distance,
    cam.target.z + Math.cos(cam.yaw) * horiz
  );
  camera.lookAt(cam.target);
  cutout.uCutCam.value.copy(camera.position);
  cutout.uCutTarget.value.set(p.x, 2.2, p.z);

  // Shadow camera follows the player so shadows stay crisp everywhere
  sun.target.position.set(p.x, 0, p.z);
  sun.position.copy(sun.target.position).add(SUN_OFFSET);

  town.update(time);
  clouds.update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Exposed for debugging in the browser console
window.__game = { player, cam, villagers, town };

// ---- Helpers ----
function toScreen(v) {
  const s = v.clone().project(camera);
  return { x: (s.x * 0.5 + 0.5) * window.innerWidth, y: (-s.y * 0.5 + 0.5) * window.innerHeight };
}

function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#8ec9e8');
  grad.addColorStop(0.55, '#cfe3e6');
  grad.addColorStop(1, '#f6dcc0');
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createClouds() {
  const group = new THREE.Group();
  const list = [];
  for (let i = 0; i < 14; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(Math.random() * 3);
    for (let j = 0; j < puffs; j++) {
      const puff = mesh(faceted(new THREE.IcosahedronGeometry(2 + Math.random() * 2, 0)), 0xffffff, {
        cast: false,
        receive: false,
      });
      puff.position.set(j * 2.6 - puffs * 1.3, Math.random() * 1.2, Math.random() * 2 - 1);
      cloud.add(puff);
    }
    cloud.position.set(Math.random() * 300 - 150, 32 + Math.random() * 14, Math.random() * 300 - 150);
    cloud.userData.speed = 1 + Math.random() * 1.5;
    group.add(cloud);
    list.push(cloud);
  }
  return {
    group,
    update(dt) {
      for (const c of list) {
        c.position.x += c.userData.speed * dt;
        if (c.position.x > 160) c.position.x = -160;
      }
    },
  };
}
