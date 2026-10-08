import * as THREE from 'three';
import { createNormalDepthMaterial } from './materials.js';

/**
 * Two-pass "ink" renderer:
 *  1. the scene in colour (MSAA) into a render target
 *  2. the scene again with a normal + depth override material
 *  3. a full-screen pass that draws dark lines wherever normals or depth jump,
 *     plus a little paper grain, like a hand-inked comic panel.
 * Objects with `userData.noOutline` are hidden during the normal pass.
 */
export function createInkRenderer(renderer, scene, camera) {
  const colorRT = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
  const ndRT = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });
  const ndMaterial = createNormalDepthMaterial();
  ndMaterial.uniforms.uFar.value = camera.far;

  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: colorRT.texture },
        tND: { value: ndRT.texture },
        uTexel: { value: new THREE.Vector2() },
        uThickness: { value: 1 },
        uInk: { value: new THREE.Color(0x1d2a2b) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor;
        uniform sampler2D tND;
        uniform vec2 uTexel;
        uniform float uThickness;
        uniform vec3 uInk;
        varying vec2 vUv;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

        void main() {
          vec4 c = texture2D(tND, vUv);
          vec2 o = uTexel * uThickness;
          vec4 n1 = texture2D(tND, vUv + vec2(o.x, 0.0));
          vec4 n2 = texture2D(tND, vUv - vec2(o.x, 0.0));
          vec4 n3 = texture2D(tND, vUv + vec2(0.0, o.y));
          vec4 n4 = texture2D(tND, vUv - vec2(0.0, o.y));

          // Normal creases
          vec3 nc = c.rgb * 2.0 - 1.0;
          float crease = 0.0;
          crease = max(crease, 1.0 - dot(nc, n1.rgb * 2.0 - 1.0));
          crease = max(crease, 1.0 - dot(nc, n2.rgb * 2.0 - 1.0));
          crease = max(crease, 1.0 - dot(nc, n3.rgb * 2.0 - 1.0));
          crease = max(crease, 1.0 - dot(nc, n4.rgb * 2.0 - 1.0));
          float edgeN = smoothstep(0.18, 0.35, crease);

          // Silhouettes: Laplacian of inverse depth is ~0 on flat surfaces
          float ic = 1.0 / max(c.a, 1e-4);
          float lap = abs(4.0 * ic - 1.0 / max(n1.a, 1e-4) - 1.0 / max(n2.a, 1e-4)
                                   - 1.0 / max(n3.a, 1e-4) - 1.0 / max(n4.a, 1e-4)) / ic;
          float edgeD = smoothstep(0.15, 0.4, lap);

          // Fade lines into the distance so the horizon stays soft
          float fade = 1.0 - smoothstep(0.35, 0.8, c.a);
          float edge = max(edgeN, edgeD) * fade;

          vec3 col = texture2D(tColor, vUv).rgb;
          col = mix(col, uInk, edge * 0.92);
          // Paper grain and a gentle vignette
          col += (hash(vUv * 1000.0) - 0.5) * 0.025;
          vec2 v = vUv - 0.5;
          col *= 1.0 - dot(v, v) * 0.35;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
      depthTest: false,
      depthWrite: false,
    })
  );
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const hidden = [];
  const clearColor = new THREE.Color(0.5, 0.5, 1.0);

  function setSize(w, h, pixelRatio) {
    const pw = Math.floor(w * pixelRatio);
    const ph = Math.floor(h * pixelRatio);
    colorRT.setSize(pw, ph);
    ndRT.setSize(pw, ph);
    quad.material.uniforms.uTexel.value.set(1 / pw, 1 / ph);
    quad.material.uniforms.uThickness.value = Math.max(1, pixelRatio * 0.9);
  }

  function render() {
    // 1. colour
    renderer.setRenderTarget(colorRT);
    renderer.render(scene, camera);

    // 2. normals + depth (no sky, no transparent effects, no shadows needed)
    hidden.length = 0;
    scene.traverseVisible((o) => {
      if (o.userData.noOutline) hidden.push(o);
    });
    hidden.forEach((o) => (o.visible = false));
    const bg = scene.background;
    const fog = scene.fog;
    scene.background = null;
    scene.fog = null;
    scene.overrideMaterial = ndMaterial;
    const shadows = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setClearColor(clearColor, 1);
    renderer.setRenderTarget(ndRT);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.shadowMap.autoUpdate = shadows;
    scene.overrideMaterial = null;
    scene.background = bg;
    scene.fog = fog;
    hidden.forEach((o) => (o.visible = true));

    // 3. composite to screen
    renderer.setRenderTarget(null);
    renderer.render(quadScene, quadCam);
  }

  return { render, setSize };
}
