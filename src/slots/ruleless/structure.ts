/**
 * Structural fingerprints of free forms, from their contacts (atlas/structure.ts does the same from lattice joints).
 *
 * A piece starts labelled by what it is (kit piece, lying flat or upright, on the floor or not) and by each contact
 * it makes: its kind (lap, clip, rest), whether the contact runs up and down or sideways, and which side the piece
 * is on (gripping or gripped, above or below). Two rounds of Weisfeiler–Lehman refinement fold in neighbours, and
 * the label counts are hashed into a unit vector. Forms built from the same motifs in the same proportions sit close.
 */
import {pieceId, type Pose} from '../atlas/lattice.js';
import type {Contact} from './contacts.js';

export const DIM = 128;
const WEIGHTS = [0.5, 1, 1.5];

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Each piece's contacts with other pieces, as (neighbour, edge label). Floor and top are left out. */
export function edges(n: number, contacts: Contact[]): [number, string][][] {
  const out: [number, string][][] = Array.from({length: n}, () => []);
  for (const c of contacts) {
    if (c.b < 0 || c.a >= n || c.b >= n) continue;
    const vert = c.axis === 2 ? 'v' : 'h';
    if (c.kind === 'clip') {
      // The gripped piece is the one the slit walls push.
      const held = c.pushes.find(p => p.two)?.on ?? c.a, grip = held === c.a ? c.b : c.a;
      out[grip].push([held, `clip${vert}>`]); out[held].push([grip, `clip${vert}<`]);
    } else if (c.kind === 'rest') {
      const up = c.pushes.find(p => p.n[2] > 0.5)?.on;
      const above = up ?? c.b, below = above === c.a ? c.b : c.a;
      out[above].push([below, up === undefined ? 'leans' : 'rests-on']); out[below].push([above, up === undefined ? 'leans' : 'bears']);
    } else {
      out[c.a].push([c.b, `lap${vert}`]); out[c.b].push([c.a, `lap${vert}`]);
    }
  }
  return out;
}

export function freeLabels(form: Pose[], contacts: Contact[]): string[][] {
  const n = form.length, nb = edges(n, contacts);
  const floor = new Set(contacts.filter(c => c.b < 0).map(c => c.a));
  const base = form.map((p, i) => `${p.a === 2 ? 'F' : 'U'}${pieceId(p)}${floor.has(i) ? '_' : ''}(${nb[i].map(e => e[1]).sort().join(',')})`);
  const rounds = [base];
  for (let k = 1; k < WEIGHTS.length; k++) {
    const prev = rounds[k - 1];
    rounds.push(prev.map((l, i) => hash(`${l}[${nb[i].map(([j, e]) => e + prev[j]).sort().join(',')}]`).toString(36)));
  }
  return rounds;
}

export function freeFingerprint(form: Pose[], contacts: Contact[]): Float32Array {
  const v = new Float32Array(DIM);
  freeLabels(form, contacts).forEach((labels, k) => { for (const l of labels) v[hash(`${k}:${l}`) % DIM] += WEIGHTS[k]; });
  let s = 0;
  for (let i = 0; i < DIM; i++) s += v[i] * v[i];
  const inv = s > 0 ? 1 / Math.sqrt(s) : 0;
  for (let i = 0; i < DIM; i++) v[i] *= inv;
  return v;
}
