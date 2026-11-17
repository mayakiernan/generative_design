// Vercel Function: POST /api/compare. All logic lives in scripts/compare-handler.ts.
import {handleCompare} from '../scripts/compare-handler.js';

export async function POST(request: Request): Promise<Response> {
  return handleCompare(request, {apiKey: process.env.ANTHROPIC_API_KEY, password: process.env.SITE_PASSWORD, deployed: true});
}
