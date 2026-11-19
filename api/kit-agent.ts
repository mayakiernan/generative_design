// Vercel Function: POST /api/kit-agent, streaming. All logic lives in scripts/kit-agent.ts.
import {handleKitAgent} from '../scripts/kit-agent.js';

export async function POST(request: Request): Promise<Response> {
  return handleKitAgent(request, {apiKey: process.env.ANTHROPIC_API_KEY, password: process.env.SITE_PASSWORD, deployed: true});
}
