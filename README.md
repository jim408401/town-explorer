# Town Explorer

A small seaside town drawn in a hand-inked, anime-style look that you can wander around in the browser.
Built with [Three.js](https://threejs.org/) and [Vite](https://vitejs.dev/), inspired by the mood of [Messenger](https://messenger.abeto.co/).

![Screenshot](docs/screenshot.png)

## Features

- Ink-outline post-processing (normal + depth edge detection), flat two-tone cel shading and paper grain
- "Tiny planet" horizon: the world bends away from the player in the vertex shader
- Dense streets: asphalt roads with lane markings and zebra crossings, sidewalks, utility poles with sagging wires,
  vending machines, mailboxes, bollards and road signs
- Concrete apartment blocks with balconies, air conditioners, rooftop water tanks and Chinese shop signs
- A square with a fountain, pocket parks, a pier with a boat and a lighthouse on the shore
- Villagers who wander the streets and stop to chat when you walk up to them
- Procedural ambience (waves, birds, a quiet music-box melody, footsteps) with a mute toggle
- Walls between the camera and the player are cut away so you never lose your character
- Optional free GLB models from Three.js Assets (see below)

## Controls

| Action | Desktop | Mobile |
| --- | --- | --- |
| Move | WASD / arrow keys | Drag on the left half of the screen |
| Run | Hold Shift | Push the joystick all the way |
| Rotate camera | Drag with the mouse, or Q / E | Drag on the right half of the screen |
| Zoom | Mouse wheel | – |
| Talk | Space / Enter near a villager | Tap the "聊天" button |
| Mute | M or the speaker button | Speaker button |

## Getting started

```bash
npm install
npm run dev      # start the dev server
npm run build    # production build into dist/
npm run preview  # serve the production build
```

Handy for testing: URL parameters `?x=0&z=100&yaw=0.6&dist=10` set the starting position, camera angle and distance.

## Optional 3D models

`src/models.js` loads GLB files from `public/models/` with `GLTFLoader` (plus `DRACOLoader`; the decoder lives in
`public/draco/`). The models come from [Three.js Assets](https://threejsassets.com/) under their Free Commercial
License, which does not allow redistributing the files, so they are **not committed**.
`public/models/CREDITS.md` lists every file with its source page; download them there and drop them in the folder.
Missing models fall back to procedural stand-ins, so the game always works without them.

## Deploying to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and deploys on every push to `main`.
Enable it once under **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## Project layout

```
src/
  main.js        renderer, lights, camera, game loop and UI
  town.js        procedural town: island, roads, houses, parks, pier, lighthouse
  character.js   low-poly character builder and walk animation
  villagers.js   wandering NPCs and their dialogue lines
  physics.js     circle-vs-collider movement with sliding
  input.js       keyboard, mouse and touch joystick
  audio.js       Web Audio ambience and footsteps
  materials.js   cel materials, planet curvature and see-through cutout shader patches, sign textures
  post.js        ink outline post-processing
  sky.js         painted sky dome
  models.js      optional GLB models with procedural fallbacks
```

`character.js` only exposes `root`, `animate()` and `height`, so the procedural
character can later be replaced by a glTF model without touching the rest of the game.
