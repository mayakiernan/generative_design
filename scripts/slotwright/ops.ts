// What a Slotwright record's build can be asked to do on the command line: validate, render, finalize. These run in a
// child process (worker.ts), because they run the agent's build.mjs; run.ts is the parent side. The checks, report
// and finished design are the same code Slot Studio runs in its Web Worker (src/slotwright/).
import {mkdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assemblyGuideHTML, cutSheetDXF, cutSheetSVG} from '../../src/slots/svg.js';
import {finishedItem, formKey} from '../../src/slotwright/design.js';
import {renderPieces, viewsText, type Look} from '../../src/slotwright/look.js';
import {contactSheet, renderView} from '../../src/slotwright/render.js';
import {hardChecks, SlotBuild} from '../../src/slotwright/sdk.js';
import {checkModule, errText, type BuildModule, type ValidationReport} from '../../src/slotwright/validate.js';
import {encodePNG} from './png.js';
import {sha256, type SlotRecord} from './record.js';

export {reportText, type ValidationReport} from '../../src/slotwright/validate.js';
export type {Look} from '../../src/slotwright/look.js';

/** Import exactly this source (a copy beside build.mjs, so its relative imports resolve). */
async function load(rec: SlotRecord, source: string): Promise<BuildModule> {
  const tmp = join(rec.dir, `.run-${sha256(source).slice(0, 12)}-${process.pid}.mjs`);
  writeFileSync(tmp, source);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone */ }
  }
}

async function built(rec: SlotRecord, source: string) {
  const mod = await load(rec, source);
  if (typeof mod.createBuild !== 'function') throw new Error('build.mjs must export a function createBuild() that returns a SlotBuild');
  const build = await mod.createBuild();
  if (!(build instanceof SlotBuild)) throw new Error('createBuild() must return a SlotBuild');
  return {build, title: typeof mod.title === 'string' ? mod.title : 'Untitled'};
}

export async function validate(rec: SlotRecord): Promise<ValidationReport> {
  const source = rec.readBuild(), sourceSha = sha256(source);
  let report: ValidationReport;
  try {
    report = (await checkModule(await load(rec, source), sourceSha)).report;
  } catch (e) {
    report = {ok: false, sourceSha, buildError: errText(e), problems: [], checks: []};
  }
  if (rec.sourceSha !== sourceSha) report = {ok: false, sourceSha, buildError: 'build.mjs changed while it was being validated; validate again', problems: [], checks: []};
  mkdirSync(rec.outDir, {recursive: true});
  writeFileSync(join(rec.outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  rec.snapshot(source, report);
  rec.update({status: report.ok ? 'valid' : report.buildError ? 'error' : 'invalid', validatedSha: sourceSha, validatedOk: report.ok});
  return report;
}

export interface RenderResult {ok: boolean; path?: string; error?: string; views: string}

export async function render(rec: SlotRecord, o: {azimuth?: number; elevation?: number; look?: Look; out?: string} = {}): Promise<RenderResult> {
  try {
    const {build} = await built(rec, rec.readBuild());
    const r = build.resolve();
    if (!r.pieces.length) return {ok: false, error: 'the build has no pieces', views: ''};
    const pieces = renderPieces(r, o.look ?? 'pieces');
    const img = o.azimuth !== undefined ? renderView(pieces, {azimuth: o.azimuth, elevation: o.elevation ?? 20}, {size: 768, pitch: r.kit.p}) : contactSheet(pieces, {pitch: r.kit.p});
    const path = o.out ?? rec.nextRender();
    writeFileSync(path, encodePNG(img));
    return {ok: true, path, views: viewsText(o)};
  } catch (e) {
    return {ok: false, error: errText(e), views: ''};
  }
}

export interface FinalizeResult {ok: boolean; error?: string; files?: string[]}

/** Write the finished design: renders, laser cut sheet (SVG and DXF), assembly guide and a design summary. */
export async function finalize(rec: SlotRecord): Promise<FinalizeResult> {
  const meta = rec.meta(), source = rec.readBuild();
  if (meta.validatedSha !== sha256(source) || !meta.validatedOk) return {ok: false, error: meta.validatedSha === sha256(source) ? 'the current build.mjs failed validation; fix it and validate until ok before finalizing' : 'build.mjs has changed since it last validated; validate it (and get ok) before finalizing'};
  try {
    const {build, title} = await built(rec, source);
    const r = build.resolve(), v = hardChecks(r);
    if (!v.ok) return {ok: false, error: 'the build no longer passes its checks; validate again'};
    const out = rec.outDir;
    mkdirSync(out, {recursive: true});
    const item = finishedItem(r.kit, formKey(r.form), v.steps, title), d = item.design;
    const files: [string, string | Buffer][] = [
      ['render.png', encodePNG(contactSheet(renderPieces(r, 'pieces'), {pitch: r.kit.p}))],
      ['render-plain.png', encodePNG(renderView(renderPieces(r, 'plain'), {azimuth: 35, elevation: 25}, {size: 1024, pitch: r.kit.p, labels: false}))],
      ['cut-sheet.svg', cutSheetSVG(d, item.marks)],
      ['cut-sheet.dxf', cutSheetDXF(d, item.marks)],
      ['assembly.html', assemblyGuideHTML(title, d, item.parts, item.steps, item.marks)],
      ['design.json', JSON.stringify({title, prompt: meta.prompt, discMm: build.discMm, sheetMm: build.sheetMm, clearanceMm: build.clearance, parts: item.parts, pieces: r.pieces.map(p => ({n: p.index, name: p.name, cell: p.cell, normal: p.normal, piece: p.piece, slits: p.slits, joins: p.joins, color: p.color})), checks: v.checks, engineChecks: d.checks, steps: d.steps.map(s => s.how)}, null, 2) + '\n'],
    ];
    for (const [name, data] of files) writeFileSync(join(out, name), data);
    rec.update({finalized: true});
    return {ok: true, files: files.map(([name]) => join(out, name))};
  } catch (e) {
    return {ok: false, error: errText(e)};
  }
}
