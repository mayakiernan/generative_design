import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {comparePlugin} from './scripts/compare-plugin';
import {kitRecipePlugin} from './scripts/kit-recipe-plugin';
// Five pages: Slot Studio (studio/index.html and studio/forms/index.html), the generator (index.html), the model comparison (compare/index.html), the variable-angle hub prototype (hubs/index.html) and slot constructions (slots/index.html).
// comparePlugin and kitRecipePlugin add POST /api/compare and /api/kit-recipe to the dev server only; on Vercel they are api/*.ts functions.
export default defineConfig({plugins:[react(),comparePlugin(),kitRecipePlugin()],base:'./',build:{rollupOptions:{input:{main:'index.html',compare:'compare/index.html',hubs:'hubs/index.html',slots:'slots/index.html',studio:'studio/index.html',studioForms:'studio/forms/index.html',studioAtlas:'studio/atlas/index.html',studioBlog:'studio/blog/index.html'}}}});
