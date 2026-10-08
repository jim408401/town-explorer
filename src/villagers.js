import * as THREE from 'three';
import { createCharacter } from './character.js';
import { moveWithCollisions } from './physics.js';

const VILLAGERS = [
  { name: '麵包師傅 阿麥', look: { shirt: 0xf4f4ee, shorts: 0x8a7a6a, hair: 0xe9e4d6, hairStyle: 'cap', bag: null }, lines: ['今天的可頌剛出爐，香吧？', '廣場旁邊那排店都是老朋友開的。'] },
  { name: '漁夫 老陳', look: { shirt: 0x5f8f86, shorts: 0x3a4646, hair: 0xd8c08a, hairStyle: 'hat', bag: null }, lines: ['南邊的碼頭可以看到整片海。', '我的小船就停在碼頭旁邊。'] },
  { name: '郵差 小羽', look: { shirt: 0x4f7fa8, shorts: 0x2a3434, hair: 0x2a3434, hairStyle: 'cap', bag: 0xe0a33a }, lines: ['這個鎮上每一戶我都送過信！', '迷路的話，沿著電線桿走就會回到大路。'] },
  { name: '畫家 莉莉', look: { shirt: 0xe7bdb4, shorts: 0x5a4a6a, hair: 0x6b4a3a, hairStyle: 'bob', bag: null }, lines: ['午後的光線最適合畫畫了。', '你有去過西邊的燈塔嗎？'] },
  { name: '園丁 阿樹', look: { shirt: 0x8fbf7a, shorts: 0x6b5a48, hair: 0x2a3434, hairStyle: 'hat', bag: null }, lines: ['公園裡的花是我種的喔。', '慢慢走，鎮上有很多角落可以發現。'] },
  { name: '學生 小米', look: { shirt: 0xf4f4ee, shorts: 0x2f4f6f, hair: 0x23272b, hairStyle: 'bob', bag: 0x3f9e86 }, lines: ['放學後我最喜歡在鎮上亂逛。', '自動販賣機的汽水最好喝了！'] },
];

const WALK_SPEED = 2.0;

/** Villagers wander between road intersections and stop to chat when the player is near. */
export function createVillagers(scene, town) {
  const { navNodes, colliders, isWalkable } = town;
  const list = VILLAGERS.map((def, i) => {
    const ch = createCharacter({ ...def.look, skin: [0xf3d2b5, 0xe2b48f, 0xc98e6b][i % 3] });
    const start = navNodes[(i * 5 + 3) % navNodes.length];
    ch.root.position.set(start.x, 0, start.z);
    scene.add(ch.root);
    return { ...def, ch, node: start, target: start, pause: Math.random() * 2, lineIndex: 0 };
  });

  const tmp = new THREE.Vector3();

  function update(dt, time, player) {
    let nearest = null;
    let nearestDist = Infinity;
    for (const v of list) {
      const p = v.ch.root.position;
      const toPlayer = Math.hypot(player.x - p.x, player.z - p.z);
      if (toPlayer < nearestDist) {
        nearestDist = toPlayer;
        nearest = v;
      }

      if (toPlayer < 3.5) {
        // Turn to face the player and wait
        faceTowards(v.ch.root, player.x - p.x, player.z - p.z, dt);
        v.ch.animate(dt, 0, time);
        continue;
      }
      if (v.pause > 0) {
        v.pause -= dt;
        v.ch.animate(dt, 0, time);
        continue;
      }

      tmp.set(v.target.x - p.x, 0, v.target.z - p.z);
      const dist = tmp.length();
      if (dist < 0.3) {
        v.node = v.target;
        const links = v.node.links;
        v.target = navNodes[links[Math.floor(Math.random() * links.length)]];
        v.pause = Math.random() < 0.4 ? 1 + Math.random() * 3 : 0;
        continue;
      }
      tmp.normalize().multiplyScalar(Math.min(dist, WALK_SPEED * dt));
      const next = moveWithCollisions(p.x, p.z, tmp.x, tmp.z, 0.6, colliders, isWalkable);
      p.x = next.x;
      p.z = next.z;
      p.y = town.groundHeight(p.x, p.z);
      faceTowards(v.ch.root, tmp.x, tmp.z, dt);
      v.ch.animate(dt, 0.8, time);
    }
    return nearestDist < 3.5 ? nearest : null;
  }

  function talk(v) {
    const line = v.lines[v.lineIndex % v.lines.length];
    v.lineIndex++;
    return line;
  }

  return { list, update, talk };
}

export function faceTowards(obj, dx, dz, dt) {
  if (Math.abs(dx) + Math.abs(dz) < 1e-5) return;
  const target = Math.atan2(dx, dz);
  let diff = target - obj.rotation.y;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  obj.rotation.y += diff * Math.min(1, dt * 10);
}
