/**
 * Slot Studio's agent mode: the page runs the Slotwright loop. Each turn it posts the conversation so far to
 * /api/slotwright, which adds the fixed system prompt, tools and first message and streams back one assistant turn;
 * the page then runs the tools the agent called (its build runs in a Web Worker, its checks and renders too) and
 * posts again. The conversation is kept exactly as it came back, so thinking replays and the prompt cache holds.
 */
import type {BuildStep} from '../slots/atlas/assembly';
import type {Design} from '../slots/engine';
import type {GalleryItem} from '../slots/gallery';
import type {Panel} from '../slots/panel';
import {STUDIO, studioMaterial, template, WEB_SDK} from '../slotwright/template';
import {runTool, type ToolHost} from '../slotwright/tools';
import type {ValidationReport} from '../slotwright/validate';
import type {WorkerReply, WorkerRequest} from '../slotwright/worker';

/** $ per million tokens, claude-opus-5-5: input, output, cache write, cache read. */
const PRICE = {input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2};
/** A build that runs longer than this is stopped (an endless loop, most likely). */
const BUILD_TIMEOUT_MS = 60_000;

export type AgentEvent =
  | {type: 'note'; text: string}
  | {type: 'tool'; name: string}
  | {type: 'validate'; report: ValidationReport}
  | {type: 'render'; png: string; panels: Panel[]}
  | {type: 'turn'; turn: number; costUsd: number}
  | {type: 'done'; key: string; steps: BuildStep[]; title: string; summary: string; png: string | null; panels: Panel[] | null; item: GalleryItem; cut: Design; source: string}
  | {type: 'stopped'; reason: string};

type Content = Record<string, unknown> & {type: string};
type Message = {role: 'assistant' | 'user'; content: Content[]};

/** The worker that runs builds, restarted if a request overruns. */
class Builds {
  private w: Worker | null = null;
  private next = 1;
  private waiting = new Map<number, (r: WorkerReply) => void>();
  private start() {
    this.w = new Worker(new URL('../slotwright/worker.ts', import.meta.url), {type: 'module'});
    this.w.onmessage = ({data}: MessageEvent<WorkerReply>) => { this.waiting.get(data.id)?.(data); this.waiting.delete(data.id); };
  }
  request<C extends WorkerRequest['cmd']>(req: Omit<Extract<WorkerRequest, {cmd: C}>, 'id'>, timeoutMs = BUILD_TIMEOUT_MS): Promise<Extract<WorkerReply, {cmd: C}>> {
    if (!this.w) this.start();
    const id = this.next++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); this.stop(); reject(new Error(`the ${req.cmd === 'finish' ? 'finished design' : 'build'} took more than ${timeoutMs / 1000} s and was stopped${req.cmd === 'finish' ? '' : ' (an endless loop?)'}`)); }, timeoutMs);
      this.waiting.set(id, r => { clearTimeout(timer); resolve(r as Extract<WorkerReply, {cmd: C}>); });
      this.w!.postMessage({...req, id});
    });
  }
  stop() { this.w?.terminate(); this.w = null; }
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Post the conversation and read one streamed turn back. */
async function turn(body: object, signal: AbortSignal, onNote: (text: string) => void): Promise<{content: Content[]; stop_reason: string; stop_details?: {explanation?: string} | null; usage: Record<string, number>}> {
  const res = await fetch('/api/slotwright', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal});
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    let msg = text;
    try { msg = JSON.parse(text).error ?? text; } catch { /* not JSON */ }
    throw new Error(msg || `the server answered ${res.status}`);
  }
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buf = '', message: Awaited<ReturnType<typeof turn>> | null = null;
  for (let r = await reader.read(); !r.done; r = await reader.read()) {
    buf += decoder.decode(r.value, {stream: true});
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.type === 'note') onNote(ev.text);
      if (ev.type === 'message') message = ev;
      if (ev.type === 'error') throw new Error(ev.message);
    }
  }
  if (!message) throw new Error('the turn ended without a reply');
  return message;
}

