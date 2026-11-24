/**
 * Structural fingerprints and novelty.
 *
 * A form's structure is its graph of joints. Each disc starts with a label from what it is in the structure: lying
 * flat or standing upright, which piece its joined slits make (spare slits ignored), and which way those joints run
 * (up, down or sideways). Two rounds of Weisfeiler–Lehman refinement then fold in each disc's joined neighbours and
 * theirs, so a label names a motif such as "upright T with a flat bridge on each side and a column below". The
 * fingerprint is the count of every label from all three rounds, hashed into a fixed vector and scaled to unit
 * length: forms built from the same motifs in the same proportions sit close, whatever their size, position, turn
 * or mirror image.
 *
 * Novelty is the mean distance from a fingerprint to its k nearest neighbours among the forms seen so far (Lehman
 * and Stanley's novelty search). Distance from an egg crate is the distance to the nearest egg-crate fingerprint.
 */
import {opposite, pieceOf, type Form, type Pose} from './lattice.js';

export const DIM = 128;
const WEIGHTS = [0.5, 1, 1.5];

/** FNV-1a, 32 bit. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

const dirClass = (d: number) => (d === 4 ? 'u' : d === 5 ? 'd' : 's');

/**
 * A piece's first label: flat or upright, the piece its joined slits make (a half disc is itself; an H also says
 * which way its material lies: below its straight edge as an apron, above it as a fin, or to the side), and which
 * way its joints run.
 */
export function labelFor(p: Pose, joinedMask: number): string {
  const dirs = [0, 1, 2, 3, 4, 5].filter(d => joinedMask & (1 << d));
  const piece = p.k === 'H' ? `H${dirClass(p.s!)}` : p.k === 'H1' ? 'H1' : pieceOf(p.a, joinedMask || p.m);
  return `${p.a === 2 ? 'F' : 'U'}${piece}${dirs.map(dirClass).sort().join('')}`;
}

export function baseLabels(form: Form): string[] {
  const joined = form.discs.map(() => 0);
  for (const {i, j, d} of form.joints()) { joined[i] |= 1 << d; joined[j] |= 1 << opposite(d); }
  return form.discs.map((p, i) => labelFor(p, joined[i]));
}

/** Every disc's labels after 0, 1 and 2 rounds of refinement. */
export function motifLabels(form: Form): string[][] {
  const n = form.size, nbrs: [number, string][][] = Array.from({length: n}, () => []);
  for (const {i, j, d} of form.joints()) { nbrs[i].push([j, dirClass(d)]); nbrs[j].push([i, dirClass(opposite(d))]); }
  const rounds = [baseLabels(form)];
  for (let k = 1; k < WEIGHTS.length; k++) {
    const prev = rounds[k - 1];
    rounds.push(prev.map((l, i) => `${hash(`${l}(${nbrs[i].map(([j, c]) => c + prev[j]).sort().join(',')})`).toString(36)}`));
  }
  return rounds;
}

export function fingerprint(form: Form): Float32Array {
  const v = new Float32Array(DIM);
  motifLabels(form).forEach((labels, k) => { for (const l of labels) v[hash(`${k}:${l}`) % DIM] += WEIGHTS[k]; });
  let s = 0;
  for (let i = 0; i < DIM; i++) s += v[i] * v[i];
  const inv = s > 0 ? 1 / Math.sqrt(s) : 0;
  for (let i = 0; i < DIM; i++) v[i] *= inv;
  return v;
}

export function distance(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < DIM; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

/** A growing set of fingerprints, with novelty (mean distance to the k nearest) and nearest distance. */
export class FingerprintSet {
  readonly items: Float32Array[] = [];
  constructor(readonly k = 15) {}
  add(v: Float32Array) { this.items.push(v); }
  get size() { return this.items.length; }
  /** Mean distance to the k nearest. `self`: v is in the set, so one exact match is not counted. */
  novelty(v: Float32Array, self = false): number {
    if (!this.items.length) return 1;
    const k = Math.min(this.k, this.items.length - (self ? 1 : 0));
    if (k <= 0) return 1;
    const best: number[] = [];
    let skipped = !self;
    for (const u of this.items) {
      const d = distance(v, u);
      if (!skipped && d < 1e-9) { skipped = true; continue; }
      if (best.length < k) { best.push(d); best.sort((x, y) => x - y); } else if (d < best[k - 1]) { best[k - 1] = d; best.sort((x, y) => x - y); }
    }
    return best.reduce((s, d) => s + d, 0) / best.length;
  }
  nearest(v: Float32Array): number {
    let m = Infinity;
    for (const u of this.items) m = Math.min(m, distance(v, u));
    return m;
  }
}

/** How far a form's structure is from the nearest egg crate, as a map bucket. */
export const CRATE_BUCKETS: [number, string][] = [[1e-6, 'egg crate'], [0.25, 'close'], [0.5, 'apart'], [0.8, 'far'], [Infinity, 'very far']];
/** The bucket for a distance; 'unmeasured' when no egg crates were given to measure from. */
export const crateBucket = (d: number) => (Number.isFinite(d) ? CRATE_BUCKETS.find(([hi]) => d < hi)![1] : 'unmeasured');
