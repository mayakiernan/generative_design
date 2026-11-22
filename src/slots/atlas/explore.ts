/**
 * The form atlas: every kind of form the Circular kit makes within a disc budget, legal tables and not.
 *
 * "Every form" cannot be listed at 30 discs (each disc multiplies the choices), so a form is described by a few
 * features and the atlas fills a map over them (MAP-Elites): loops of joints (0 is a tree, many is an egg crate),
 * height in lattice steps, plan footprint in lattice cells, surface size and symmetry. Each cell keeps its best
 * legal table and its closest near miss; every form evaluated is counted by exactly which checks it fails.
 *
 * Forms are made by small changes that keep the geometry valid (no overlaps, one connected piece): add a disc on
 * an open slit (favouring poses whose other slits meet open slits facing back, which closes loops), take a disc
 * off, add or remove a slit. Whether a form can be built is not assumed: the judge searches for a group build
 * sequence. Small forms are also enumerated exhaustively, as ground truth for the map.
 */
import {rng as makeRng, type Rng} from '../math.js';
import {buildGrid, gridProblem, growStacked, type GridLayout, type Site} from '../grids.js';
import {grow} from '../kits.js';
import {
  axisOf, canonicalKey, cellKey, connected, Form, fromKey, inPlane, latticeOf, mouthCount, mouths, opposite, pieceOf,
  posesOnto, skeletonKey, step, transformDir, transformPose, type Axis, type Kit, type Pose,
} from './lattice.js';
import {judge, type Metrics, type TableRules, type Verdict} from './judge.js';
import type {BuildStep} from './assembly.js';
import {baseLabels, crateBucket, fingerprint, FingerprintSet, labelFor} from './structure.js';

/* ---------- features ---------- */

const LOOP_BUCKETS: [number, string][] = [[0, '0'], [1, '1'], [2, '2'], [3, '3'], [6, '4–6'], [10, '7–10'], [Infinity, '11+']];
const SURFACE_BUCKETS: [number, string][] = [[0.5, '<½ disc'], [1, '½–1 disc'], [2, '1–2 discs'], [4, '2–4 discs'], [Infinity, '4+ discs']];

export interface Features {
  loops: string;
  /** Height in lattice steps (rounded). */
  height: number;
  /** Plan extent of the disc centres in lattice cells, long side × short side. */
  footprint: string;
  surface: string;
  symmetry: number;
  /** How far the structure is from the nearest egg crate (structure.ts CRATE_BUCKETS). */
  crate: string;
}

export function features(kit: Kit, form: Form, m: Metrics, crate: string): Features {
  const xs = form.discs.map(p => p.c[0]), ys = form.discs.map(p => p.c[1]);
  const w = Math.max(...xs) - Math.min(...xs) + 1, d = Math.max(...ys) - Math.min(...ys) + 1;
  const discArea = Math.PI * kit.R * kit.R, s = m.surface / discArea;
  return {
    loops: LOOP_BUCKETS.find(([hi]) => m.loops <= hi)![1],
    height: Math.round(m.height / kit.p),
    footprint: `${Math.max(w, d)}×${Math.min(w, d)}`,
    surface: m.surface ? SURFACE_BUCKETS.find(([hi]) => s < hi)![1] : 'none',
    symmetry: m.symmetry,
    crate,
  };
}
export const featureKey = (f: Features) => `loops ${f.loops} · height ${f.height} · plan ${f.footprint} · surface ${f.surface} · sym ${f.symmetry} · ${f.crate}`;

/* ---------- archive ---------- */

export interface Entry {
  /** Canonical key; the form is fromKey(key), and build steps index its discs in that order. */
  key: string;
  fails: number;
  metrics: Metrics;
  features: Features;
  steps: BuildStep[];
  top: Verdict['top'];
  buildExhausted: boolean;
  /** Mean fingerprint distance to the 15 most similar legal tables seen (refreshed as the archive grows). */
  novelty: number;
  /** Fingerprint distance to the nearest egg crate; 0 for an egg crate. */
  crate: number;
}

/**
 * What a cell keeps when two forms compete: `useful` keeps the most usable top per disc (the top's area over its
 * supports); `novel` keeps the structure least like the legal tables seen; `both` multiplies the two.
 */
export type Rank = 'novel' | 'useful' | 'both';

const popcount = (x: number) => { let n = 0; while (x) { n += x & 1; x >>>= 1; } return n; };
const usable = (e: Entry) => (e.metrics.surface * e.metrics.safeFrac) / e.metrics.discs + e.metrics.tipDeg * 1e-3;

