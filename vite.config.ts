import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
// Two pages: the generator (index.html) and the model comparison (compare/index.html).
export default defineConfig({plugins:[react()],base:'./',build:{rollupOptions:{input:{main:'index.html',compare:'compare/index.html'}}}});
