/**
 * Assembly planner. It does not trust the generator's order: it disassembles the finished assembly by testing
 * straight-line removals with the swept separating-axis test, then reverses that into a build sequence.
 *
 * Candidate directions for a panel: the reverse of its intended insertion (if any), ±x, ±y, ±z, ±its normal,
 * and ± the line where its plane meets each nearby panel's plane (the only direction a crossing slit allows).
 * Greedy single-part removal is sound (every removal found is collision-free) but not complete: if it gets stuck
 * that is reported as "no sequence found", not as proof that none exists.
 *
 * Closed loops of slit joints cannot be closed one piece at a time: the last piece would have to slide along two
 * different slit lines at once. They go together the way an egg crate does: a layer is built as a unit and lowered
 * so that all its joints with the layer below slide along the same line together. So when no single piece comes
 * out, the planner tries lifting the pieces above each height (whole, then each connected part) off as one rigid
 * unit along an axis, and plans that unit's own assembly separately.
 */
import {cross, dot, len, norm, scale, type V3} from './math.js';
import {exitDistance, panelBox, pathBlocker} from './collide.js';
import type {Panel} from './panel.js';

/** One move. `group`: pieces built off to one side as a unit and moved together (`panel` is the first of them). */
export interface BuildStep {panel: number; travel: V3; distance: number; group?: number[]}
export interface Plan {ok: boolean; steps: BuildStep[]; stuck: number[]; blockers: Record<number, number[]>}

const AXES: V3[] = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];

function near(a: Panel, b: Panel, pad: number) {
  const A = panelBox(a), B = panelBox(b);
  return [0, 1, 2].every(k => A.lo[k] <= B.hi[k] + pad && B.lo[k] <= A.hi[k] + pad);
}

function candidates(P: Panel, rest: Panel[], hint?: V3 | null): V3[] {
  const out: V3[] = [];
  const push = (d: V3) => { const u = norm(d); if (!out.some(o => dot(o, u) > 0.9999)) out.push(u); };
  if (hint) push(scale(hint, -1));
  for (const Q of rest) {
    if (!near(P, Q, 1)) continue;
    const l = cross(P.frame.n, Q.frame.n);
    if (len(l) > 1e-6) { push(l); push(scale(l, -1)); }
  }
  AXES.forEach(push);
  push(P.frame.n); push(scale(P.frame.n, -1));
  return out;
}

export function planAssembly(panels: Panel[], intended: Map<number, V3 | null> = new Map(), preferred: number[] = []): Plan {
  let rest = [...panels];
  const removal: BuildStep[] = [], blockers: Record<number, number[]> = {};
  const rank = (p: Panel) => { const i = preferred.indexOf(p.id); return i < 0 ? -1 : i; };
  while (rest.length) {
    // Try the parts that were meant to go in last first.
    const order = [...rest].sort((a, b) => rank(b) - rank(a));
    let done = false;
    for (const P of order) {
      const others = rest.filter(q => q !== P);
      if (!others.length) { removal.push({panel: P.id, travel: [0, 0, -1], distance: 0}); rest = []; done = true; break; }
      const hit = new Set<number>();
      for (const d of candidates(P, others, intended.get(P.id))) {
        const dist = exitDistance(P, others, d);
        const b = pathBlocker(P, scale(d, dist), others);
        if (b === null) {
          removal.push({panel: P.id, travel: scale(d, -1), distance: dist});
          rest = others;
          done = true;
          break;
        }
        hit.add(b);
      }
      if (done) break;
      blockers[P.id] = [...hit];
    }
    if (!done) {
      const unit = liftUnit(rest);
      if (unit) {
        const sub = planAssembly(unit.members, intended, preferred);
        if (sub.ok) {
          const ids = new Set(unit.members.map(p => p.id));
          // Reversed later: the unit's move comes after its own build steps.
          removal.push({panel: unit.members[0].id, travel: scale(unit.d, -1), distance: unit.distance, group: [...ids]}, ...[...sub.steps].reverse());
          rest = rest.filter(p => !ids.has(p.id));
          done = true;
        }
      }
    }
    if (!done) return {ok: false, steps: removal.reverse(), stuck: rest.map(p => p.id), blockers};
  }
  return {ok: true, steps: removal.reverse(), stuck: [], blockers};
}

/** Can `members` move together along d until clear of everything else? Returns the distance, or null. */
function unitClears(members: Panel[], others: Panel[], d: V3): number | null {
  const dist = Math.max(...members.map(P => exitDistance(P, others, d)));
  return members.every(P => pathBlocker(P, scale(d, dist), others) === null) ? dist : null;
}

/** Pieces grouped by touching boxes. */
function components(panels: Panel[]): Panel[][] {
  const out: Panel[][] = [], left = new Set(panels);
  while (left.size) {
    const first = left.values().next().value as Panel, comp = [first];
    left.delete(first);
    for (let i = 0; i < comp.length; i++) for (const q of [...left]) if (near(comp[i], q, 0.5)) { comp.push(q); left.delete(q); }
    out.push(comp);
  }
  return out;
}

/** The smallest unit above some height that lifts off as one along an axis (top layers first). */
function liftUnit(rest: Panel[]): {members: Panel[]; d: V3; distance: number} | null {
  const zOf = (p: Panel) => panelBox(p).lo[2] + panelBox(p).hi[2];
  const levels = [...new Set(rest.map(p => Math.round(zOf(p))))].sort((a, b) => b - a);
  for (const z of levels.slice(0, -1)) {
    const above = rest.filter(p => zOf(p) >= z - 1);
    // Levels within the 1 mm tolerance of the lowest can sweep in every piece; a unit that leaves nothing behind
    // is the same problem again, and planning it recursed until the stack ran out.
    if (above.length === rest.length) continue;
    const units = components(above).sort((a, b) => a.length - b.length);
    if (units.length > 1) units.push(above);
    for (const members of units) {
      const others = rest.filter(p => !members.includes(p));
      for (const d of AXES) {
        const distance = unitClears(members, others, d);
        if (distance !== null) return {members, d, distance};
      }
    }
  }
  return null;
}

/** Plain-language travel direction. */
export function describeTravel(d: V3) {
  if (dot(d, [0, 0, -1]) > 0.95) return 'drop in from above';
  if (dot(d, [0, 0, 1]) > 0.95) return 'push up from below';
  if (Math.abs(d[2]) < 0.05) {
    const a = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
    return `slide in horizontally (heading ${Math.round((a + 360) % 360)}°)`;
  }
  return d[2] < 0 ? `slide down at ${Math.round((Math.asin(-d[2]) * 180) / Math.PI)}°` : `slide up at ${Math.round((Math.asin(d[2]) * 180) / Math.PI)}°`;
}