export interface CellRecord {legal?: Entry; near?: Entry; seen: number; minDiscs: number}

export class Atlas {
  readonly cells = new Map<string, CellRecord>();
  /** Every form evaluated: canonical key → failure bitmask. */
  readonly seen = new Map<string, number>();
  /** Every form evaluated: its cell, loops, disc count, skeleton and distance from an egg crate. */
  readonly info = new Map<string, {cell: string; loops: number; discs: number; skeleton: string; crate: number}>();
  /** Forms evaluated, by failure bitmask. */
  readonly byFails = new Map<number, number>();
  /** Best example of each failure bitmask. */
  readonly exampleOf = new Map<number, Entry>();
  /** Fingerprints of the egg crates novelty is measured from, and of every legal table seen. */
  readonly crates = new FingerprintSet();
  readonly legal = new FingerprintSet(15);
  /** Fingerprints of the elites, to refresh their novelty. */
  readonly fp = new Map<string, Float32Array>();
  /** How often each disc motif (first label) occurs in legal tables, for biasing new discs toward rare ones. */
  readonly motifs = new Map<string, number>();
  evaluations = 0;
  ms = 0;
  constructor(readonly kit: Kit, readonly rules: TableRules, readonly rank: Rank = 'novel') {}

  setCrates(forms: Form[]) { for (const f of forms) this.crates.add(fingerprint(f)); }

  /** Weight for a new disc of this motif: rarer in legal tables, more likely. */
  motifWeight = (label: string) => (1 + (this.motifs.get(label) ?? 0)) ** -0.35;

  private noveltyOf(e: Entry): number {
    const v = this.fp.get(e.key);
    return v ? this.legal.novelty(v, !e.fails) : e.novelty;
  }

  /** Does a beat b for a place? Legal beats not; fewer failures beat more; then the rank decides. */
  private beats(a: Entry, b: Entry | undefined): boolean {
    if (!b) return true;
    if (!a.fails !== !b.fails) return !a.fails;
    const pa = popcount(a.fails), pb = popcount(b.fails);
    if (pa !== pb) return pa < pb;
    if (this.rank === 'useful') return usable(a) > usable(b);
    a.novelty = this.noveltyOf(a); b.novelty = this.noveltyOf(b);
    return this.rank === 'novel' ? a.novelty > b.novelty : a.novelty * usable(a) > b.novelty * usable(b);
  }

  /** Judge a form (once per canonical form) and file it. Returns the entry, or null if seen before or too big. */
  add(form: Form): Entry | null {
    if (!form.size || form.size > this.rules.maxDiscs) return null;
    const key = canonicalKey(form);
    if (this.seen.has(key)) return null;
    const f = fromKey(key), t0 = performance.now(), v = judge(this.kit, f, this.rules);
    const fpv = fingerprint(f), near = this.crates.size ? this.crates.nearest(fpv) : Infinity;
    // Egg crates bigger than any seed sit a little off every seed fingerprint: the structural test settles it.
    const crate = near < 1e-6 || (near < 0.8 && isEggCrate(this.kit, f)) ? 0 : near;
    const novelty = this.legal.novelty(fpv);
    this.ms += performance.now() - t0;
    this.evaluations++;
    const e: Entry = {key, fails: v.fails, metrics: v.metrics, features: features(this.kit, f, v.metrics, crateBucket(crate)), steps: v.build.steps, top: v.top, buildExhausted: v.build.exhausted, novelty, crate};
    this.fp.set(key, fpv);
    if (!v.fails) {
      this.legal.add(fpv);
      for (const l of baseLabels(f)) this.motifs.set(l, (this.motifs.get(l) ?? 0) + 1);
    }
    this.seen.set(key, v.fails);
    this.byFails.set(v.fails, (this.byFails.get(v.fails) ?? 0) + 1);
    if (this.beats(e, this.exampleOf.get(v.fails))) this.exampleOf.set(v.fails, e);
    const ck = featureKey(e.features), cell = this.cells.get(ck) ?? {seen: 0, minDiscs: Infinity};
    this.info.set(key, {cell: ck, loops: v.metrics.loops, discs: f.size, skeleton: skeletonKey(f), crate});
    cell.seen++;
    cell.minDiscs = Math.min(cell.minDiscs, f.size);
    if (!e.fails) { if (this.beats(e, cell.legal)) cell.legal = e; } else if (this.beats(e, cell.near)) cell.near = e;
    this.cells.set(ck, cell);
    // Keep fingerprints only for forms that hold a place.
    if (cell.legal !== e && cell.near !== e && this.exampleOf.get(v.fails) !== e) this.fp.delete(key);
    return e;
  }

