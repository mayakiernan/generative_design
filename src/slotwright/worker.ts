/**
 * Slot Studio's agent mode runs the model's build.mjs here, in a Web Worker on the user's machine: never on the
 * server, which holds the API key. The SDK import line is swapped for the SDK this worker already has, so line
 * numbers in errors stay right; the module is then loaded from a blob URL. The page kills the worker if a request
 * runs past its timeout (an endless loop in the build).
 */
import * as sdk from './sdk.js';
import {renderPieces, viewsText} from './look.js';
import {contactSheet, renderView, type Image} from './render.js';
import {checkModule, errText, type BuildModule, type Material, type ValidationReport} from './validate.js';
import type {BuildStep} from '../slots/atlas/assembly.js';
import {finishedItem, formKey} from './design.js';
import type {Design} from '../slots/engine.js';
import type {GalleryItem} from '../slots/gallery.js';
import {CUT_CLEARANCE, kitFor} from '../studio/query.js';
import type {RenderOpts} from './tools.js';
import {asModule} from './module.js';
import type {Panel} from '../slots/panel.js';

export type WorkerRequest =
  | {id: number; cmd: 'validate'; source: string; material: Material}
  | {id: number; cmd: 'render'; source: string; opts: RenderOpts}
  | {id: number; cmd: 'finish'; source: string; material: Material};
export type WorkerReply =
  | {id: number; cmd: 'validate'; report: ValidationReport}
  | {id: number; cmd: 'render'; ok: boolean; png?: string; views?: string; panels?: Panel[]; error?: string}
  | {id: number; cmd: 'finish'; ok: boolean; key?: string; steps?: BuildStep[]; title?: string; item?: GalleryItem; cut?: Design; ms?: number[]; error?: string};

(globalThis as unknown as {__slotlayer: typeof sdk}).__slotlayer = sdk;

async function load(source: string): Promise<BuildModule> {
  const url = URL.createObjectURL(new Blob([asModule(source)], {type: 'text/javascript'}));
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Captured console output while a build runs, as the command line captures stdout. */
function capture<T>(fn: () => Promise<T>): Promise<{value: T; out: string}> {
  const lines: string[] = [], log = console.log;
  console.log = (...a: unknown[]) => { if (lines.join('\n').length < 4000) lines.push(a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  return fn().then(value => ({value, out: lines.join('\n')}), e => { throw e; }).finally(() => { console.log = log; });
}

async function png(img: Image): Promise<string> {
  const rgba = new Uint8ClampedArray(img.width * img.height * 4);
  for (let i = 0, j = 0; i < img.rgb.length; i += 3, j += 4) { rgba[j] = img.rgb[i]; rgba[j + 1] = img.rgb[i + 1]; rgba[j + 2] = img.rgb[i + 2]; rgba[j + 3] = 255; }
  const canvas = new OffscreenCanvas(img.width, img.height);
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, img.width, img.height), 0, 0);
  const bytes = new Uint8Array(await (await canvas.convertToBlob({type: 'image/png'})).arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function built(source: string) {
  const mod = await load(source);
  if (typeof mod.createBuild !== 'function') throw new Error('build.mjs must export a function createBuild() that returns a SlotBuild');
  const build = await mod.createBuild();
  if (!(build instanceof sdk.SlotBuild)) throw new Error('createBuild() must return a SlotBuild');
  return {build, title: typeof mod.title === 'string' ? mod.title : 'Untitled'};
}

async function handle(req: WorkerRequest): Promise<WorkerReply> {
  if (req.cmd === 'validate') {
    const sourceSha = await sha256(req.source);
    try {
      const {value, out} = await capture(async () => (await checkModule(await load(req.source), sourceSha, req.material)).report);
      return {id: req.id, cmd: 'validate', report: out ? {...value, stdout: out} : value};
    } catch (e) {
      return {id: req.id, cmd: 'validate', report: {ok: false, sourceSha, buildError: errText(e), problems: [], checks: []}};
    }
  }
  if (req.cmd === 'render') {
    try {
      const {build} = await built(req.source), r = build.resolve();
      if (!r.pieces.length) return {id: req.id, cmd: 'render', ok: false, error: 'the build has no pieces'};
      const pieces = renderPieces(r, req.opts.look ?? 'pieces');
      const img = req.opts.azimuth !== undefined ? renderView(pieces, {azimuth: req.opts.azimuth, elevation: req.opts.elevation ?? 20}, {size: 768, pitch: r.kit.p}) : contactSheet(pieces, {pitch: r.kit.p});
      // The panels too, so the page can draw the build in the site's own look (grey, black rims) for people.
      return {id: req.id, cmd: 'render', ok: true, png: await png(img), views: viewsText(req.opts), panels: r.panels};
    } catch (e) {
      return {id: req.id, cmd: 'render', ok: false, error: errText(e)};
    }
  }
  try {
    const {build, title} = await built(req.source);
    const {report, verdict} = await checkModule({createBuild: () => build, title}, '', req.material);
    if (!report.ok || !verdict) return {id: req.id, cmd: 'finish', ok: false, error: 'the build no longer passes its checks; validate again'};
    // The finished design for the design sheet, at the checked fit and at the press fit the cut files use, made
    // here so the page never stalls on it (the engine's full evaluation can take seconds on a large build).
    const key = formKey(build.resolve().form), D = req.material.discMm, t0 = performance.now();
    const item = finishedItem(kitFor(D), key, verdict.steps, title), t1 = performance.now();
    const cut = finishedItem(kitFor(D, CUT_CLEARANCE), key, verdict.steps, title).design, t2 = performance.now();
    return {id: req.id, cmd: 'finish', ok: true, key, steps: verdict.steps, title, item, cut, ms: [Math.round(t1 - t0), Math.round(t2 - t1)]};
  } catch (e) {
    return {id: req.id, cmd: 'finish', ok: false, error: errText(e)};
  }
}

self.onmessage = async ({data}: MessageEvent<WorkerRequest>) => {
  self.postMessage(await handle(data));
};
