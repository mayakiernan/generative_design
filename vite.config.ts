import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {comparePlugin} from './scripts/compare-plugin';
// Two pages: the generator (index.html) and the model comparison (compare/index.html).
// comparePlugin adds POST /api/compare to the dev server only; static builds have no endpoint.
export default defineConfig({plugins:[react(),comparePlugin()],base:'./',build:{rollupOptions:{input:{main:'index.html',compare:'compare/index.html'}}}});