  /** Bring every elite's novelty up to date with the legal tables seen so far. */
  refreshNovelty() { for (const e of this.elites()) e.novelty = this.noveltyOf(e); for (const e of this.exampleOf.values()) e.novelty = this.noveltyOf(e); }

  /** Every elite (each cell's legal table and near miss). */
  elites(): Entry[] { return [...this.cells.values()].flatMap(c => [c.legal, c.near].filter((x): x is Entry => !!x)); }
}

/* ---------- changes that keep a form valid ---------- */

/** Joints a new pose would make with the form, counting only reciprocal open slits. */
function jointsMade(form: Form, pose: Pose): number {
  let n = 0;
  for (const d of mouths(pose.m)) {
    const j = form.at.get(cellKey(step(pose.c, d)));
    if (j !== undefined && form.discs[j].m & (1 << opposite(d)) && form.discs[j].a !== pose.a) n++;
  }
  return n;
}

/** Weighted pick of an index. */
function pickWeighted(ws: number[], r: Rng): number {
  const sum = ws.reduce((a, b) => a + b, 0);
  let u = r.next() * sum;
  const k = ws.findIndex(w => (u -= w) <= 0);
  return k < 0 ? ws.length - 1 : k;
}

export function addDisc(kit: Kit, form: Form, r: Rng, motifWeight?: (label: string) => number): Form | null {
  const open = form.openSlits();
  if (!open.length) return null;
  // With a motif bias, grow from the slit whose disc would become the rarest motif among legal tables (a new disc
  // usually joins by one slit only, so its own pose barely changes its motif; the disc it grows from does).
  let joined: number[] = [];
  if (motifWeight) {
    joined = form.discs.map(() => 0);
    for (const {i, j, d} of form.joints()) { joined[i] |= 1 << d; joined[j] |= 1 << opposite(d); }
  }
  const slitWeights = motifWeight ? open.map(([i, d]) => motifWeight(labelFor(form.discs[i], joined[i] | (1 << d)))) : null;
  for (let tries = 0; tries < 8; tries++) {
    const [i, d] = slitWeights ? open[pickWeighted(slitWeights, r)] : r.pick(open), opts = posesOnto(form.discs[i], d).filter(p => form.fits(kit, p));
    if (!opts.length) continue;
    // Favour poses that close loops: each extra joint triples the weight.
    const ws = opts.map(p => 3 ** (jointsMade(form, p) - 1)), sum = ws.reduce((a, b) => a + b, 0);
    let u = r.next() * sum;
    const k = ws.findIndex(w => (u -= w) <= 0);
    return form.with(opts[k < 0 ? opts.length - 1 : k]);
  }
  return null;
}

export function removeDisc(form: Form, r: Rng): Form | null {
  if (form.size < 2) return null;
  for (let tries = 0; tries < 6; tries++) {
    const next = form.without(r.int(0, form.size - 1));
    if (connected(next)) return next;
  }
  return null;
}

// Slits are added to or filled in full discs only: a half disc's slits come with the piece.
export function addSlit(kit: Kit, form: Form, r: Rng): Form | null {
  const ks = form.discs.map((p, i) => (!p.k && mouthCount(p.m) < 3 ? i : -1)).filter(i => i >= 0);
  if (!ks.length) return null;
  const k = r.pick(ks), P = form.discs[k], free = inPlane(P.a).filter(d => !(P.m & (1 << d)));
  const d = r.pick(free), pose = {...P, m: P.m | (1 << d)};
  return pieceOf(pose.a, pose.m) && form.fits(kit, pose, k) ? form.replace(k, pose) : null;
}

export function removeSlit(kit: Kit, form: Form, r: Rng): Form | null {
  const ks = form.discs.map((p, i) => (!p.k && mouthCount(p.m) >= 2 ? i : -1)).filter(i => i >= 0);
  if (!ks.length) return null;
  const k = r.pick(ks), P = form.discs[k];
  // Only a slit that joins nothing can go; filling it adds material, which must not run into a neighbour.
  const open = mouths(P.m).filter(d => jointsMade(new Form(form.discs.filter((_, i) => i !== k)), {...P, m: 1 << d}) === 0);
  if (!open.length) return null;
  const pose = {...P, m: P.m & ~(1 << r.pick(open))};
  return pieceOf(pose.a, pose.m) && form.fits(kit, pose, k) ? form.replace(k, pose) : null;
}

