/**
 * The rule-free atlas: free forms filed on a map (MAP-Elites), searched for structures unlike the kit's own tables.
 *
 * Map features: which rules a form breaks (kit joints only, clips, stacking, both), loops of contacts, height in
 * joint pitches and plan spread. Each cell keeps its most novel legal table and its most novel near miss (fewest
 * failures first). Novelty is the mean structural distance to the 15 nearest legal tables seen, the lattice atlas's
 * rule-bound tables included, so a form that only re-does a kit table is not novel. Parents are drawn mostly from
 * novel legal tables (the minimal criterion the lattice atlas's ablation found worked best), and the search starts
 * from the lattice atlas's legal tables, so it steps off the kit's rules from places that already stand.
 *
 * Every legal table is then re-judged as a check of how much it leans on the model (triage).
 */
import {rng as makeRng} from '../math.js';
import type {Kit, Pose} from '../atlas/lattice.js';
import {FingerprintSet} from '../atlas/structure.js';
import type {TableRules} from '../atlas/judge.js';
import {freeKey, fromFreeKey} from './free.js';
import {FREE_FAIL, judgeFree, type FreeMetrics, type FreeVerdict} from './judge.js';
import {mutate, type MoveKind} from './moves.js';
import {freeFingerprint} from './structure.js';
import type {BuildStep} from './assembly.js';

const LOOPS: [number, string][] = [[0, '0'], [1, '1'], [3, '2–3'], [7, '4–7'], [15, '8–15'], [Infinity, '16+']];
const SPREAD: [number, string][] = [[150, '<150'], [250, '150–250'], [400, '250–400'], [Infinity, '400+']];
export const KIT_DIST: [number, string][] = [[1e-6, 'a kit table'], [0.25, 'close'], [0.5, 'apart'], [0.8, 'far'], [Infinity, 'very far']];
export const kitBucket = (d: number) => (Number.isFinite(d) ? KIT_DIST.find(([hi]) => d < hi)![1] : 'unmeasured');

export type Breaks = 'kit joints' | 'clips' | 'stacking' | 'clips + stacking';
export const BREAKS: Breaks[] = ['kit joints', 'clips', 'stacking', 'clips + stacking'];

export interface FreeFeatures {breaks: Breaks; loops: string; height: number; spread: string; kit: string}

export function freeFeatures(kit: Kit, m: FreeMetrics, kitDist: number): FreeFeatures {
  return {
    breaks: m.clips && m.rests ? 'clips + stacking' : m.clips ? 'clips' : m.rests ? 'stacking' : 'kit joints',
    loops: LOOPS.find(([hi]) => m.loops <= hi)![1],
    height: Math.round(m.height / kit.p),
    spread: SPREAD.find(([hi]) => m.spread < hi)![1],
    kit: kitBucket(kitDist),
  };
}
export const freeFeatureKey = (f: FreeFeatures) => `${f.breaks} · loops ${f.loops} · height ${f.height} · spread ${f.spread}`;

/** How much a legal table leans on the model. */
export interface Triage {
  /** Still legal with friction 0.3 (pieces and floor) instead of 0.4. */
  lowFriction: boolean;
  /** Still runs into nothing with slits cut to the sheet thickness (no clearance). */
  tightFit: boolean;
  /** Joins two notched half discs notch to notch (a joint the kit rules out as too shallow). */
  halfOnHalf: boolean;
  label: 'robust' | 'needs friction' | 'needs slack' | 'half on half';
}

export interface FreeEntry {
  key: string;
  fails: number;
  metrics: FreeMetrics;
  features: FreeFeatures;
  steps: BuildStep[];
  top: FreeVerdict['top'];
  novelty: number;
  /** Structural distance to the nearest of the lattice atlas's legal tables. */
  kitDist: number;
  /** The move that made it (seed: from the lattice atlas). */
  move: MoveKind | 'seed';
  triage?: Triage;
}

export interface FreeCell {legal?: FreeEntry; near?: FreeEntry; seen: number; minPieces: number}

const popcount = (x: number) => { let n = 0; while (x) { n += x & 1; x >>>= 1; } return n; };

export class FreeAtlas {
  readonly cells = new Map<string, FreeCell>();
  readonly seen = new Map<string, number>();
  readonly byFails = new Map<number, number>();
  readonly exampleOf = new Map<number, FreeEntry>();
  /** Rule-bound tables (the lattice atlas's legal ones), and every legal table seen here. */
  readonly kitTables = new FingerprintSet();
  readonly legal = new FingerprintSet(15);
  readonly fp = new Map<string, Float32Array>();
  readonly moves = new Map<string, {tried: number; legal: number}>();
  evaluations = 0;
  ms = 0;
  constructor(readonly kit: Kit, readonly rules: TableRules) {}

  private noveltyOf(e: FreeEntry) { const v = this.fp.get(e.key); return v ? this.legal.novelty(v, !e.fails) : e.novelty; }

  private beats(a: FreeEntry, b: FreeEntry | undefined) {
    if (!b) return true;
    if (!a.fails !== !b.fails) return !a.fails;
    const pa = popcount(a.fails), pb = popcount(b.fails);
    if (pa !== pb) return pa < pb;
    a.novelty = this.noveltyOf(a); b.novelty = this.noveltyOf(b);
    return a.novelty > b.novelty;
  }

