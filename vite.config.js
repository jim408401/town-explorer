import { defineConfig } from 'vite';

// Relative base so the build works under a GitHub Pages sub-path
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 700 }, // three.js alone is ~500 kB
});