/** Discs reachable from `start` through joints, never crossing the joint between `start` and `cut`, at most `cap`. */
function cluster(form: Form, start: number, cut: number, cap: number): number[] {
  const adj: number[][] = form.discs.map(() => []);
  for (const {i, j} of form.joints()) { adj[i].push(j); adj[j].push(i); }
  const seen = new Set([start]), order = [start];
  for (let k = 0; k < order.length && order.length < cap; k++) for (const n of adj[order[k]]) {
    if (order.length >= cap) break;
    if (seen.has(n) || (order[k] === start && n === cut)) continue;
    seen.add(n); order.push(n);
  }
  return order;
}

/** Cut off a whole branch: take a joint whose removal splits the form and drop the smaller side. */
export function prune(form: Form, r: Rng): Form | null {
  const js = form.joints();
  for (let tries = 0; tries < 8 && js.length; tries++) {
    const {i, j} = r.pick(js), side = cluster(form, j, i, form.size);
    if (side.includes(i)) continue; // not a bridge: the joint sits in a loop
    const drop = new Set(side.length * 2 <= form.size ? side : form.discs.map((_, k) => k).filter(k => !side.includes(k)));
    if (form.size - drop.size < 2) continue;
    return new Form(form.discs.filter((_, k) => !drop.has(k)));
  }
  return null;
}

/**
 * Graft a branch of another form onto an open slit: take a cluster of up to six discs from the donor, cut at one
 * of its joints, turn it about the vertical (gravity stays down) so its cut slit faces the open slit, and set it on.
 */
export function graft(kit: Kit, form: Form, donor: Form, r: Rng): Form | null {
  const dj = donor.joints(), open = form.openSlits();
  if (!dj.length || !open.length) return null;
  for (let tries = 0; tries < 12; tries++) {
    const jt = r.pick(dj), flip = r.next() < 0.5, s = flip ? jt.j : jt.i, o = flip ? jt.i : jt.j, out = flip ? opposite(jt.d) : jt.d;
    const part = cluster(donor, s, o, r.int(2, 6)).map(k => donor.discs[k]);
    const [ti, td] = r.pick(open), T = form.discs[ti];
    for (const k of [0, 1, 2, 3, 4, 5, 6, 7].sort(() => r.next() - 0.5)) {
      if (transformDir(out, k) !== opposite(td)) continue;
      const turned = part.map(p => transformPose(p, k));
      if (turned[0].a === T.a) continue;
      const at = step(T.c, td), shift = [0, 1, 2].map(x => at[x] - turned[0].c[x]);
      let f: Form | null = form;
      for (const p of turned) {
        const q: Pose = {...p, c: p.c.map((x, i) => x + shift[i]) as Pose['c']};
        if (!f || f.at.has(cellKey(q.c)) || !f.fits(kit, q)) { f = null; break; }
        f = f.with(q);
      }
      if (f && connected(f)) return f;
    }
  }
  return null;
}

export interface Moves {donor?: () => Form; motifWeight?: (label: string) => number}

export function mutate(kit: Kit, form: Form, r: Rng, maxDiscs: number, moves: Moves = {}): Form | null {
  let f: Form | null = form;
  const n = r.pick([1, 1, 2, 3]);
  for (let k = 0; k < n && f; k++) {
    const cur: Form = f, u = r.next(), room = cur.size < maxDiscs;
    // Slit changes only matter as a way to new joints, so they are rarer than adding or taking off discs. Grafts
    // and prunes jump further than one disc; they are only used when the search is after new structure.
    if (moves.donor && u < 0.12) f = room ? graft(kit, cur, moves.donor(), r) : prune(cur, r);
    else if (moves.donor && u < 0.22) f = prune(cur, r);
    else if (u < 0.6 && room) f = addDisc(kit, cur, r, moves.motifWeight);
    else if (u < 0.82) f = removeDisc(cur, r);
    else if (u < 0.91) f = addSlit(kit, cur, r);
    else f = removeSlit(kit, cur, r);
  }
  return f && f !== form && f.size <= maxDiscs ? f : null;
}

/* ---------- egg crates ---------- */

