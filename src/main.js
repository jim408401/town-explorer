import * as THREE from 'three';
import { createTown } from './town.js';
import { createCharacter } from './character.js';
import { createVillagers, faceTowards } from './villagers.js';
import { moveWithCollisions } from './physics.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { world } from './materials.js';
import { createInkRenderer } from './post.js';
import { createSky } from './sky.js';
import { loadModels } from './models.js';

const WALK_SPEED = 5;
const RUN_SPEED = 9.5;
const PLAYER_RADIUS = 0.45;
const CAMERA_PITCH = 0.2;
const LOOK_HEIGHT = 2.1;

// ---- Renderer, scene, lights ----
const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
const pixelRatio = Math.min(window.devicePixelRatio, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9fdccd, 55, 175);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 400);

// Bright, slightly teal light: shadows read as flat blue-green shapes
scene.add(new THREE.HemisphereLight(0xeafff8, 0x86aaa3, 1.35));
const sun = new THREE.DirectionalLight(0xfffbf0, 2.1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35, near: 1, far: 160 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
const SUN_OFFSET = new THREE.Vector3(-30, 60, 22);

const sky = createSky();
scene.add(sky.mesh);

const ink = createInkRenderer(renderer, scene, camera);
ink.setSize(window.innerWidth, window.innerHeight, pixelRatio);

// ---- World ----
const town = createTown();
scene.add(town.group);
// Optional GLB models in public/models/ replace their procedural stand-ins
loadModels(town).then((names) => {
  if (names.length) console.info(`Loaded models: ${names.join(', ')}`);
  window.__modelsLoaded = names;
});

const player = createCharacter();
scene.add(player.root);
const villagers = createVillagers(scene, town);

// URL params like ?x=0&z=20&yaw=0 are handy for testing specific spots
const params = new URLSearchParams(location.search);
player.root.position.set(Number(params.get('x') ?? 0), 0, Number(params.get('z') ?? 18));
player.root.rotation.y = Math.PI;

const cam = {
  yaw: Number(params.get('yaw') ?? 0),
  distance: Number(params.get('dist') ?? 7.5),
  target: player.root.position.clone().add(new THREE.Vector3(0, LOOK_HEIGHT, 0)),
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
  ui.mute.classList.toggle('off', audio.toggleMute());
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
const tmp = new THREE.Vector3();
let stepDistance = 0;

function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  cam.yaw += input.consumeYaw() + input.yawKeys() * dt * 2;
  cam.distance = THREE.MathUtils.clamp(cam.distance + input.consumeZoom() * 0.5, 4.5, 16);

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
    if (stepDistance > (run ? 1.9 : 1.3)) {
      stepDistance = 0;
      audio.footstep(Math.hypot(p.x, p.z) > 98);
    }
  } else {
    player.animate(dt, 0, time);
  }
  p.y += (town.groundHeight(p.x, p.z) - p.y) * Math.min(1, dt * 15);
  audio.setShoreProximity(THREE.MathUtils.clamp((Math.hypot(p.x, p.z) - 60) / 35, 0, 1));

  // Villagers and chatting
  nearby = villagers.update(dt, time, p);
  if (speaking && speaking !== nearby) {
    speaking = null;
    ui.bubble.style.display = 'none';
  }
  if (nearby) {
    nearby.ch.root.getWorldPosition(tmp);
    tmp.y += nearby.ch.height + 0.35;
    const screen = toScreen(tmp);
    const el = speaking ? ui.bubble : ui.prompt;
    el.style.left = `${screen.x}px`;
    el.style.top = `${screen.y}px`;
    ui.prompt.style.display = speaking ? 'none' : 'block';
    if (!speaking) ui.prompt.textContent = isTouch ? nearby.name : `${nearby.name}　按空白鍵聊天`;
    ui.talk.style.display = isTouch ? 'block' : 'none';
  } else {
    ui.prompt.style.display = 'none';
    ui.talk.style.display = 'none';
  }

  // Low third-person follow camera, looking slightly up the street
  cam.target.lerp(tmp.set(p.x, p.y + LOOK_HEIGHT, p.z), 1 - Math.exp(-dt * 7));
  const horiz = Math.cos(CAMERA_PITCH) * cam.distance;
  camera.position.set(
    cam.target.x + Math.sin(cam.yaw) * horiz,
    cam.target.y + Math.sin(CAMERA_PITCH) * cam.distance + 0.4,
    cam.target.z + Math.cos(cam.yaw) * horiz
  );
  camera.lookAt(cam.target.x, cam.target.y + 0.6, cam.target.z);

  // World shader uniforms: bend around the player, cut away walls in the way
  world.uCurveCenter.value.set(p.x, 0, p.z);
  world.uCutCam.value.copy(camera.position);
  world.uCutTarget.value.set(p.x, p.y + 1.2, p.z);

  sun.target.position.set(p.x, 0, p.z);
  sun.position.copy(sun.target.position).add(SUN_OFFSET);
  sky.mesh.position.copy(camera.position);

  town.update(time);
  ink.render();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  ink.setSize(window.innerWidth, window.innerHeight, pixelRatio);
});

// Exposed for debugging in the browser console
window.__game = { player, cam, villagers, town, world };

function toScreen(v) {
  // Apply the same bend as the shaders so labels sit on the heads
  const s = v.clone();
  const dx = s.x - world.uCurveCenter.value.x;
  const dz = s.z - world.uCurveCenter.value.z;
  s.y -= (dx * dx + dz * dz) * world.uCurvature.value;
  s.project(camera);
  return { x: (s.x * 0.5 + 0.5) * window.innerWidth, y: (-s.y * 0.5 + 0.5) * window.innerHeight };
}
