import * as THREE from 'three';
import { seededRandom } from './materials.js';

/**
 * Painted sky dome: a teal gradient with soft, streaky anime-style clouds drawn
 * onto an equirectangular canvas. The dome follows the camera.
 */
export function createSky() {
  const W = 2048;
  const H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const rand = seededRandom(7);

  const grad = g.createLinearGradient(0, 0, 0, H / 2);
  grad.addColorStop(0, '#4fbfae');
  grad.addColorStop(0.6, '#7fd3c2');
  grad.addColorStop(1, '#a9e4d6');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H / 2);
  g.fillStyle = '#a9e4d6';
  g.fillRect(0, H / 2, W, H / 2);

  // Draw each cloud twice so it wraps seamlessly around the dome
  const wrap = (fn) => {
    fn(0);
    fn(W);
    fn(-W);
  };

  // Long thin streaks high up
  for (let i = 0; i < 40; i++) {
    const x = rand() * W;
    const y = 60 + rand() * 300;
    const len = 120 + rand() * 360;
    const thick = 3 + rand() * 7;
    wrap((ox) => {
      g.strokeStyle = 'rgba(196, 240, 228, 0.75)';
      g.lineWidth = thick;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x + ox, y);
      g.bezierCurveTo(x + ox + len * 0.3, y - 8, x + ox + len * 0.7, y + 10, x + ox + len, y - 4);
      g.stroke();
    });
  }

  // Puffy cloud banks: a lit body with a slightly darker teal underside
  for (let i = 0; i < 22; i++) {
    const cx = rand() * W;
    const cy = 250 + rand() * 230;
    const width = 120 + rand() * 260;
    const puffs = [];
    for (let j = 0; j < 14; j++) {
      puffs.push([
        cx + (rand() - 0.5) * width,
        cy - rand() * width * 0.18,
        20 + rand() * width * 0.16,
        8 + rand() * width * 0.08,
      ]);
    }
    wrap((ox) => {
      g.fillStyle = 'rgba(142, 214, 198, 0.9)';
      for (const [x, y, rx, ry] of puffs) {
        g.beginPath();
        g.ellipse(x + ox, y + 6, rx, ry, 0, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = 'rgba(214, 246, 236, 0.95)';
      for (const [x, y, rx, ry] of puffs) {
        g.beginPath();
        g.ellipse(x + ox, y, rx * 0.92, ry * 0.85, 0, 0, Math.PI * 2);
        g.fill();
      }
    });
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(300, 48, 24),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false })
  );
  mesh.renderOrder = -1;
  mesh.userData.noOutline = true;
  return { mesh };
}