/**
 * Is the form's joined structure a stacked grid (grids.ts), whatever its size? Read the layout off the form: column
 * discs upright on sites two steps apart, one layer per level, each layer's columns in planes along x or y in turn,
 * flat bridge discs midway between two columns of their layer. The layout must pass gridProblem, and buildGrid must
 * rebuild exactly this skeleton. Anything that does not read as a layout is not a grid.
 */
export function isEggCrate(kit: Kit, form: Form): boolean {
  if (form.discs.some(p => p.k)) return false;
  const zs = form.discs.map(p => p.c[2]), z0 = Math.min(...zs), layers = Math.max(...zs) - z0 + 1;
  const first = form.discs.find(p => p.c[2] === z0 && p.a !== 2);
  if (!first) return false;
  // buildGrid stands layer 0's columns in planes along x (normal y); turn the form so its first layer does too.
  const discs = first.a === 1 ? form.discs : form.discs.map(p => transformPose(p, 1));
  const ups = discs.filter(p => p.a !== 2), flats = discs.filter(p => p.a === 2);
  const x0 = Math.min(...ups.map(p => p.c[0])), y0 = Math.min(...ups.map(p => p.c[1]));
  const siteOf = (p: Pose): Site | null => ((p.c[0] - x0) % 2 || (p.c[1] - y0) % 2 ? null : [(p.c[0] - x0) / 2, (p.c[1] - y0) / 2]);
  const sites = new Map<string, Site>();
  for (const p of ups) {
    const s = siteOf(p), k = p.c[2] - z0;
    if (!s || p.a !== (k % 2 === 0 ? 1 : 0)) return false;
    sites.set(s.join(), s);
  }
  if (ups.length !== sites.size * layers) return false;
  const bridges: [Site, Site][][] = Array.from({length: layers}, () => []);
  for (const p of flats) {
    const k = p.c[2] - z0, along = k % 2 === 0 ? 0 : 1, lo = [...p.c] as [number, number, number];
    lo[along] -= 1;
    const a = siteOf({...p, c: lo});
    if (!a) return false;
    const b: Site = along === 0 ? [a[0] + 1, a[1]] : [a[0], a[1] + 1];
    bridges[k].push([a, b]);
  }
  const layout: GridLayout = {sites: [...sites.values()], layers, bridges};
  if (gridProblem(layout)) return false;
  const g = buildGrid([...kit.pieces.values()], layout, kit.t);
  if (!g) return false;
  const rebuilt = latticeOf(kit, g.panels, g.types);
  return rebuilt instanceof Form && skeletonKey(rebuilt) === skeletonKey(form);
}

/* ---------- seeds ---------- */

/** Stacked grids from the gallery's own generator, on the lattice. */
export function gridSeeds(kit: Kit, count: number, seed = 1): Form[] {
  const pieces = [...kit.pieces.values()], out = new Map<string, Form>();
  for (let s = 0; s < count; s++) {
    const g = growStacked(pieces, 10 + (s % 21), kit.t, makeRng(seed * 7919 + s), {}, [2, 3, 3, 4]);
    if (!g) continue;
    const form = latticeOf(kit, g.panels, g.types);
    if (form instanceof Form) out.set(canonicalKey(form), form);
  }
  return [...out.values()];
}

/** Trees grown by the gallery's free growth (half discs included unless `halves` is false), on the lattice. */
export function treeSeeds(kit: Kit, count: number, seed = 1, halves = true): Form[] {
  const pieces = [...kit.pieces.values()], out: Form[] = [];
  for (let s = 0; s < count; s++) {
    const r = makeRng(seed * 104729 + s), g = grow(pieces, r.int(4, 30), r.pick(['any', 'tower', 'spread', 'compact'] as const), kit.t, r, halves ? {} : {weights: {H: 0, H1: 0}});
    if (!g) continue;
    const form = latticeOf(kit, g.panels, g.types);
    if (form instanceof Form) out.push(form);
  }
  return out;
}

/**
 * How the search spends its effort when it is after new structure.
 *  - select: where parents come from. `uniform`: an elite of a cell picked uniformly. `novel-legal`: seven times in
 *    ten the most novel of four legal tables, else uniform (novelty search with a minimal criterion: near misses
 *    still serve as stepping stones through the uniform picks, but novelty only pulls among forms that work).
 *    `novel-all`: the most novel of four elites of any kind (near misses are measured against legal tables, so the
 *    strangest, least table-like forms win; kept to show why the criterion matters). `legal-useful`: the most usable
 *    of four legal tables, as a control (focus on tables without novelty).
 *  - graft: also graft branches from other elites and prune branches.
 *  - motif: bias new discs toward motifs rare among legal tables.
 */
