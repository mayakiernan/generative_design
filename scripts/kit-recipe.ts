// POST /api/kit-recipe: turn a plain-language brief into a kit-gallery recipe with Claude Opus 5.5.
// Shared by the Vite dev server (scripts/kit-recipe-plugin.ts) and the Vercel Function (api/kit-recipe.ts).
// Claude only chooses settings. The geometry engine in the browser grows the designs and checks every one, so
// a poor recipe yields fewer designs, never an unchecked one. The API key stays in Node.
import Anthropic from '@anthropic-ai/sdk';
import {betaZodOutputFormat} from '@anthropic-ai/sdk/helpers/beta/zod';
import {z} from 'zod';
import {BRANCHING, clampRecipe, COVER_SHAPES, FORMS, PIECE_IDS, VISIBLE_KITS, type Recipe} from '../src/slots/recipe.js';
import {passwordOk} from './password.js';
import {describeError} from './runner.js';

export const RECIPE_MODEL = 'claude-opus-5-5';

const RecipeSchema = z.object({
  kit: z.enum(VISIBLE_KITS),
  form: z.enum(FORMS),
  pieces: z.number(),
  pieceSizeMm: z.number(),
  footprintMm: z.number(),
  cover: z.boolean(),
  coverShape: z.enum(COVER_SHAPES),
  coverMm: z.number(),
  sheetMm: z.number(),
  favour: z.array(z.enum(PIECE_IDS)),
  avoid: z.array(z.enum(PIECE_IDS)),
  branching: z.enum(BRANCHING),
  title: z.string(),
  rationale: z.string(),
});

const SYSTEM = `You set up a generator that grows slot-together objects from flat sheet pieces. Read the user's brief and choose the generator's settings. The page has no other way to start: there are no form buttons, so the form you choose is what the user gets.

How the generator works. The user cuts identical kinds of pieces from sheet material. Every joint is two pieces pushed slit-into-slit so they cross at 90°; the slits are cut snug. A design grows as a tree: start with one piece, then push a new piece onto any free slit, again and again. The generator places pieces at random within your settings and keeps only designs where nothing overlaps, every piece can be slid straight into place, and no piece can slide out under gravity. Designs that stand on the floor by themselves are shown, and so are some that would need propping; the user filters them.

The kit. Only the circle kit is offered (kit "circle"): every piece is a disc of the same size, differing only in its slits. Piece ids:
- C1 disc with one slit (ends a branch); C2L disc with two slits at 90° (turns a corner); C2I disc with two opposite slits (continues straight); C3T disc with three slits (branches); H half disc with two notches along its flat edge (a flat disc slid into a notch sits flush with that edge); H1 half disc with one slit from the middle of its curved edge straight in toward the flat edge (ends a branch, like C1; its flat edge faces away from the piece it joins, so it can make a flat foot or a flat top edge).

The cover. When the brief calls for a surface, set cover true and the generator adds a cover: a flat piece with no slits resting level on top. A tree of slit joints folds under weight on top (a slit joint acts as a hinge about its slit line), so whenever there is a cover the generator builds a braced stacked grid under it, whatever the form; the form then only steers the grid (tower: more layers, spread: fewer, random: kept inside the footprint circle). In the table form the generator stacks circle discs into a grid, as you would by hand: columns of discs on a square lattice, flat discs bridging neighbouring columns, each layer turned 90° and lowered onto the one below so the columns cross on vertical slits. It then lays the cover on the column tops, sized up just enough to rest well inside its edge (usually 1.75–2.5× the piece size across), and checks it is level, how much of it is over its supports, how much load would tip the design, and that no joint can fold under weight on the cover (only closed loops of joints are rigid). A grid needs discs at least 25 times the sheet thickness across (9 mm plywood needs discs of 225 mm or more, 6 mm needs 150, 3 mm needs 75); thinner discs make each bridge disc run into the layer above. A table stands about 1.55× the piece size tall with 12–16 pieces (two layers), about 2× with 16–24 pieces (three layers) and about 2.6× with 24–30 pieces (four layers).
Use form "table" whenever the brief describes something meant to hold or present objects or otherwise needs a flat top: a table, side table, stool, plant stand, display stand, tray, nightstand, shelf. Use form "random" when the brief asks for something random, surprising or unplanned, or gives only the floor space it may take. Everything else (lamps, sculptures, towers, ornaments) uses the other forms.

Settings:
- form: table (a level cover on top, see above), tower (stands on its long axis, tall), spread (lies low and wide), compact (dense ball-like cluster), any (whatever stands best), random (no target shape: random branching, growing up from the floor inside a circle of footprintMm, any height).
- pieces: 4–30, not counting the cover. More pieces take longer and fail more often; towers above about 20 pieces rarely stand.
- pieceSizeMm: the diameter of every disc, 40–600. For a table pick it from the height wanted (see above); a 240 mm disc gives a side table about 500 mm tall with a cover about 420–600 mm across. Desk objects 60–160, a lamp or vase 120–250.
- footprintMm: for the random form, the diameter of the circle on the floor the design must fit inside, 2–8× pieceSizeMm. Use the brief's floor space if it gives one; otherwise about 4× pieceSizeMm, or 5× for more than 22 pieces (a tighter circle with many pieces yields few designs). For other forms give 4× pieceSizeMm; it is ignored.
- cover: true when the brief needs a top surface: something to put things on (a table, stool, plant stand, display, shelf, tray), a lid or a top it names. Always true for the table form. Otherwise false.
- coverShape: "round" (the kit's disc, scaled up until it rests well) unless the brief asks for a square, rectangular or long top, a top that matches the frame, or a custom shape; then "fitted" (an outline cut round the frame's top with rounded corners).
- coverMm: the least size across the top must have when the brief gives one (e.g. "a 40 cm top" gives 400, "room for a 30 cm pot" gives about 340); else 0. Up to 1500.
- sheetMm: 1–20. Cardboard 3–4, plywood 3, 6, 9 or 12, acrylic 3. Use what the brief names; otherwise pick for the scale.
- favour / avoid: piece ids to use more often or not at all. Leave both empty when the brief gives no reason.
- branching: chain (long arms; towers, snakes), bushy (fills in around the start; compact clusters), mixed. Ignored for tables and random (random draws one per design).
- title: two to five words naming the set.
- rationale: one or two plain sentences on what you chose and why. If the brief asks for something this kit cannot do (another shape of piece, exact dimensions, a large single surface, curved surfaces, moving parts), say so and say what you chose instead.

Match the brief's scale and character. Prefer settings that are likely to produce standing designs.`;

