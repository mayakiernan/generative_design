/**
 * The design site's search: no new search at all. The form atlas (npm run atlas) is searched once, offline, at 80 mm
 * discs; a request is answered by slicing that archive at the user's disc size and piece budget, picking a spread
 * of structures, and judging those again at the real kit (1/4 in plywood, the user's diameter).
 *
 * Archive heights and widths scale with the lattice pitch, so a form's height at diameter D is predicted as
 * height × p(D) / p(80) before it is judged; the judge then has the last word.
 *
 * Every form is cut down to the slits it uses (skeletonKey: no exposed slits). A half disc's slit comes with the
 * piece, so a form with a half disc whose slit joins nothing is dropped, and so is any form with a notched half disc
 * (H), which the kit does not have.
 */
import {fromKey, makeKit, mouths, opposite, skeletonKey, type Form, type Kit} from '../slots/atlas/lattice.js';
import {FAIL, judge, type TableRules, type Verdict} from '../slots/atlas/judge.js';
import type {AtlasEntry, AtlasRun} from '../slots/atlas/item.js';
import {distance, fingerprint} from '../slots/atlas/structure.js';
import {stepHolds, type StepHold} from '../slots/atlas/holds.js';
import type {FunctionSpec} from './spec.js';

/**
 * The form atlas run Slot Studio answers from (atlas-runs/<id>/atlas.json). Pinned, not "the newest", so a new run
 * (or one in progress, or a rule-free one in another format) never changes the site until it is chosen here.
 */
export const STUDIO_RUN = '2026-11-22T20-24-38-no-notched';

/** 1/4 in plywood, nominal. */
export const SHEET_MM = 6.35;
/** Slit clearance the checks run at: a snug fit is checked as a sliding one (friction is never counted on). */
export const CHECK_CLEARANCE = 0.2;
/** Slit clearance on the cut sheet: tighter than the sheet, tapped home with a mallet. */
export const CUT_CLEARANCE = -0.15;
/**
 * Smallest disc the archive holds up at in 1/4 in sheet. Below about 150 mm the sheet is thick enough next to the
 * disc that the archive's build sequences jam (measured 2026-11-22: 0 of 12 tables at 140 mm, 11 of 12 at 160).
 */
export const MIN_DIAMETER = 160;
/** The archive and the build search stop at 30 pieces. */
export const MAX_PIECES = 30;
/** Gap between pieces on the cut sheet, mm. */
export const SHEET_GAP = 6;

const kits = new Map<string, Kit>();
/** One kit per diameter and fit, reused: its overlap and slide memos are what make judging fast. */
export function kitFor(diameter: number, clearance = CHECK_CLEARANCE): Kit {
  const id = `${diameter}/${clearance}`;
  let kit = kits.get(id);
  if (!kit) { kit = makeKit(diameter, SHEET_MM, clearance); kits.set(id, kit); }
  return kit;
}

/** Circles a form uses: a full disc is one, a half disc half of one (two are cut from one circle's place). */
export function circleCount(form: Form): number {
  return form.discs.reduce((n, p) => n + (p.k ? 0.5 : 1), 0);
}

/** Does every slit cut join something? */
export function isClosed(form: Form): boolean {
  const joined = form.discs.map(() => 0);
  for (const {i, j, d} of form.joints()) { joined[i] |= 1 << d; joined[j] |= 1 << opposite(d); }
  return form.discs.every((p, i) => mouths(p.m).every(d => joined[i] & (1 << d)));
}

export interface Candidate {
  /** Canonical key of the closed form (spare slits cut away). */
  key: string;
  circles: number;
  /** Passed every table check in the archive. */
  legal: boolean;
  /** Surface height, least surface width and the top's bounding box, at the archive's pitch, mm. */
  height: number; width: number; topBox: [number, number];
  novelty: number;
  fp: Float32Array;
  /** How it rests in the archive, when not as built: tried first when judging it again. */
  rest?: number[];
}

/** Failures that "not stable" lets through: standing and bracing. Build, overlap and a missing surface never pass. */
export const UNSTABLE_OK = FAIL.falls | FAIL.loose | FAIL.sags | FAIL.folds | FAIL.short;

/**
 * The archive's forms that can answer a request: legal tables, and for "not stable" its near misses too. For a purpose
 * with no top (`needsTop` false: a sculpture), every form the archive holds that can be built: whether it stands is
 * judged again without a top.
 */