export interface SearchOptions {select: 'uniform' | 'novel-legal' | 'novel-all' | 'legal-useful'; graft: boolean; motif: boolean}
export const defaultSearch = (rank: Rank): SearchOptions => (rank === 'useful' ? {select: 'uniform', graft: false, motif: false} : {select: 'novel-legal', graft: true, motif: false});

/** Run MAP-Elites for `iterations` changes. Novelty goes stale as the archive grows, so elites are re-scored every 1000. */
export function explore(atlas: Atlas, iterations: number, seed = 1, onProgress?: (i: number) => void, opts: SearchOptions = defaultSearch(atlas.rank)) {
  const r = makeRng(seed);
  let elites = atlas.elites(), legal = elites.filter(e => !e.fails);
  const moves: Moves = {donor: opts.graft ? () => fromKey(r.pick(elites).key) : undefined, motifWeight: opts.motif ? atlas.motifWeight : undefined};
  const scored = opts.select === 'novel-legal' || opts.select === 'novel-all' || atlas.rank !== 'useful';
  for (let it = 0; it < iterations; it++) {
    if (it % 200 === 0) { elites = atlas.elites(); legal = elites.filter(e => !e.fails); }
    if (scored && it && it % 1000 === 0) atlas.refreshNovelty();
    const cells = [...atlas.cells.values()];
    if (!cells.length) return;
    const pool = opts.select === 'novel-legal' || opts.select === 'legal-useful' ? legal : opts.select === 'novel-all' ? elites : [];
    const score = opts.select === 'legal-useful' ? usable : (e: Entry) => e.novelty;
    let parent: Entry;
    if (pool.length && r.next() < 0.7) parent = [0, 1, 2, 3].map(() => r.pick(pool)).reduce((a, b) => (score(b) > score(a) ? b : a));
    else { const c = r.pick(cells); parent = c.legal && c.near ? r.pick([c.legal, c.near]) : (c.legal ?? c.near)!; }
    const child = mutate(atlas.kit, fromKey(parent.key), r, atlas.rules.maxDiscs, moves);
    if (child) atlas.add(child);
    if (onProgress && it % 500 === 0) onProgress(it);
  }
  if (scored) atlas.refreshNovelty();
}

/* ---------- exhaustive enumeration ---------- */

/** Every single-piece pose, up to symmetry: full discs, and with `halves` H1 and H too. */
export function singleDiscs(halves = true): Form[] {
  const keys = new Set<string>();
  for (const a of [0, 1, 2] as Axis[]) {
    for (let m = 1; m < 64; m++) if (pieceOf(a, m)) keys.add(canonicalKey([{c: [0, 0, 0], a, m}]));
    if (!halves) continue;
    for (const d of inPlane(a)) {
      keys.add(canonicalKey([{c: [0, 0, 0], a, m: 1 << d, k: 'H1'}]));
      for (const s of inPlane(a).filter(x => axisOf(x) !== axisOf(d))) keys.add(canonicalKey([{c: [0, 0, 0], a, m: (1 << d) | (1 << opposite(d)), k: 'H', s}]));
    }
  }
  return [...keys].map(fromKey);
}

/**
 * All connected, overlap-free forms of 1..maxN discs, up to symmetry, level by level (every connected form has a
 * spanning tree, so adding one disc onto an open slit at a time reaches them all; extra joints form by geometry).
 * `onLevel` gets each level's canonical keys and how long the level took to find. Stops when a level would pass
 * `cap` forms and says so.
 */
export function enumerate(kit: Kit, maxN: number, onLevel: (n: number, keys: string[], ms: number) => void, cap = 2_000_000, halves = true): {complete: boolean; stoppedAt?: number} {
  let t0 = performance.now(), level = new Set(singleDiscs(halves).map(f => canonicalKey(f)));
  for (let n = 1; n <= maxN; n++) {
    onLevel(n, [...level], performance.now() - t0);
    if (n === maxN) break;
    t0 = performance.now();
    const next = new Set<string>();
    for (const key of level) {
      const form = fromKey(key);
      for (const [i, d] of form.openSlits()) for (const p of posesOnto(form.discs[i], d, halves)) if (form.fits(kit, p)) next.add(canonicalKey(form.with(p)));
      if (next.size > cap) return {complete: false, stoppedAt: n + 1};
    }
    level = next;
  }
  return {complete: true};
}
