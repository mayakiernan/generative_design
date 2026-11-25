import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {slotwrightPlugin} from './scripts/slotwright/dev-plugin';
// Slot Studio on its own: the studio pages built into deploy/slot-studio/public, which `npm run studio:deploy`
// sends to its own Vercel project (deploy/slot-studio/vercel.json serves the page at the site's root).
// In dev, slotwrightPlugin serves POST /api/slotwright for the Atlas page's agent mode (deployed, it is a function).
export default defineConfig({plugins: [react(), slotwrightPlugin()], base: './', build: {outDir: 'deploy/slot-studio/public', emptyOutDir: true, rollupOptions: {input: {studio: 'studio/index.html', pieces: 'studio/possible-pieces/index.html', forms: 'studio/forms/index.html', atlas: 'studio/atlas/index.html', blog: 'studio/blog/index.html'}}}});
