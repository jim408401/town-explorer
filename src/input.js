/**
 * Keyboard, mouse and touch input.
 * - Keyboard: WASD / arrows to move, Shift to run, Q/E to rotate the camera.
 * - Mouse: drag to rotate the camera, wheel to zoom.
 * - Touch: drag on the left half for a virtual joystick, right half to rotate.
 */
export function createInput(canvas, onFirstGesture) {
  const keys = new Set();
  const keyHandlers = new Map();
  let yawDelta = 0;
  let zoomDelta = 0;

  const joystickEl = document.getElementById('joystick');
  const knobEl = document.getElementById('knob');
  const JOY_RADIUS = 50;
  let joy = null; // { id, x, y, dx, dy }
  const drags = new Map(); // pointerId -> last x

  window.addEventListener('keydown', (e) => {
    onFirstGesture();
    if (e.repeat) return;
    keys.add(e.code);
    const handler = keyHandlers.get(e.code);
    if (handler) {
      e.preventDefault();
      handler();
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('pointerdown', (e) => {
    onFirstGesture();
    canvas.setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch' && e.clientX < window.innerWidth / 2 && !joy) {
      joy = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
      joystickEl.style.left = `${e.clientX}px`;
      joystickEl.style.top = `${e.clientY}px`;
      joystickEl.style.display = 'block';
      knobEl.style.transform = '';
    } else {
      drags.set(e.pointerId, e.clientX);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (joy && e.pointerId === joy.id) {
      let dx = e.clientX - joy.x;
      let dy = e.clientY - joy.y;
      const len = Math.hypot(dx, dy);
      if (len > JOY_RADIUS) {
        dx = (dx / len) * JOY_RADIUS;
        dy = (dy / len) * JOY_RADIUS;
      }
      joy.dx = dx / JOY_RADIUS;
      joy.dy = dy / JOY_RADIUS;
      knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (drags.has(e.pointerId)) {
      yawDelta -= (e.clientX - drags.get(e.pointerId)) * 0.006;
      drags.set(e.pointerId, e.clientX);
    }
  });
  const end = (e) => {
    if (joy && e.pointerId === joy.id) {
      joy = null;
      joystickEl.style.display = 'none';
    }
    drags.delete(e.pointerId);
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      zoomDelta += e.deltaY * 0.01;
    },
    { passive: false }
  );

  const down = (...codes) => codes.some((c) => keys.has(c));

  return {
    onKey(code, fn) {
      keyHandlers.set(code, fn);
    },
    moveAxes() {
      let forward = (down('KeyW', 'ArrowUp') ? 1 : 0) - (down('KeyS', 'ArrowDown') ? 1 : 0);
      let right = (down('KeyD', 'ArrowRight') ? 1 : 0) - (down('KeyA', 'ArrowLeft') ? 1 : 0);
      let run = down('ShiftLeft', 'ShiftRight');
      if (joy) {
        forward = -joy.dy;
        right = joy.dx;
        run = Math.hypot(joy.dx, joy.dy) > 0.95;
      }
      return { forward, right, run };
    },
    yawKeys() {
      return (down('KeyQ') ? 1 : 0) - (down('KeyE') ? 1 : 0);
    },
    consumeYaw() {
      const v = yawDelta;
      yawDelta = 0;
      return v;
    },
    consumeZoom() {
      const v = zoomDelta;
      zoomDelta = 0;
      return v;
    },
  };
}
