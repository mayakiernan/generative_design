// The Slotwright agent loop: Claude writes build.mjs with the Slotlayer SDK, validates it, looks at renders, and
// finalizes, as BrickWright's builder pass does with build.py. A manual tool loop on client.beta.messages.stream
// (the call shape of scripts/kit-agent.ts), with renders returned as images inside tool results. The history is
// append-only, as preserved thinking requires: old renders stay in it rather than being edited out.
import Anthropic from '@anthropic-ai/sdk';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {firstMessage} from '../../src/slotwright/template.js';
import {runTool, type ToolHost} from '../../src/slotwright/tools.js';
import {REPO, type SlotRecord} from './record.js';
import {finalizeRecord, renderRecord, validateRecord} from './run.js';
import {MODEL, PRICE, streamTurn, systemPrompt} from './turn.js';

export {MODEL} from './turn.js';

export interface AgentOptions {model?: string; effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'; maxTurns?: number; maxCostUsd?: number; maxMinutes?: number; log?: (line: string) => void}
export interface AgentReport {finalized: boolean; stopReason: string; turns: number; costUsd: number; validations: number; renders: number; summary: string | null; files: string[]; seconds: number}

export const instructions = () => readFileSync(join(REPO, 'src/slotwright/INSTRUCTIONS.md'), 'utf8');

/** Run the agent on a record until it finalizes, stops, or runs out of turns, money or time. */
export async function runAgent(rec: SlotRecord, o: AgentOptions = {}): Promise<AgentReport> {
  const log = o.log ?? ((s: string) => console.log(s));
  const model = o.model ?? MODEL, maxTurns = o.maxTurns ?? 80, maxCost = o.maxCostUsd ?? 8, deadline = Date.now() + (o.maxMinutes ?? 45) * 60_000;
  const client = new Anthropic({maxRetries: 3, timeout: 600_000});
  const system = systemPrompt(instructions()), prompt = rec.meta().prompt;
  const messages: Anthropic.Beta.BetaMessageParam[] = [{role: 'user', content: firstMessage(prompt, rec.readBuild())}];
  rec.appendTranscript({role: 'system', content: system});
  rec.appendTranscript(messages[0]);
  const usage = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0};
  const cost = () => (usage.input * PRICE.input + usage.output * PRICE.output + usage.cacheWrite * PRICE.cacheWrite + usage.cacheRead * PRICE.cacheRead) / 1e6;
  const t0 = Date.now();
  let turns = 0, validations = 0, renders = 0, jsonRetries = 0, finalized = false, summary: string | null = null, files: string[] = [], stopReason = 'model stopped';

  // The record as the shared tools see it: build.mjs on disk, checks and renders in a child process.
  const host: ToolHost = {
    read: () => rec.readBuild(),
    write: src => rec.writeBuild(src),
    validate: async () => {
      validations++;
      const r = await validateRecord(rec);
      log(`  validate: ${r.ok ? 'ok' : r.buildError ? 'build error' : `fails ${[...r.problems.length ? ['kit pieces'] : [], ...r.checks.filter(c => !c.passed).map(c => c.name)].join(', ')}`}`);
      return r;
    },
    render: async a => {
      const r = await renderRecord(rec, a);
      if (!r.ok || !r.path) return {ok: false, error: r.error};
      renders++;
      log(`  render → ${r.path.replace(`${REPO}/`, '')}`);
      return {ok: true, png: readFileSync(r.path).toString('base64'), views: r.views};
    },
    finalize: async text => {
      const r = await finalizeRecord(rec);
      if (!r.ok) return {ok: false, error: r.error};
      finalized = true; summary = text; files = r.files ?? [];
      return {ok: true, text: `Wrote ${files.map(f => f.replace(`${rec.dir}/`, '')).join(', ')}.`};
    },
  };
  const run = async (use: Anthropic.Beta.BetaToolUseBlock): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
    const r = await runTool(use.name, use.input, host);
    return {type: 'tool_result', tool_use_id: use.id, content: r.content, ...(r.isError ? {is_error: true} : {})};
  };

  while (!finalized) {
    if (turns >= maxTurns) { stopReason = `turn limit (${maxTurns})`; break; }
    if (cost() >= maxCost) { stopReason = `cost limit ($${maxCost})`; break; }
    if (Date.now() > deadline) { stopReason = 'time limit'; break; }
    turns++;
    const stream = streamTurn(client, {system, messages, model, effort: o.effort});
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // Eager input streaming: a tool input that never parsed. Re-issue the turn; API errors go up.
      if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
      turns--;
      continue;
    }
    const u = message.usage;
    usage.input += u.input_tokens; usage.output += u.output_tokens; usage.cacheRead += u.cache_read_input_tokens ?? 0; usage.cacheWrite += u.cache_creation_input_tokens ?? 0;
    for (const b of message.content) {
      if (b.type === 'thinking' && b.thinking.trim()) log(`· ${b.thinking.trim().replace(/\s+/g, ' ')}`);
      if (b.type === 'text' && b.text.trim()) log(`» ${b.text.trim()}`);
    }
    rec.appendTranscript({role: 'assistant', turn: turns, stop: message.stop_reason, content: message.content});
    if (message.stop_reason === 'refusal') { stopReason = `refusal${message.stop_details?.explanation ? `: ${message.stop_details.explanation}` : ''}`; break; }
    messages.push({role: 'assistant', content: message.content});
    if (message.stop_reason === 'pause_turn') continue;
    const uses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (!uses.length) {
      if (message.stop_reason === 'max_tokens') {
        const nudge: Anthropic.Beta.BetaMessageParam = {role: 'user', content: 'Your last turn was cut off at the output limit before a tool call. Continue with a tool call; keep each step smaller.'};
        messages.push(nudge); rec.appendTranscript(nudge);
        continue;
      }
      stopReason = 'model stopped without finalizing';
      break;
    }
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      if (finalized) { results.push({type: 'tool_result', tool_use_id: use.id, content: 'skipped: already finalized'}); continue; }
      log(`→ ${use.name}${use.name === 'render' && use.input && Object.keys(use.input).length ? ` ${JSON.stringify(use.input)}` : ''}`);
      results.push(message.stop_reason === 'max_tokens' && use === uses[uses.length - 1]
        ? {type: 'tool_result', tool_use_id: use.id, content: 'This call was cut off at the output limit, so its input may be incomplete; it was not run. Make it again, smaller.', is_error: true}
        : await run(use));
    }
    const turnResults: Anthropic.Beta.BetaMessageParam = {role: 'user', content: results};
    messages.push(turnResults);
    rec.appendTranscript({role: 'user', content: results.map(r => ({...r, content: Array.isArray(r.content) ? r.content.map(c => (c.type === 'image' ? {type: 'image', note: 'render omitted from transcript; see renders/'} : c)) : r.content}))});
    log(`  [turn ${turns}, $${cost().toFixed(2)}]`);
  }
  if (finalized) stopReason = 'finalized';
  const seconds = Math.round((Date.now() - t0) / 1000);
  rec.update({model, turns, costUsd: Math.round(cost() * 100) / 100, usage, stopReason, seconds});
  return {finalized, stopReason, turns, costUsd: cost(), validations, renders, summary, files, seconds};
}
