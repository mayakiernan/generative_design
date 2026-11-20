// POST /api/kit-agent: Claude Opus 5.5 designs slot constructions piece by piece, checking each with the engine.
// Shared by the Vite dev server (scripts/kit-recipe-plugin.ts) and the Vercel Function (api/kit-agent.ts).
//
// Unlike /api/kit-recipe, where Claude only picks settings and the engine grows designs at random, here Claude
// places every piece: it calls build_design with an exact spec (src/slots/agent.ts), reads the engine's report
// (collisions, blocked slides, standing, parts held, cover; where every piece ended up and which way its free
// slits open), fixes what failed, and presents a few variations that pass. Symmetry and repetition are therefore
// whatever Claude builds, not luck. The response streams newline-delimited JSON events so the page can show
// progress. The API key stays in Node.
import Anthropic from '@anthropic-ai/sdk';
import {z} from 'zod';
import {buildDesign, DESIGN_PIECES, MAX_DESIGN_PIECES, UP_CHOICES, type DesignSpec} from '../src/slots/agent.js';
import {checkRequest, type RecipeEnv} from './kit-recipe.js';
import {describeError} from './runner.js';

export const AGENT_MODEL = 'claude-opus-5-5';
/** Stop asking Claude for more turns past this, and stay under the function's 300 s limit. */
const MAX_TURNS = 30, DEADLINE_MS = 270_000;

const Site = z.tuple([z.number().int(), z.number().int()]);
const DesignInput = z.object({
  title: z.string().min(1).max(60),
  pieceSizeMm: z.number().min(40).max(600),
  sheetMm: z.number().min(1).max(20),
  tree: z.object({
    pieces: z.array(z.enum(DESIGN_PIECES)).min(2).max(MAX_DESIGN_PIECES),
    joints: z.array(z.object({
      piece: z.number().int(), onto: z.number().int(),
      slit: z.string().length(1), ontoSlit: z.string().length(1),
      side: z.enum(['left', 'right']),
    })),
    up: z.enum(UP_CHOICES).optional(),
  }).nullable().optional(),
  grid: z.object({
    columns: z.array(Site).min(3),
    layers: z.number().int().min(2).max(8),
    bridges: z.array(z.object({layer: z.number().int(), from: Site, to: Site})),
  }).nullable().optional(),
  cover: z.object({shape: z.enum(['round', 'fitted']), minMm: z.number().min(0).max(1500)}).nullable().optional(),
});
const PresentInput = z.object({
  designs: z.array(z.object({id: z.string(), note: z.string().max(300)})).min(1).max(5),
  summary: z.string().max(600),
});

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: 'build_design',
    description: 'Build one design exactly as specified and check it with the engine. Returns an id and a report: problems that stop it building (unknown slit, slit already used, two pieces running into each other, a piece whose slide into place is blocked), or the full checks (interference, assembly order, standing, parts held, and for a cover: level, braced joints, usable surface), its size, and where every piece ended up with which way each free slit opens. Give a tree or a grid, not both.',
    eager_input_streaming: true,
    input_schema: z.toJSONSchema(DesignInput, {target: 'draft-7'}) as Anthropic.Beta.BetaTool.InputSchema,
  },
  {
    name: 'present_designs',
    description: 'Finish: show the user 2 to 5 designs that passed every check (by the ids build_design returned), each with a one-sentence note on how it answers the brief, plus a short summary. Call this once, last.',
    eager_input_streaming: true,
    input_schema: z.toJSONSchema(PresentInput, {target: 'draft-7'}) as Anthropic.Beta.BetaTool.InputSchema,
  },
];

