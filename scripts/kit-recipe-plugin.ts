// Vite dev server only: serves POST /api/kit-recipe with the same handler the Vercel Function uses.
// The API key comes from the shell or .env.local and stays in Node.
import {loadEnv, type Plugin} from 'vite';
import {handleKitRecipe} from './kit-recipe.js';

export function kitRecipePlugin(): Plugin {
  return {name: 'kit-recipe-api', apply: 'serve', configureServer(server) {
    server.middlewares.use('/api/kit-recipe', async (req, res) => {
      const env = {...loadEnv(server.config.mode, server.config.root, ['ANTHROPIC_', 'SITE_']), ...process.env};
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const request = new Request(`http://${req.headers.host}/api/kit-recipe`, {method: req.method, headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined});
      const response = await handleKitRecipe(request, {apiKey: env.ANTHROPIC_API_KEY, password: env.SITE_PASSWORD || undefined, deployed: false, log: line => server.config.logger.info(`[kit-recipe] ${line}`)});
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(await response.text());
    });
  }};
}