/** Ask Claude for a recipe. Refusals and unparseable answers come back as errors, not guesses. */
export async function writeRecipe(prompt: string, apiKey: string): Promise<{recipe: Recipe; model: string}> {
  const client = new Anthropic({apiKey, maxRetries: 2, timeout: 120_000});
  const message = await client.beta.messages.parse({
    model: RECIPE_MODEL,
    max_tokens: 16000,
    // If Opus 5.5 declines, the API re-runs the request on a fallback model it picks for the refusal category.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: {type: 'adaptive'},
    output_config: {effort: 'medium', format: betaZodOutputFormat(RecipeSchema)},
    system: SYSTEM,
    messages: [{role: 'user', content: prompt}],
  });
  if (message.stop_reason === 'refusal') throw new Error(`Claude declined this brief${message.stop_details?.explanation ? `: ${message.stop_details.explanation}` : '.'}`);
  if (message.stop_reason === 'max_tokens') throw new Error('Claude ran out of room before finishing the recipe. Try a shorter brief.');
  if (!message.parsed_output) throw new Error('Claude did not return a usable recipe.');
  return {recipe: clampRecipe(message.parsed_output), model: message.model};
}

const json = (status: number, body: object, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers}});

export interface RecipeEnv {apiKey?: string; password?: string; deployed: boolean; log?: (line: string) => void}

/**
 * The checks every Claude endpoint makes before spending the key: POST, the site password, a same-origin JSON
 * request, and a brief of at most 1000 characters. Returns the brief and key, or the response to send instead.
 */
export async function checkRequest(request: Request, env: RecipeEnv): Promise<{prompt: string; apiKey: string} | Response> {
  if (request.method !== 'POST') return json(405, {error: 'Use POST.'});
  if (!passwordOk(request, env.password, env.deployed)) return json(401, {error: 'Password required.'}, {'WWW-Authenticate': 'Basic realm="Possible Pieces", charset="UTF-8"'});
  // Only the page itself may spend the key: same-origin JSON requests.
  const origin = request.headers.get('origin'), host = request.headers.get('host') ?? new URL(request.url).host;
  if (!origin || new URL(origin).host !== host || !request.headers.get('content-type')?.startsWith('application/json')) return json(403, {error: 'Forbidden.'});
  let prompt = '';
  try {
    const text = await request.text();
    if (text.length > 4000) return json(413, {error: 'Keep the brief under 1000 characters.'});
    const body = JSON.parse(text) as {prompt?: unknown};
    prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  } catch { return json(400, {error: 'Could not read the request.'}); }
  if (!prompt) return json(400, {error: 'Describe what to make first.'});
  if (prompt.length > 1000) return json(400, {error: 'Keep the brief under 1000 characters.'});
  if (!env.apiKey) return json(500, {error: env.deployed ? 'ANTHROPIC_API_KEY is not set for this deployment.' : 'No API key found. Put ANTHROPIC_API_KEY=... in .env.local and restart npm run dev.'});
  return {prompt, apiKey: env.apiKey};
}

export async function handleKitRecipe(request: Request, env: RecipeEnv): Promise<Response> {
  const checked = await checkRequest(request, env);
  if (checked instanceof Response) return checked;
  const t0 = Date.now();
  try {
    const out = await writeRecipe(checked.prompt, checked.apiKey);
    env.log?.(`recipe in ${((Date.now() - t0) / 1000).toFixed(1)}s from ${out.model}`);
    return json(200, out);
  } catch (error) {
    return json(502, {error: describeError(error)});
  }
}
