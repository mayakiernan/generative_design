/**
 * Build sequences for free forms: the lattice atlas's two-handed group search (atlas/assembly.ts), with blockers
 * from the real panels at any position and joins from the contacts.
 *
 * A form is buildable if it is one piece, or splits into two buildable parts A and B that touch, such that A slid
 * along an axis direction r clears B entirely. A then goes in along −r: a clip slides onto its edge, a stacked
 * piece is set down from above, a group whose slits line up slides on as one. Sound, not complete.
 */
import {pathBlocker} from '../collide.js';
import {dot, scale} from '../math.js';
import type {Panel} from '../panel.js';
import {DIRS, opposite, type Kit, type Pose} from '../atlas/lattice.js';
import type {BuildStep} from '../atlas/assembly.js';
import type {Contact} from './contacts.js';
import {STEP} from './free.js';

export type {BuildStep};
export interface FreeAssembly {ok: boolean; steps: BuildStep[]; exhausted: boolean; nodes: number}

const memo = new Map<string, boolean>();
const shape = (p: Pose) => `${p.a},${p.m},${p.k ?? ''},${p.s ?? ''}`;

/** Would piece i, slid along DIRS[r] until clear, hit piece j? Memoised on their relative placement. */
function blocked(kit: Kit, form: Pose[], panels: Panel[], i: number, j: number, r: number): boolean {
  const A = form[i], B = form[j], D = [0, 1, 2].map(k => (B.c[k] - A.c[k]) * STEP), reach = 2 * kit.R + 2 * kit.t + 1;
  const ax = r >> 1, s = DIRS[r][ax], ahead = D[ax] * s;
  if (ahead < -reach) return false;
  for (let k = 0; k < 3; k++) if (k !== ax && Math.abs(D[k]) > reach) return false;
  const key = `${kit.size},${kit.t},${kit.clearance}|${B.c.map((x, k) => x - A.c[k]).join(',')}|${shape(A)}|${shape(B)}|${r}`;
  let hit = memo.get(key);
  if (hit === undefined) {
    hit = pathBlocker(panels[i], scale(DIRS[r], Math.max(0, ahead) + reach + 1), [panels[j]]) !== null;
    if (memo.size > 2_000_000) memo.clear();
    memo.set(key, hit);
  }
  return hit;
}

const members = (mask: number) => { const out: number[] = []; for (let i = 0; mask; i++, mask >>>= 1) if (mask & 1) out.push(i); return out; };
const popcount = (mask: number) => members(mask).length;

export function findFreeAssembly(kit: Kit, form: Pose[], panels: Panel[], contacts: Contact[], budget = 4000): FreeAssembly {
  const n = form.length;
  if (n > 30) return {ok: false, steps: [], exhausted: true, nodes: 0};
  const touch: number[] = new Array(n).fill(0);
  for (const c of contacts) if (c.b >= 0 && c.a < n && c.b < n) { touch[c.a] |= 1 << c.b; touch[c.b] |= 1 << c.a; }
  const blockers: number[][] = Array.from({length: n}, (_, i) => DIRS.map((_, r) => {
    let m = 0;
    for (let j = 0; j < n; j++) if (j !== i && blocked(kit, form, panels, i, j, r)) m |= 1 << j;
    return m;
  }));
  const level = (i: number, r: number) => Math.round(dot(form[i].c.map(x => x * STEP) as [number, number, number], DIRS[r]) * 10) / 10;
  const components = (mask: number): number[] => {
    const out: number[] = [];
    let left = mask;
    while (left) {
      let comp = left & -left, grow = comp;
      while (grow) { let next = 0; for (const k of members(grow)) next |= touch[k] & mask & ~comp; comp |= next; grow = next; }
      out.push(comp);
      left &= ~comp;
    }
    return out;
  };
  const memoS = new Map<number, BuildStep[] | null>();
  let nodes = 0, exhausted = false;
  const splits = (A: number, B: number, r: number) => {
    let joined = false, hit = 0;
    for (const a of members(A)) { if (touch[a] & B) joined = true; hit |= blockers[a][r]; }
    return joined && !(hit & B);
  };
  const build = (S: number): BuildStep[] | null => {
    if (memoS.has(S)) return memoS.get(S)!;
    const ms = members(S);
    if (ms.length === 1) return [{group: ms, travel: -1, bench: []}];
    if (exhausted || ++nodes > budget) { exhausted = true; return null; }
    if (components(S).length > 1) { memoS.set(S, null); return null; }
    const tried = new Set<string>(), cands: [number, number][] = [];
    const add = (A: number, r: number) => { const k = `${A}:${r}`; if (A && A !== S && !tried.has(k)) { tried.add(k); cands.push([A, r]); } };
    for (const g of ms) for (let r = 0; r < 6; r++) add(1 << g, r);
    for (let r = 0; r < 6; r++) {
      const levels = [...new Set(ms.map(i => level(i, r)))].sort((x, y) => x - y);
      for (const h of levels.slice(1)) for (const comp of components(ms.filter(i => level(i, r) >= h - 1e-6).reduce((m, i) => m | (1 << i), 0))) add(comp, r);
    }
    for (const a of ms) for (const b of members(touch[a] & S)) if (b > a) for (let r = 0; r < 6; r++) add((1 << a) | (1 << b), r);
    cands.sort((x, y) => popcount(x[0]) - popcount(y[0]));
    for (const [A, r] of cands) {
      const B = S & ~A;
      if (!splits(A, B, r)) continue;
      const base = build(B);
      if (!base) { if (exhausted) break; continue; }
      const bench = build(A);
      if (!bench) { if (exhausted) break; continue; }
      const out = [...base, {group: members(A), travel: opposite(r), bench: bench.length > 1 ? bench : []}];
      memoS.set(S, out);
      return out;
    }
    if (!exhausted) memoS.set(S, null);
    return null;
  };
  const steps = n ? build(n >= 31 ? 0 : 2 ** n - 1) : [];
  return {ok: !!steps, steps: steps ?? [], exhausted: !steps && exhausted, nodes};
}
