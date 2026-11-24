// One Slotwright agent turn: the tools, the system prompt and the Claude request, shared by the command-line loop
// (agent.ts) and Slot Studio's POST /api/slotwright. In the studio the page drives the loop and runs every tool
// itself (build code runs in a Web Worker on the user's machine, nowhere near the API key); the server only adds
// the fixed system prompt, tools and first message, and streams back one assistant turn. No fs here: the function
// is bundled into one file (bundle-api.mjs) with INSTRUCTIONS.md inlined.
import Anthropic from '@anthropic-ai/sdk';
import {z} from 'zod';
import {passwordOk} from '../password.js';
import {EditArgs, FinalizeArgs, ReadArgs, RenderArgs, ValidateArgs, WriteArgs} from '../../src/slotwright/tools.js';
import {firstMessage, STUDIO, studioMaterial, template, WEB_SDK} from '../../src/slotwright/template.js';
import type {Material} from '../../src/slotwright/validate.js';

export {EditArgs, FinalizeArgs, ReadArgs, RenderArgs, WriteArgs};

export const MODEL = 'claude-opus-5-5';
/** $ per million tokens for claude-opus-5-5: input, output, cache write (5 min), cache read. */
export const PRICE = {input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2};

const schema = (s: z.ZodType) => z.toJSONSchema(s, {target: 'draft-7'}) as Anthropic.Beta.BetaTool.InputSchema;
export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {name: 'read_build', description: 'Show build.mjs with line numbers (optionally lines from..to).', eager_input_streaming: true, input_schema: schema(ReadArgs)},
  {name: 'write_build', description: 'Replace build.mjs with new content. Use for a first draft or a rewrite; prefer edit_build for changes.', eager_input_streaming: true, input_schema: schema(WriteArgs)},
  {name: 'edit_build', description: 'Replace old_str with new_str in build.mjs. old_str must occur exactly once unless replace_all is true. Returns the edited region.', eager_input_streaming: true, input_schema: schema(EditArgs)},
  {name: 'validate', description: 'Run build.mjs in a fresh process and check it: kit pieces, no collisions, connected, buildable, stands, no loose pieces, braced, plus your runTests checks. Returns ok, every failure with the pieces and cells involved, the size, and every piece (cell, plane, kit piece, slits, joints, floor contact).', eager_input_streaming: true, input_schema: schema(ValidateArgs)},
  {name: 'render', description: 'Render the current build and see the image. With no angle: a contact sheet of front, side, top and three-quarter views, pieces in distinct colours with their numbers. With azimuth (0 from −y, 90 from +x) and elevation (90 straight down): one larger view. look "plain" shows it as cut plywood (or painted), without numbers.', eager_input_streaming: true, input_schema: schema(RenderArgs)},
  {name: 'finalize', description: 'Finish: only after validate returns ok for the current build.mjs and the renders read clearly as the request. Writes the renders, laser cut sheet and assembly guide, and ends the run. summary: one to three sentences for the user on the design.', eager_input_streaming: true, input_schema: schema(FinalizeArgs)},
];

const TOOL_GUIDE = `
## Tools

You work on build.mjs only through tools: read_build, write_build (first draft or full rewrite), edit_build
(targeted changes), validate, render and finalize. validate and render run the file in a fresh process. A render's
image follows its tool result. Before each tool call, say in one short sentence what you are doing.

Pace yourself: think briefly, get a first draft into build.mjs early, and let validate and render answer questions
about geometry rather than working them out at length in your head. Several short turns beat one long one.

Work autonomously: do not ask the user anything. Keep going until validate returns ok for the current file and the
renders read clearly as the request, then call finalize. Never write code in a reply; change the file through tools.`;

export const systemPrompt = (instructions: string) => instructions + TOOL_GUIDE;

/** Stream one assistant turn. The history must be passed back unchanged each time (preserved thinking, caching). */
export function streamTurn(client: Anthropic, o: {system: string; messages: Anthropic.Beta.BetaMessageParam[]; model?: string; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; signal?: AbortSignal}) {
  return client.beta.messages.stream({
    model: o.model ?? MODEL,
    max_tokens: 64000,
    // If the model declines, the API re-runs the turn on a fallback model it picks for the refusal category.
    betas: ['server-side-fallback-2026-07-01', 'thinking-display-updates-2026-08-18'],
    fallbacks: 'default',
    // Progress notes between tool calls come back as short thinking blocks; reasoning itself stays hidden.
    thinking: {type: 'adaptive', display: 'updates'},
    output_config: {effort: o.effort ?? 'high'},
    cache_control: {type: 'ephemeral'},
    system: o.system,
    tools: TOOLS,
    messages: o.messages,
  }, o.signal ? {signal: o.signal} : undefined);
}

/* ---------- Slot Studio: POST /api/slotwright ---------- */

export interface TurnEnv {apiKey?: string; password?: string; deployed: boolean; instructions: string; log?: (line: string) => void}

