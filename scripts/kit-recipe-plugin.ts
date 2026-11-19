// Vite dev server only: serves POST /api/kit-recipe and /api/kit-agent with the same handlers the Vercel Functions
// use. The agent streams its progress, so response bodies are piped through as they arrive rather than buffered.
// The API key comes from the shell or .env.local and stays in Node.
import {loadEnv, type Plugin} from 'vite';
import {handleKitRecipe, type RecipeEnv} from './kit-recipe.js';
import {handleKitAgent} from './kit-agent.js';

const ROUTES: Record<string, (request: Request, env: RecipeEnv) => Promise<Response>> = {'/api/kit-recipe': handleKitRecipe, '/api/kit-agent': handleKitAgent};

export function kitRecipePlugin(): Plugin {
  return {name: 'kit-recipe-api', apply: 'serve', configureServer(server) {
    for (const [route, handle] of Object.entries(ROUTES)) server.middlewares.use(route, async (req, res) => {
      const env = {...loadEnv(server.config.mode, server.config.root, ['ANTHROPIC_', 'SITE_']), ...process.env};
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const request = new Request(`http://${req.headers.host}${route}`, {method: req.method, headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined});
      const response = await handle(request, {apiKey: env.ANTHROPIC_API_KEY, password: env.SITE_PASSWORD || undefined, deployed: false, log: line => server.config.logger.info(`[${route.slice(5)}] ${line}`)});
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      if (!response.body) { res.end(); return; }
      const reader = response.body.getReader();
      for (let r = await reader.read(); !r.done; r = await reader.read()) res.write(r.value);
      res.end();
    });
  }};
}