const SYSTEM = `You design objects that slot together from flat discs, and you build every design yourself, piece by piece, with the build_design tool. A geometry engine checks each design exactly; nothing is placed at random. Work from the user's brief: if it asks for symmetry, repetition, a shape or a size, build exactly that.

The kit. Every piece is a disc of the same diameter (pieceSizeMm) cut from one sheet (sheetMm), differing only in its slits. Each slit runs from the rim halfway to the centre, snug, so two discs pushed slit into slit cross at exactly 90°. Pieces and their slits, as clock positions on the disc lying face up:
- C1: one slit, a at 12 o'clock.
- C2L: two slits at 90°: a at 12, b at 3.
- C2I: two opposite slits: a at 9, b at 3.
- C3T: three slits: a at 12, b at 9, c at 3.
- H: a half disc, flat edge along the top, with two notches along that edge: a entering from the left end, b from the right. Two half discs never join notch to notch.
- H1: a half disc, flat edge along the top, with one slit a entering at the middle of the curved edge (6 o'clock) and running straight up toward the flat edge. A piece joined to it lands 1.04 R out through that mouth, with the half disc's flat edge facing away from it, so H1 can make a flat foot or a flat top edge.

Trees. A tree lists pieces in build order (numbered from 1) and, for every piece after the first, one joint: {piece, onto, slit, ontoSlit, side}, meaning piece slides its slit onto slit ontoSlit of the earlier piece onto. As built, piece 1 lies flat at the origin with 12 o'clock toward +y and 3 o'clock toward +x. Geometry of a joint, with R the disc radius: the new piece's centre lands 1.04 R from the other piece's centre, straight out through the mouth of ontoSlit; the two discs are perpendicular and both contain that line. side ("left" or "right") turns the new piece half a turn about that line, which swaps the way its other slits point (for example up or down). Each slit takes one joint. The report gives every piece's centre and which way each free slit opens, so build a little, read it, and extend. Choose which as-built axis points up once it stands with tree.up: "+y" stands piece 1 on edge with its 12 o'clock slit facing up, "+z" leaves piece 1 lying flat (then the pieces crossing it reach below it too, so it rarely touches the floor), and "steadiest" lets the engine pick the face the design tips last on. A tree of slit joints is a mechanism: every joint is a hinge about its slit line, so a tree holds itself up but cannot carry a load on top.

Grids. For anything that must carry weight or have a top, build a stacked grid: columns of discs on integer lattice sites [x, y] (neighbouring columns are 2.08 R apart), in 2 to 8 layers 1.04 R apart. In odd layers (1, 3, ...) the column discs stand in the x direction's vertical plane and bridges join columns one step apart along x; in even layers they turn 90° and bridges join columns one step apart along y. Each layer is lowered onto the one below, crossing on vertical slits, which closes loops of joints and braces the grid. A bridge is a flat disc between two neighbouring columns in one layer: {layer, from: [x, y], to: [x, y]}. A column disc has at most three slits: one down (if a layer is below), one up (if a layer is above), and one per bridge in its layer. Every column must be tied to the others by some bridge, and the columns must not all stand in one line. A grid needs discs at least 25 sheet thicknesses across. Its height is about 1.04 R × (layers − 1) + 2 R.
Cover: only on a grid. {shape: "round"} is a disc sized up until it rests well inside its edge; {shape: "fitted"} is cut round the grid's top with rounded corners (a square layout gives a square top); minMm sets the least size across.

Every design you present must pass every check, including standing on its own. There is no fixed piece count: use as many pieces as the design needs, up to ${MAX_DESIGN_PIECES}. Pick pieceSizeMm and sheetMm from the brief (cardboard 3 to 4 mm, plywood 3, 6, 9 or 12 mm; for a grid keep the disc at least 25 sheets across).

Work plan: think about the form, build a first version, fix what the report flags, then build two or three variations that answer the brief in different ways (a different count, arrangement, proportion or symmetry), and finish with present_designs, listing the ones that pass. Before each build, say in one short sentence what you are trying. Keep going until you have at least two passing designs, unless the brief asks for something these discs cannot do; then say why in the summary and present what comes closest.`;

const encoder = new TextEncoder();