export function candidates(run: AtlasRun, stable: boolean, needsTop = true): Candidate[] {
  const out = new Map<string, Candidate>();
  const add = (e: AtlasEntry, legal: boolean) => {
    if (!needsTop) { if (e.fails & (FAIL.build | FAIL.many)) return; }
    else if (!legal && (e.fails & ~UNSTABLE_OK || !e.top)) return;
    const closed = fromKey(skeletonKey(fromKey(e.key)));
    if (!isClosed(closed)) return;
    // The kit has no notched half disc (H): only full discs and the half disc with one slit (H1).
    if (closed.discs.some(p => p.k === 'H')) return;
    const key = skeletonKey(closed);
    if (out.has(key) && (out.get(key)!.legal || !legal)) return;
    const xs = e.top ? e.top.outline.map(q => q[0]) : [0], ys = e.top ? e.top.outline.map(q => q[1]) : [0];
    out.set(key, {
      key, circles: circleCount(closed), legal,
      height: e.metrics.height, width: e.metrics.surfaceWidth,
      topBox: [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)],
      novelty: e.novelty ?? 0, fp: fingerprint(closed), ...(e.rest && key === e.key ? {rest: e.rest} : {}),
    });
  };
  for (const c of run.cells) if (c.legal) add(c.legal, true);
  if (!stable || !needsTop) for (const c of run.cells) if (c.near) add(c.near, false);
  return [...out.values()];
}

/** How much bigger everything is at diameter D than in the archive. */
export const scaleAt = (run: AtlasRun, diameter: number) => kitFor(diameter).p / run.params.pitch;

export interface Material {
  diameter: number;
  /** Circles available (half discs count half). */
  circles: number;
  /** In sheet mode: the sheet, mm. The circles are then whatever fits it beside the top. */
  sheet?: [number, number];
}

/** Grid cells one disc plus a gap wide that fit a sheet (kitSheet.ts's layout). */
export function sheetCells(sheet: [number, number], diameter: number): number {
  const c = diameter + SHEET_GAP;
  return Math.floor((sheet[0] + SHEET_GAP) / c) * Math.floor((sheet[1] + SHEET_GAP) / c);
}

/** Cells a design takes on the sheet: one per full disc, one per pair of half discs, and a block for the top. */
export function cellsNeeded(form: Form, topBox: [number, number], diameter: number): number {
  const full = form.discs.filter(p => !p.k).length, halves = form.size - full, c = diameter + SHEET_GAP;
  const top = topBox[0] > 0 ? Math.ceil((topBox[0] + SHEET_GAP) / c) * Math.ceil((topBox[1] + SHEET_GAP) / c) : 0;
  return full + Math.ceil(halves / 2) + top;
}

/** Predicted fit, before judging: piece budget (or sheet), height band and surface width. */
export function inSlice(c: Candidate, spec: FunctionSpec, m: Material, scale: number): boolean {
  if (c.circles > Math.min(m.circles, MAX_PIECES)) return false;
  const h = c.height * scale, w = c.width * scale;
  if (spec.role !== 'none' && (h < spec.minH * 0.97 || h > spec.maxH * 1.03 || w < spec.minWidth * 0.97)) return false;
  if (m.sheet) {
    const box: [number, number] = [c.topBox[0] * scale, c.topBox[1] * scale];
    if (cellsNeeded(fromKey(c.key), box, m.diameter) > sheetCells(m.sheet, m.diameter)) return false;
  }
  return true;
}

/**
 * Candidates in farthest-point order on their structural fingerprints: the first is the most novel, each next one
 * the least like any already picked. The page judges them in this order and stops once it has enough.
 */
export function spreadOrder(cs: Candidate[]): Candidate[] {
  if (!cs.length) return [];
  const left = [...cs].sort((a, b) => b.novelty - a.novelty), out = [left.shift()!];
  const near = left.map(c => distance(c.fp, out[0].fp));
  while (left.length) {
    let k = 0;
    for (let i = 1; i < left.length; i++) if (near[i] > near[k]) k = i;
    const [pick] = left.splice(k, 1);
    near.splice(k, 1);
    out.push(pick);
    for (let i = 0; i < left.length; i++) near[i] = Math.min(near[i], distance(left[i].fp, pick.fp));
  }
  return out;
}

export interface Reach {
  /** Smallest and largest diameter at which some candidate within the piece budget fits the spec, or null. */
  minD: number | null; maxD: number | null;
  /** Height band the candidates within budget reach at the asked diameter, mm. */
  heights: [number, number] | null;
}

