/**
 * Build sequences with groups.
 *
 * A slit joint goes together by sliding along its slit line, and a disc's slits all point different ways, so a
 * single disc slid in can make only one joint at a time: a loop can only be closed by a group of discs, built on
 * the bench, slid in along one axis so that every joint it makes with the rest runs along that axis (the
 * egg-crate method of grids.ts is one such group per layer).
 *
 * The search is two-handed. A form is buildable if it is one disc, or splits into two buildable parts A and B
 * such that every joint between them runs along one axis direction r (A on the +r side of its partner) and A,
 * slid along r, clears B entirely. Then B is built, A is built on the bench, and A slides in along −r. Whether a
 * set of discs can be built does not depend on anything else, so results are memoised per set.
 *
 * Candidate splits: single discs; each connected cluster of discs at or beyond a level along an axis (a layer and
 * everything above it, a row, a wing); and each jointed pair. Like the engine's planner this is sound, not
 * complete: "no sequence found" is not proof that none exists, and a search that hits its budget says so.
 */
import type {Panel} from '../panel.js';
import {DIRS, opposite, slideBlocked, type Form, type Kit} from './lattice.js';

export interface BuildStep {
  /** Discs placed in this step (one, or a group built on the bench first). */
  group: number[];
  /** Direction the disc or group travels into place (index into DIRS); −1 for the disc a build starts from. */
  travel: number;
  /** How the group is built on the bench, when it has more than one disc. */
  bench: BuildStep[];
}

export interface Assembly {
  /** A sequence was found; `steps` is exactly the sequence that was checked. */
  ok: boolean;
  steps: BuildStep[];
  /** The search stopped at its node budget before it could finish. */
  exhausted: boolean;
  nodes: number;
}

/** For each disc and direction, the discs it would hit sliding that way until it is clear of the whole form. */
export function blockerMasks(kit: Kit, form: Form): number[][] {
  const n = form.size;
  return form.discs.map((A, i) => DIRS.map((_, d) => {
    let mask = 0;
    for (let j = 0; j < n; j++) if (j !== i && slideBlocked(kit, A, form.discs[j], d)) mask |= 1 << j;
    return mask;
  }));
}

const members = (mask: number) => { const out: number[] = []; for (let i = 0; mask; i++, mask >>>= 1) if (mask & 1) out.push(i); return out; };
const popcount = (mask: number) => members(mask).length;

export function findAssembly(kit: Kit, form: Form, budget = 4000, blockers = blockerMasks(kit, form)): Assembly {
  const n = form.size;
  if (n > 30) throw new Error('assembly search handles at most 30 discs');
  const joints = form.joints();
  // into[a]: (partner b, direction r with c_a = c_b + DIRS[r]).
  const into: [number, number][][] = Array.from({length: n}, () => []);
  for (const {i, j, d} of joints) { into[j].push([i, d]); into[i].push([j, opposite(d)]); }
  const level = (i: number, r: number) => form.discs[i].c[0] * DIRS[r][0] + form.discs[i].c[1] * DIRS[r][1] + form.discs[i].c[2] * DIRS[r][2];

  const components = (mask: number): number[] => {
    const out: number[] = [];
    let left = mask;
    while (left) {
      const first = left & -left;
      let comp = first, todo = [members(first)[0]];
      while (todo.length) {
        const k = todo.pop()!;
        for (const [b] of into[k]) if (mask & (1 << b) && !(comp & (1 << b))) { comp |= 1 << b; todo.push(b); }
      }
      out.push(comp);
      left &= ~comp;
    }
    return out;
  };

  const memo = new Map<number, BuildStep[] | null>();
  let nodes = 0, exhausted = false;

  /** Can A (part of S) come off along r, leaving B = S \ A? */
  const splits = (A: number, B: number, r: number) => {
    let joined = false, hit = 0;
    for (const a of members(A)) {
      for (const [b, dir] of into[a]) if (B & (1 << b)) { if (dir !== r) return false; joined = true; }
      hit |= blockers[a][r];
    }
    return joined && !(hit & B);
  };

  const build = (S: number): BuildStep[] | null => {
    if (memo.has(S)) return memo.get(S)!;
    const ms = members(S);
    if (ms.length === 1) return [{group: ms, travel: -1, bench: []}];
    if (exhausted || ++nodes > budget) { exhausted = true; return null; }
    if (components(S).length > 1) { memo.set(S, null); return null; }
    const tried = new Set<string>(), cands: [number, number][] = [];
    const add = (A: number, r: number) => { const k = `${A}:${r}`; if (A && A !== S && !tried.has(k)) { tried.add(k); cands.push([A, r]); } };
    for (const g of ms) for (let r = 0; r < 6; r++) add(1 << g, r);
    for (let r = 0; r < 6; r++) {
      const levels = [...new Set(ms.map(i => level(i, r)))].sort((x, y) => x - y);
      for (const h of levels.slice(1)) for (const comp of components(ms.filter(i => level(i, r) >= h).reduce((m, i) => m | (1 << i), 0))) add(comp, r);
    }
    for (const {i, j} of joints) if (S & (1 << i) && S & (1 << j)) for (let r = 0; r < 6; r++) add((1 << i) | (1 << j), r);
    // Small groups first: they are cheap to check and most designs come apart a disc at a time.
    cands.sort((x, y) => popcount(x[0]) - popcount(y[0]));
    for (const [A, r] of cands) {
      const B = S & ~A;
      if (!splits(A, B, r)) continue;
      const base = build(B);
      if (!base) { if (exhausted) break; continue; }
      const bench = build(A);
      if (!bench) { if (exhausted) break; continue; }
      const out = [...base, {group: members(A), travel: opposite(r), bench: bench.length > 1 ? bench : []}];
      memo.set(S, out);
      return out;
    }
    if (!exhausted) memo.set(S, null);
    return null;
  };

  const all = n >= 31 ? 0 : (2 ** n) - 1;
  const steps = n ? build(all) : [];
  return {ok: !!steps, steps: steps ?? [], exhausted: !steps && exhausted, nodes};
}

/** Flatten a build into the order discs are placed, bench groups in place of their group step. */
export function placementOrder(steps: BuildStep[]): number[] {
  return steps.flatMap(s => (s.bench.length ? placementOrder(s.bench) : s.group));
}