/** Run the agent and stream its progress as newline-delimited JSON. */
export function runAgent(prompt: string, apiKey: string, log?: (line: string) => void): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const client = new Anthropic({apiKey, maxRetries: 2, timeout: 240_000});
      const built = new Map<string, {spec: DesignSpec; ok: boolean}>();
      const messages: Anthropic.Beta.BetaMessageParam[] = [{role: 'user', content: prompt}];
      const t0 = Date.now();
      let turns = 0, jsonRetries = 0, model = AGENT_MODEL, finished = false;
      const present = (ids: {id: string; note: string}[], summary: string) => {
        send({type: 'designs', summary, designs: ids.map(({id, note}) => ({id, note, spec: built.get(id)!.spec}))});
        finished = true;
      };
      try {
        while (!finished && turns < MAX_TURNS && Date.now() - t0 < DEADLINE_MS) {
          turns++;
          const stream = client.beta.messages.stream({
            model: AGENT_MODEL,
            max_tokens: 64000,
            // If Opus 5.5 declines, the API re-runs the turn on a fallback model it picks for the refusal category.
            betas: ['server-side-fallback-2026-07-01', 'thinking-display-updates-2026-08-18'],
            fallbacks: 'default',
            // Progress notes between tool calls come back as short thinking blocks; reasoning stays hidden.
            thinking: {type: 'adaptive', display: 'updates'},
            output_config: {effort: 'high'},
            cache_control: {type: 'ephemeral'},
            system: SYSTEM,
            tools,
            messages,
          });
          let message: Anthropic.Beta.BetaMessage;
          try {
            message = await stream.finalMessage();
            jsonRetries = 0;
          } catch (err) {
            // Eager input streaming: a tool input that never parsed. Re-issue the turn; API errors go up.
            if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
            continue;
          }
          model = message.model;
          for (const block of message.content) {
            if (block.type === 'thinking' && block.thinking.trim()) send({type: 'note', text: block.thinking.trim()});
            if (block.type === 'text' && block.text.trim()) send({type: 'note', text: block.text.trim()});
          }
          if (message.stop_reason === 'refusal') throw new Error(`Claude declined this brief${message.stop_details?.explanation ? `: ${message.stop_details.explanation}` : '.'}`);
          if (message.stop_reason === 'pause_turn') { messages.push({role: 'assistant', content: message.content}); continue; }
          const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
          if (!uses.length) break;
          if (message.stop_reason === 'max_tokens') throw new Error('Claude ran out of room mid-design. Try a simpler brief.');
          messages.push({role: 'assistant', content: message.content});
          const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
          for (const use of uses) {
            const reply = (content: string, isError = false) => results.push({type: 'tool_result', tool_use_id: use.id, content, ...(isError ? {is_error: true} : {})});
            if (use.name === 'build_design') {
              const parsed = DesignInput.safeParse(use.input);
              if (!parsed.success) { reply(`The spec does not match the schema: ${parsed.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`, true); continue; }
              const spec = parsed.data as DesignSpec, id = `d${built.size + 1}`;
              const {report} = buildDesign(spec);
              built.set(id, {spec, ok: report.ok});
              send({type: 'build', id, title: spec.title, ok: report.ok, pieces: report.pieces, summary: report.ok ? 'passes every check' : report.problems[0] ?? report.checks.filter(c => c.level === 'error').map(c => `${c.label}: ${c.detail}`)[0] ?? (report.stands ? 'fails a check' : 'does not stand')});
              log?.(`build ${id} "${spec.title}": ${report.ok ? 'ok' : 'fails'}`);
              reply(`id ${id}\n${report.text}`);
            } else if (use.name === 'present_designs') {
              const parsed = PresentInput.safeParse(use.input);
              if (!parsed.success) { reply(`The input does not match the schema: ${parsed.error.issues.map(i => i.message).join('; ')}`, true); continue; }
              const bad = parsed.data.designs.filter(d => !built.get(d.id)?.ok);
              if (bad.length) { reply(`These did not pass every check (or are unknown ids): ${bad.map(d => d.id).join(', ')}. Present only designs whose report says "Passes every check".`, true); continue; }
              present(parsed.data.designs, parsed.data.summary);
              reply('Shown to the user.');
            } else reply(`Unknown tool ${use.name}.`, true);
          }
          if (finished) break;
          messages.push({role: 'user', content: results});
        }
        if (!finished) {
          // Out of turns or time: show what passed rather than nothing.
          const passing = [...built.entries()].filter(([, b]) => b.ok).slice(-4);
          if (passing.length) present(passing.map(([id]) => ({id, note: ''})), 'Claude ran out of time before choosing; these are the last designs that passed every check.');
          else throw new Error('Claude did not reach a design that passes every check in time. Try a simpler brief.');
        }
        send({type: 'done', model, turns, seconds: Math.round((Date.now() - t0) / 1000)});
        log?.(`agent done in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${turns} turns, ${built.size} builds, ${model}`);
      } catch (error) {
        send({type: 'error', message: describeError(error)});
      } finally {
        controller.close();
      }
    },
  });
}

export async function handleKitAgent(request: Request, env: RecipeEnv): Promise<Response> {
  const checked = await checkRequest(request, env);
  if (checked instanceof Response) return checked;
  return new Response(runAgent(checked.prompt, checked.apiKey, env.log), {status: 200, headers: {'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'}});
}
