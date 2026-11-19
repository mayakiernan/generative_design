// Vercel Function: POST /api/kit-recipe. All logic lives in scripts/kit-recipe.ts.
import {handleKitRecipe} from '../scripts/kit-recipe.js';

export async function POST(request: Request): Promise<Response> {
  return handleKitRecipe(request, {apiKey: process.env.ANTHROPIC_API_KEY, password: process.env.SITE_PASSWORD, deployed: true});
}
