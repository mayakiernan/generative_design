// Bundles Slot Studio's /api/slotwright function into one file the slot-studio Vercel project can run as is.
import {build} from 'esbuild';

await build({
  entryPoints: ['scripts/slotwright/api-entry.ts'],
  outfile: 'deploy/slot-studio/api/slotwright.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  loader: {'.md': 'text'},
  // Some dependencies still call require(); give the ES module one.
  banner: {js: "import {createRequire as __createRequire} from 'node:module'; const require = __createRequire(import.meta.url);"},
  logLevel: 'info',
});
