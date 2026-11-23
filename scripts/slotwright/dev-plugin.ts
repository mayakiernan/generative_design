// Vite dev server only: serves POST /api/slotwright with the handler the Slot Studio function uses, so agent mode
// runs locally. The API key comes from the shell or .env.local and stays in Node.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {loadEnv, type Plugin} from 'vite';
import {REPO} from './record.js';
import {handleSlotwrightTurn} from './turn.js';

type Server = Parameters<NonNullable<Extract<Plugin['configureServer'], Function>>>[0];

export function slotwrightPlugin(): Plugin {
  // `vite` and `vite preview` both serve it, so the built site can be tried end to end locally too.
  return {name: 'slotwright-api', configureServer: s => mount(s), configurePreviewServer: s => mount(s as unknown as Server)};
}

function mount(server: Server) {
    server.middlewares.use('/api/slotwright', async (req, res) => {
      const env = {...loadEnv(server.config.mode, server.config.root, ['ANTHROPIC_', 'SITE_']), ...process.env};
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      // When the page drops the request (Stop, or a reload), stop the Claude call too.
      const gone = new AbortController();
      res.on('close', () => { if (!res.writableFinished) gone.abort(); });
      const request = new Request(`http://${req.headers.host}/api/slotwright`, {method: req.method, headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined, signal: gone.signal});
      const instructions = readFileSync(join(REPO, 'src/slotwright/INSTRUCTIONS.md'), 'utf8');
      const response = await handleSlotwrightTurn(request, {apiKey: env.ANTHROPIC_API_KEY, password: env.SITE_PASSWORD || undefined, deployed: false, instructions, log: line => server.config.logger.info(`[slotwright] ${line}`)});
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      if (!response.body) { res.end(); return; }
      const reader = response.body.getReader();
      for (let r = await reader.read(); !r.done; r = await reader.read()) res.write(r.value);
      res.end();
    });
}
