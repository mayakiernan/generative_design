/**
 * The validation report for a built SlotBuild and the text the model reads, shared by the command line (which runs
 * build.mjs in a child process) and Slot Studio (which runs it in a Web Worker). No Node or DOM APIs here.
 */
import {hardChecks, Model, SlotBuild, Tests, type CheckResult, type Verdict} from './sdk.js';

export interface PieceLine {n: number; name: string; cell: number[]; faces: string; piece: string | null; slits: string[]; joins: number[]; floor: boolean}

export interface ValidationReport {
  ok: boolean;
  sourceSha: string;
  /** The build threw, or did not return a SlotBuild. */
  buildError?: string;
  /** Problems that stop it being a kit design (four slits, a disc joining nothing, ...). */
  problems: string[];
  checks: CheckResult[];
  summary?: {title: string; pieces: number; mix: Record<string, number>; sizeMm: {x: number; y: number; z: number}; discMm: number; sheetMm: number; pitchMm: number; tipDeg: number};
  pieces?: PieceLine[];
  stdout?: string;
}

/** A material the build must use, and how many pieces it may have (Slot Studio sets these from the page). */
export interface Material {discMm: number; sheetMm: number; clearance: number; maxPieces: number}

const FACES = {x: 'faces ±x', y: 'faces ±y', z: 'flat'} as const;

/** What a loaded build.mjs offers. */
export interface BuildModule {createBuild?: () => unknown; runTests?: (model: Model, t: Tests) => unknown; title?: unknown}

/** Create the build and check it: the hard checks, the material when one is set, then the module's own runTests. */
export async function checkModule(mod: BuildModule, sourceSha: string, material?: Material): Promise<{report: ValidationReport; build?: SlotBuild; verdict?: Verdict}> {
  try {
    if (typeof mod.createBuild !== 'function') throw new Error('build.mjs must export a function createBuild() that returns a SlotBuild');
    const build = await mod.createBuild();
    if (!(build instanceof SlotBuild)) throw new Error('createBuild() must return a SlotBuild (import {SlotBuild} as the template does, and return it)');
    const title = typeof mod.title === 'string' ? mod.title : 'Untitled';
    const r = build.resolve(), v = hardChecks(r);
    const checks = [...v.checks];
    if (material && !v.problems.length) {
      const same = (a: number, b: number) => Math.abs(a - b) < 0.01;
      checks.push(same(build.discMm, material.discMm) && same(build.sheetMm, material.sheetMm) && same(build.clearance, material.clearance)
        ? {name: 'material', passed: true, detail: null}
        : {name: 'material', passed: false, detail: `the discs must be ${material.discMm} mm across in ${material.sheetMm} mm sheet: use new SlotBuild({discMm: ${material.discMm}, sheetMm: ${material.sheetMm}}) as the template does`});
      checks.push(r.pieces.length <= material.maxPieces
        ? {name: 'piece_budget', passed: true, detail: null}
        : {name: 'piece_budget', passed: false, detail: `${r.pieces.length} pieces; the user has ${material.maxPieces} circles`});
    }
    if (v.model && typeof mod.runTests === 'function') {
      const t = new Tests();
      try { await mod.runTests(v.model, t); } catch (e) { t.check('runTests', false, `runTests threw: ${errText(e)}`); }
      for (const c of t.results) if (!checks.some(h => h.name === c.name)) checks.push(c);
    }
    const model = v.model ?? new Model(r);
    const report: ValidationReport = {
      ok: !v.problems.length && checks.length > 0 && checks.every(c => c.passed), sourceSha, problems: v.problems, checks,
      summary: {title, pieces: r.pieces.length, mix: model.mix(), sizeMm: model.sizeMm, discMm: build.discMm, sheetMm: build.sheetMm, pitchMm: Math.round(r.kit.p * 10) / 10, tipDeg: Math.round(v.tipDeg * 10) / 10},
      pieces: r.pieces.map(p => ({n: p.index, name: p.name, cell: p.cell, faces: (p.piece === 'H1' ? 'half disc, ' : '') + FACES[p.normal], piece: p.piece, slits: p.slits, joins: p.joins, floor: p.touchesFloor})),
    };
    return {report, build, verdict: v};
  } catch (e) {
    return {report: {ok: false, sourceSha, buildError: errText(e), problems: [], checks: []}};
  }
}

/** An error's message and the first lines of its stack that point into the build, not the runtime. */
export function errText(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  return (e.stack ?? e.message).split('\n').filter(l => !/node:internal|node_modules|\/src\/slotwright\/|blob:|chunk-|assets\//.test(l) || /^\w*Error/.test(l)).slice(0, 8).join('\n').replace(/\.run-[0-9a-f]+-\d+\.mjs/g, 'build.mjs');
}

/** The validation report in words, for the model and the terminal. */
export function reportText(r: ValidationReport): string {
  if (r.buildError) return `ok: false\nThe build did not run:\n${r.buildError}`;
  const lines = [`ok: ${r.ok}`];
  if (r.problems.length) lines.push('Not a kit design yet (fix these first; nothing else was checked):', ...r.problems.map(p => `  - ${p}`));
  if (r.checks.length) lines.push('Checks:', ...r.checks.map(c => `  ${c.passed ? 'pass' : 'FAIL'} ${c.name}${c.detail ? `: ${c.detail}` : ''}`));
  const s = r.summary;
  if (s) {
    const mix = Object.entries(s.mix).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ');
    lines.push(`"${s.title}": ${s.pieces} pieces (${mix}); ${Math.round(s.sizeMm.x)} × ${Math.round(s.sizeMm.y)} × ${Math.round(s.sizeMm.z)} mm (x × y × z); ${s.discMm} mm discs, ${s.sheetMm} mm sheet, pitch ${s.pitchMm} mm${s.tipDeg ? `; tips at ${s.tipDeg}°` : ''}`);
  }
  if (r.pieces?.length) lines.push('Pieces (# name: cell, plane, kit piece, slits toward, joined to, floor):', ...r.pieces.map(p => `  #${p.n} ${p.name}: (${p.cell.join(', ')}) ${p.faces}, ${p.piece ?? 'no kit piece'}, slits ${p.slits.join(' ') || 'none'} → ${p.joins.map(j => `#${j}`).join(' ') || 'nothing'}${p.floor ? ', on floor' : ''}`));
  if (r.stdout) lines.push(`Printed while building:\n${r.stdout}`);
  return lines.join('\n');
}