  /** Judge a form once and file it. `asKitTable`: also count it as a rule-bound table to measure from. */
  add(form: Pose[], move: FreeEntry['move'], asKitTable = false): FreeEntry | null {
    if (!form.length || form.length > this.rules.maxDiscs) return null;
    const key = freeKey(form);
    if (this.seen.has(key)) return null;
    const f = fromFreeKey(key), t0 = performance.now(), v = judgeFree(this.kit, f, this.rules);
    const fpv = freeFingerprint(f, v.contacts);
    if (asKitTable) this.kitTables.add(fpv);
    const kitDist = this.kitTables.size ? this.kitTables.nearest(fpv) : Infinity;
    const novelty = this.legal.novelty(fpv);
    this.ms += performance.now() - t0;
    this.evaluations++;
    const st = this.moves.get(move) ?? {tried: 0, legal: 0};
    st.tried++; if (!v.fails) st.legal++;
    this.moves.set(move, st);
    const e: FreeEntry = {key, fails: v.fails, metrics: v.metrics, features: freeFeatures(this.kit, v.metrics, kitDist), steps: v.build.steps, top: v.top, novelty, kitDist, move};
    this.fp.set(key, fpv);
    if (!v.fails) this.legal.add(fpv);
    this.seen.set(key, v.fails);
    this.byFails.set(v.fails, (this.byFails.get(v.fails) ?? 0) + 1);
    if (this.beats(e, this.exampleOf.get(v.fails))) this.exampleOf.set(v.fails, e);
    const ck = freeFeatureKey(e.features), cell = this.cells.get(ck) ?? {seen: 0, minPieces: Infinity};
    cell.seen++;
    cell.minPieces = Math.min(cell.minPieces, f.length);
    if (!e.fails) { if (this.beats(e, cell.legal)) cell.legal = e; } else if (this.beats(e, cell.near)) cell.near = e;
    this.cells.set(ck, cell);
    if (cell.legal !== e && cell.near !== e && this.exampleOf.get(v.fails) !== e) this.fp.delete(key);
    return e;
  }

  refreshNovelty() { for (const e of this.elites()) e.novelty = this.noveltyOf(e); for (const e of this.exampleOf.values()) e.novelty = this.noveltyOf(e); }
  elites(): FreeEntry[] { return [...this.cells.values()].flatMap(c => [c.legal, c.near].filter((x): x is FreeEntry => !!x)); }
}

export function exploreFree(atlas: FreeAtlas, iterations: number, seed = 1, onProgress?: (i: number) => void) {
  const r = makeRng(seed);
  let elites = atlas.elites(), legal = elites.filter(e => !e.fails);
  for (let it = 0; it < iterations; it++) {
    if (it % 200 === 0) { elites = atlas.elites(); legal = elites.filter(e => !e.fails); }
    if (it && it % 1000 === 0) atlas.refreshNovelty();
    const cells = [...atlas.cells.values()];
    if (!cells.length) return;
    let parent: FreeEntry;
    if (legal.length && r.next() < 0.7) parent = [0, 1, 2, 3].map(() => r.pick(legal)).reduce((a, b) => (b.novelty > a.novelty ? b : a));
    else { const c = r.pick(cells); parent = c.legal && c.near ? r.pick([c.legal, c.near]) : (c.legal ?? c.near)!; }
    const child = mutate(atlas.kit, fromFreeKey(parent.key), r, atlas.rules.maxDiscs);
    if (child) atlas.add(child.form, child.move);
    if (onProgress && it % 250 === 0) onProgress(it);
  }
  atlas.refreshNovelty();
}

/**
 * The kit with every slit narrowed to the sheet thickness about its own centre line, as deep as before: a press fit.
 * (Cutting with no clearance would also make slits shallower, and a clip seated within that would read as a clash.)
 */
export function narrowSlits(kit: Kit): Kit {
  const pieces = new Map([...kit.pieces].map(([id, P]) => {
    const cuts = P.cuts.map((poly, k) => {
      const sl = P.slits[k];
      if (!sl) return poly;
      const q: [number, number] = [-sl.d[1], sl.d[0]];
      return poly.map(([x, y]): [number, number] => {
        const o = (x - sl.e[0]) * q[0] + (y - sl.e[1]) * q[1], shift = Math.sign(o) * (Math.abs(o) - kit.t / 2);
        return [x - q[0] * shift, y - q[1] * shift];
      });
    });
    return [id, {...P, cuts}] as const;
  }));
  return {...kit, clearance: 0, pieces, base: new Map(), overlapMemo: new Map(), slideMemo: new Map(), nudgeMemo: new Map()};
}

/** Re-judge a legal table at lower friction and with slits cut tight, and look for notch-to-notch half discs. */
export function triage(kit: Kit, rules: TableRules, e: FreeEntry): Triage {
  const form = fromFreeKey(e.key);
  const lowFriction = !judgeFree(kit, form, rules, {statics: {mu: 0.3, muFloor: 0.3}, skipBuild: true}).fails;
  const tight = narrowSlits(kit), tightFit = !(judgeFree(tight, form, rules, {skipBuild: true}).fails & FREE_FAIL.overlap);
  const v = judgeFree(kit, form, rules, {skipBuild: true});
  const halfOnHalf = v.contacts.some(c => c.b >= 0 && c.a < form.length && c.b < form.length && (c.kind === 'lap' || c.kind === 'clip') && form[c.a].k === 'H' && form[c.b].k === 'H');
  const label = halfOnHalf ? 'half on half' : !tightFit ? 'needs slack' : !lowFriction ? 'needs friction' : 'robust';
  return {lowFriction, tightFit, halfOnHalf, label};
}
