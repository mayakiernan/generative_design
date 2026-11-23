// Vercel Function for Slot Studio: POST /api/slotwright, one turn of the agent mode. bundle-api.mjs bundles this,
// with the SDK, zod and INSTRUCTIONS.md inlined, into deploy/slot-studio/api/slotwright.mjs (that project installs
// nothing). The site's middleware already asks for the password; the handler checks it again.
import instructions from '../../src/slotwright/INSTRUCTIONS.md';
import {handleSlotwrightTurn} from './turn.js';

export async function POST(request: Request): Promise<Response> {
  return handleSlotwrightTurn(request, {apiKey: process.env.ANTHROPIC_API_KEY, password: process.env.SITE_PASSWORD, deployed: true, instructions, log: line => console.log(line)});
}