export async function runStudioAgent(o: {prompt: string; discMm: number; circles: number; signal: AbortSignal; onEvent: (e: AgentEvent) => void}): Promise<void> {
  const {prompt, discMm, circles, signal, onEvent} = o;
  const material = studioMaterial(discMm, circles), builds = new Builds();
  let source = template(prompt, WEB_SDK, material), validated: {sha: string; ok: boolean} | null = null, lastPng: string | null = null, lastPanels: Panel[] | null = null;
  let done: Extract<AgentEvent, {type: 'done'}> | null = null, cost = 0, nudges = 0;
  const messages: Message[] = [];

  const host: ToolHost = {
    read: () => source,
    write: s => { source = s; },
    validate: async () => {
      const r = await builds.request<'validate'>({cmd: 'validate', source, material}).catch(e => ({report: {ok: false, sourceSha: '', buildError: String(e instanceof Error ? e.message : e), problems: [], checks: []}}));
      validated = {sha: r.report.sourceSha, ok: r.report.ok};
      onEvent({type: 'validate', report: r.report});
      return r.report;
    },
    render: async opts => {
      const r = await builds.request<'render'>({cmd: 'render', source, opts}).catch(e => ({ok: false, error: String(e instanceof Error ? e.message : e), png: undefined, views: undefined}));
      if (r.ok && r.png) { lastPng = r.png; lastPanels = r.panels ?? null; onEvent({type: 'render', png: r.png, panels: r.panels ?? []}); }
      return r;
    },
    finalize: async summary => {
      if (!validated || validated.sha !== (await sha256(source))) return {ok: false, error: 'build.mjs has changed since it last validated; validate it (and get ok) before finalizing'};
      if (!validated.ok) return {ok: false, error: 'the current build.mjs failed validation; fix it and validate until ok before finalizing'};
      // Kept for debugging a run that goes wrong (the design that was being finished).
      (globalThis as {__slotwrightSource?: string}).__slotwrightSource = source;
      const r = await builds.request<'finish'>({cmd: 'finish', source, material}, 2 * BUILD_TIMEOUT_MS).catch(e => ({ok: false, error: e instanceof Error ? e.message : String(e)} as Extract<WorkerReply, {cmd: 'finish'}>));
      if (!r.ok || !r.key || !r.steps || !r.item || !r.cut) return {ok: false, error: r.error ?? 'could not finish'};
      console.info(`[slotwright] finished "${r.title}": design sheet in ${r.ms?.[0]} ms, cut files in ${r.ms?.[1]} ms`);
      done = {type: 'done', key: r.key, steps: r.steps, title: r.title ?? 'Design', summary, png: lastPng, panels: lastPanels, item: r.item, cut: r.cut, source};
      return {ok: true, text: 'The design is shown to the user with its 3D build, cut sheet and assembly guide.'};
    },
  };

  try {
    for (let n = 1; n <= STUDIO.maxTurns; n++) {
      if (signal.aborted) { onEvent({type: 'stopped', reason: 'Stopped.'}); return; }
      const m = await turn({prompt, discMm, circles, messages}, signal, text => onEvent({type: 'note', text}));
      const u = m.usage ?? {};
      cost += ((u.input_tokens ?? 0) * PRICE.input + (u.output_tokens ?? 0) * PRICE.output + (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite + (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead) / 1e6;
      onEvent({type: 'turn', turn: n, costUsd: cost});
      if (m.stop_reason === 'refusal') { onEvent({type: 'stopped', reason: `The model declined this request${m.stop_details?.explanation ? `: ${m.stop_details.explanation}` : '.'}`}); return; }
      messages.push({role: 'assistant', content: m.content});
      const uses = m.content.filter(b => b.type === 'tool_use') as (Content & {id: string; name: string; input: unknown})[];
      if (!uses.length) {
        if (m.stop_reason === 'max_tokens') { messages.push({role: 'user', content: [{type: 'text', text: 'Your last turn was cut off at the output limit before a tool call. Continue with a tool call; keep each step smaller.'}]}); continue; }
        // Claude sometimes ends with a summary instead of calling finalize. If the current build last validated ok,
        // finish it with that summary; otherwise ask it, twice at most, to keep going.
        const said = m.content.filter(b => b.type === 'text').map(b => String(b.text)).join('\n').trim();
        // (validated is set inside the host's callbacks, which TypeScript's narrowing does not see.)
        const last = validated as {sha: string; ok: boolean} | null;
        if (last?.ok && last.sha === (await sha256(source))) {
          const r = await host.finalize(said.split('\n')[0].slice(0, 400) || 'Passes every check.');
          if (r.ok && done) { onEvent(done); return; }
          onEvent({type: 'stopped', reason: `The design passed its checks but could not be finished: ${r.error}`});
          return;
        }
        if (nudges++ < 2) { messages.push({role: 'user', content: [{type: 'text', text: 'You stopped without finishing. Keep working with the tools until validate returns ok for the current build.mjs, then call finalize.'}]}); continue; }
        onEvent({type: 'stopped', reason: 'The model stopped without finishing a design.'});
        return;
      }
      const results: Content[] = [];
      for (const use of uses) {
        if (done) { results.push({type: 'tool_result', tool_use_id: use.id, content: 'skipped: already finalized'}); continue; }
        if (signal.aborted) { onEvent({type: 'stopped', reason: 'Stopped.'}); return; }
        if (m.stop_reason === 'max_tokens' && use === uses[uses.length - 1]) { results.push({type: 'tool_result', tool_use_id: use.id, content: 'This call was cut off at the output limit, so its input may be incomplete; it was not run. Make it again, smaller.', is_error: true}); continue; }
        onEvent({type: 'tool', name: use.name});
        const r = await runTool(use.name, use.input, host);
        results.push({type: 'tool_result', tool_use_id: use.id, content: r.content, ...(r.isError ? {is_error: true} : {})});
      }
      messages.push({role: 'user', content: results});
      if (done) { onEvent(done); return; }
    }
    onEvent({type: 'stopped', reason: `The model used all ${STUDIO.maxTurns} turns without finishing.`});
  } catch (e) {
    onEvent({type: 'stopped', reason: signal.aborted ? 'Stopped.' : e instanceof Error ? e.message : String(e)});
  } finally {
    builds.stop();
  }
}