/** Why a request finds nothing, in sizes: which diameters would work with this many circles. */
export function reach(run: AtlasRun, cs: Candidate[], spec: FunctionSpec, m: Material): Reach {
  const within = cs.filter(c => c.circles <= Math.min(m.circles, MAX_PIECES));
  if (!within.length) return {minD: null, maxD: null, heights: null};
  // Height and width grow in proportion to the diameter (to within the sheet thickness).
  const per = run.params.size;
  let minD = Infinity, maxD = 0;
  for (const c of within) {
    const lo = Math.max(MIN_DIAMETER, (spec.minH / c.height) * per, (spec.minWidth / c.width) * per), hi = (spec.maxH / c.height) * per;
    if (lo <= hi) { minD = Math.min(minD, lo); maxD = Math.max(maxD, hi); }
  }
  const s = scaleAt(run, m.diameter), hs = within.map(c => c.height * s);
  return {
    minD: Number.isFinite(minD) ? Math.ceil(minD / 5) * 5 : null, maxD: maxD ? Math.floor(maxD / 5) * 5 : null,
    heights: [Math.min(...hs), Math.max(...hs)],
  };
}

export interface SheetOption {diameter: number; circles: number; count: number}

/**
 * Sheet mode: the diameters worth offering. For each diameter from the smallest the archive holds up at to the
 * largest that fits the sheet, how many candidates fit the sheet with their top; then a few spread across the range,
 * always including the one with the most.
 */
export function sheetOptions(run: AtlasRun, cs: Candidate[], spec: FunctionSpec, sheet: [number, number], step = 10): SheetOption[] {
  const all: SheetOption[] = [];
  for (let D = MIN_DIAMETER; D + SHEET_GAP <= Math.min(...sheet); D += step) {
    const circles = sheetCells(sheet, D), s = scaleAt(run, D);
    const count = cs.filter(c => inSlice(c, spec, {diameter: D, circles, sheet}, s)).length;
    if (count) all.push({diameter: D, circles, count});
  }
  if (all.length <= 5) return all;
  const best = all.reduce((a, b) => (b.count > a.count ? b : a));
  const picks = new Set([best, all[0], all[all.length - 1], all[Math.floor(all.length / 3)], all[Math.floor((2 * all.length) / 3)]]);
  return [...picks].sort((a, b) => a.diameter - b.diameter);
}

/** The table rules the atlas judge runs at diameter D for this spec. */
export function rulesFor(spec: FunctionSpec, diameter: number): TableRules {
  if (spec.role === 'none') return {height: 0, maxDiscs: 2 * MAX_PIECES, minTip: 8, topMargin: 0.25 * diameter, budget: 4000, top: false};
  return {height: spec.minH, maxDiscs: 2 * MAX_PIECES, minTip: 8, topMargin: 0.25 * diameter, budget: 4000};
}

export interface Judged {
  key: string;
  verdict: Pick<Verdict, 'fails' | 'metrics' | 'top' | 'rest'> & {steps: Verdict['build']['steps']; found: boolean};
  ok: boolean;
  /** What it misses against the spec beyond the judge's own checks (height band top, surface width). */
  misses: string[];
  /** For each build step, whether the part built so far has to be held (holds.ts); only for designs that pass. */
  holds?: StepHold[];
}

/** Judge a closed form at the real kit, and check the spec's own limits the table judge does not. */
export function judgeAt(key: string, spec: FunctionSpec, diameter: number, stable: boolean, rest?: number[]): Judged {
  const kit = kitFor(diameter), v = judge(kit, fromKey(key), rulesFor(spec, diameter), rest), m = v.metrics, misses: string[] = [];
  if (v.top && m.height > spec.maxH) misses.push(`top ${Math.round(m.height)} mm up; a ${spec.label} is at most ${spec.maxH}`);
  if (v.top && m.surfaceWidth < spec.minWidth) misses.push(`top ${Math.round(m.surfaceWidth)} mm across at its narrowest; a ${spec.label} needs ${spec.minWidth}`);
  // A sculpture only has to be buildable and, if stable, stand with nothing loose and no joint swinging.
  const allowed = spec.role === 'none' ? (stable ? FAIL.folds | FAIL.short | FAIL.surface : UNSTABLE_OK | FAIL.surface) : stable ? 0 : UNSTABLE_OK & ~FAIL.short;
  const ok = (v.fails & ~allowed) === 0 && !misses.length;
  const holds = ok && v.build.found ? stepHolds(kit, fromKey(key), v.build.steps) : undefined;
  return {key, ...(holds ? {holds} : {}), verdict: {fails: v.fails, metrics: m, top: v.top, ...(v.rest ? {rest: v.rest} : {}), steps: v.build.steps, found: v.build.found}, ok, misses};
}

/** A judged form as an atlas entry, so the atlas's design sheet can show it. */
export function entryOf(j: Judged): AtlasEntry {
  const v = j.verdict;
  return {
    key: j.key, discs: v.metrics.discs, fails: v.fails, failing: [], grid: false,
    features: {loops: '', height: 0, footprint: '', surface: '', symmetry: v.metrics.symmetry},
    metrics: v.metrics, steps: v.steps, top: v.top, ...(v.rest ? {rest: v.rest} : {}),
  };
}