const json = (status: number, body: object, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json', ...headers}});

/** The first message the server sends for a studio run, and the starting file the page runs. */
export const studioStart = (prompt: string, material: Material) => {
  const source = template(prompt, WEB_SDK, material);
  return {source, message: firstMessage(prompt, source, material)};
};

export async function handleSlotwrightTurn(request: Request, env: TurnEnv): Promise<Response> {
  if (request.method !== 'POST') return json(405, {error: 'Use POST.'});
  if (!passwordOk(request, env.password, env.deployed)) return json(401, {error: 'Password required.'}, {'WWW-Authenticate': 'Basic realm="Slot Studio", charset="UTF-8"'});
  // Only the page itself may spend the key: same-origin JSON requests.
  const origin = request.headers.get('origin'), host = request.headers.get('host') ?? new URL(request.url).host;
  if (!origin || new URL(origin).host !== host || !request.headers.get('content-type')?.startsWith('application/json')) return json(403, {error: 'Forbidden.'});
  const text = await request.text();
  if (text.length > STUDIO.maxBody) return json(413, {error: 'This run has grown too large to continue.'});
  let body: {prompt?: unknown; discMm?: unknown; circles?: unknown; messages?: unknown};
  try { body = JSON.parse(text); } catch { return json(400, {error: 'Could not read the request.'}); }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '', discMm = Number(body.discMm), circles = Number(body.circles);
  if (!prompt || prompt.length > 500) return json(400, {error: 'Say what to make, in under 500 characters.'});
  if (!(discMm >= STUDIO.minDisc && discMm <= STUDIO.maxDisc)) return json(400, {error: `Discs must be ${STUDIO.minDisc}–${STUDIO.maxDisc} mm across.`});
  if (!(circles >= 1)) return json(400, {error: 'Say how many circles you have.'});
  // The page's part of the conversation: assistant turns as they came back, each followed by the tool results.
  const rest = Array.isArray(body.messages) ? body.messages as Anthropic.Beta.BetaMessageParam[] : null;
  if (!rest) return json(400, {error: 'messages must be a list.'});
  const roles = rest.every((m, i) => m && typeof m === 'object' && m.role === (i % 2 ? 'user' : 'assistant') && Array.isArray(m.content));
  if (!roles || rest.length % 2) return json(400, {error: 'The conversation is out of order.'});
  if (rest.length / 2 >= STUDIO.maxTurns) return json(400, {error: `Runs stop after ${STUDIO.maxTurns} turns.`});
  if (!env.apiKey) return json(500, {error: env.deployed ? 'ANTHROPIC_API_KEY is not set for this deployment.' : 'No API key found. Put ANTHROPIC_API_KEY=... in .env.local and restart the dev server.'});

  const material = studioMaterial(discMm, circles), start = studioStart(prompt, material);
  const messages: Anthropic.Beta.BetaMessageParam[] = [{role: 'user', content: start.message}, ...rest];
  const client = new Anthropic({apiKey: env.apiKey, maxRetries: 2, timeout: 280_000});
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      const t0 = Date.now(), n = rest.length / 2 + 1;
      env.log?.(`turn ${n} started (${text.length} bytes in)`);
      // A function gets 300 s: stop a turn that runs long and say so, rather than being cut off without a word.
      const limit = new AbortController(), timer = setTimeout(() => limit.abort(), STUDIO.turnSeconds * 1000);
      request.signal.addEventListener('abort', () => limit.abort());
      try {
        // Medium effort (Opus 5.5's default) keeps each turn well inside the function's time.
        const turn = streamTurn(client, {system: systemPrompt(env.instructions), messages, signal: limit.signal, effort: 'medium'});
        turn.on('streamEvent', e => { if (e.type === 'message_start') env.log?.(`turn ${n}: first event after ${((Date.now() - t0) / 1000).toFixed(1)} s`); });
        // Progress notes as each block completes, so the page shows the agent thinking aloud.
        turn.on('contentBlock', block => {
          if (block.type === 'thinking' && block.thinking.trim()) send({type: 'note', text: block.thinking.trim()});
          if (block.type === 'text' && block.text.trim()) send({type: 'note', text: block.text.trim()});
        });
        const m = await turn.finalMessage();
        env.log?.(`turn ${n}: ${m.stop_reason}, ${m.usage.output_tokens} out, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        send({type: 'message', content: m.content, stop_reason: m.stop_reason, stop_details: m.stop_details ?? null, usage: m.usage, model: m.model});
      } catch (error) {
        env.log?.(`turn ${n} failed after ${((Date.now() - t0) / 1000).toFixed(0)} s: ${error instanceof Error ? error.message : error}`);
        if (request.signal.aborted) return;
        if (limit.signal.aborted) { send({type: 'error', message: `The model's turn ran past ${STUDIO.turnSeconds} s, the server's limit. Try again; a simpler request finishes faster.`}); return; }
        send({type: 'error', message: error instanceof Anthropic.APIError ? `Model API error ${error.status}: ${error.message}` : error instanceof Error ? error.message : String(error)});
      } finally {
        clearTimeout(timer);
        controller.close();
      }
    },
  });
  return new Response(stream, {status: 200, headers: {'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'}});
}
