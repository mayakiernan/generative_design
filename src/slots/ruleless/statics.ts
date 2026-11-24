/**
 * Does a form stand? Static equilibrium of rigid pieces through their contacts, as a linear program.
 *
 * Each push (contacts.ts) becomes one or more force columns, each ≥ 0: a two-way wall gives +n and −n; a one-way
 * push with friction μ across directions t gives n ± μt (a pyramid inside the friction cone); without friction, n.
 * Every piece's forces and torques (about its centroid) must balance its weight and any load on it: six rows per
 * piece. A form holds if some set of contact forces does that (phase 1 of the simplex).
 *
 * Stance: weight plus a sideways push λ·(each weight), the same as tilting gravity by atan λ, in eight directions.
 * The largest λ that still balances in the worst direction measures both tipping and sliding (the floor and every
 * one-way contact have only friction against a sideways push). A table must take tan 8° (the gallery's tip limit).
 *
 * Optimistic where a form is statically indeterminate: the program shows that some set of forces balances, not that
 * real joints with clearance would settle into it.
 */
import {cross, scale, sub, type V3} from '../math.js';
import {panelArea, panelCentroid, type Panel} from '../panel.js';
import type {Contact} from './contacts.js';
import {Feasible} from './lp.js';

/** Lever arm unit, mm: keeps torque rows comparable with force rows. */
const L = 100;

export interface Load {on: number; at: V3; /** As a share of the pieces' total weight. */ weight: number}

export interface StaticsOptions {
  /** Friction between pieces (rests, slit bottoms against edges). */
  mu: number;
  /** Friction on the floor. */
  muFloor: number;
}
export const STATICS_DEFAULTS: StaticsOptions = {mu: 0.4, muFloor: 0.4};

interface Columns {cols: {f: V3; x: V3; on: number; by: number}[]}

function columns(contacts: Contact[], o: StaticsOptions): Columns {
  const cols: Columns['cols'] = [];
  for (const c of contacts) for (const p of c.pushes) {
    const mu = p.by < 0 ? o.muFloor : o.mu;
    if (p.two) { cols.push({f: p.n, x: p.x, on: p.on, by: p.by}, {f: scale(p.n, -1), x: p.x, on: p.on, by: p.by}); continue; }
    let ts = mu > 0 ? p.friction ?? [] : [];
    if (!ts.length) { cols.push({f: p.n, x: p.x, on: p.on, by: p.by}); continue; }
    // Across a plane, eight directions (an octagon inside the friction cone, at least 92% of μ every way).
    if (ts.length === 2) {
      const [a, b] = ts, r = Math.SQRT1_2;
      ts = [a, b, [(a[0] + b[0]) * r, (a[1] + b[1]) * r, (a[2] + b[2]) * r], [(a[0] - b[0]) * r, (a[1] - b[1]) * r, (a[2] - b[2]) * r]];
    }
    for (const t of ts) for (const s of [1, -1]) cols.push({f: [p.n[0] + s * mu * t[0], p.n[1] + s * mu * t[1], p.n[2] + s * mu * t[2]], x: p.x, on: p.on, by: p.by});
  }
  return {cols};
}

/** Weights (shares of the total) and centroids of the pieces. */
export function bodies(panels: Panel[]) {
  const m = panels.map(p => panelArea(p) * p.t), total = m.reduce((a, b) => a + b, 0) || 1;
  return {w: m.map(x => x / total), c: panels.map(panelCentroid)};
}

/** Equality rows (six per piece), one force column per contact direction: A x = b balances weight and loads. */
function system(panels: Panel[], contacts: Contact[], o: StaticsOptions, loads: Load[]) {
  const {w, c} = bodies(panels), n = panels.length, {cols} = columns(contacts, o);
  const nc = cols.length, A: Float64Array[] = Array.from({length: 6 * n}, () => new Float64Array(nc)), b = new Float64Array(6 * n);
  const put = (col: number, body: number, f: V3, x: V3, sign: number) => {
    const r = 6 * body, tq = cross(scale(sub(x, c[body]), 1 / L), f);
    for (let k = 0; k < 3; k++) { A[r + k][col] += sign * f[k]; A[r + 3 + k][col] += sign * tq[k]; }
  };
  cols.forEach((col, j) => { put(j, col.on, col.f, col.x, 1); if (col.by >= 0) put(j, col.by, col.f, col.x, -1); });
  const g: V3 = [0, 0, -1];
  for (let i = 0; i < n; i++) b[6 * i + 2] += w[i];
  for (const ld of loads) {
    const r = 6 * ld.on, tq = cross(scale(sub(ld.at, c[ld.on]), 1 / L), scale(g, ld.weight));
    for (let k = 0; k < 3; k++) { b[r + k] -= g[k] * ld.weight; b[r + 3 + k] -= tq[k]; }
  }
  return {A, b, nc};
}

/** Can the contacts hold every piece up under its own weight and the loads? */
export function holds(panels: Panel[], contacts: Contact[], o: StaticsOptions = STATICS_DEFAULTS, loads: Load[] = []): boolean {
  const {A, b, nc} = system(panels, contacts, o, loads);
  return nc > 0 && Feasible.find(A, b) !== null;
}

export const AZIMUTHS = 8;
export const sideDir = (k: number, n = AZIMUTHS): V3 => [Math.cos((2 * Math.PI * k) / n), Math.sin((2 * Math.PI * k) / n), 0];

/** Largest push over eight directions from a feasible start; stops once one falls below `need`. */
function weakest(f: Feasible, column: (dir: V3) => Float64Array, need: number, cap: number): {push: number; dir: number} {
  let push = Infinity, dir = -1;
  for (let k = 0; k < AZIMUTHS; k++) {
    const r = f.maxAlong(column(sideDir(k)), cap);
    const p = r.status === 'optimal' ? r.value : 0;
    if (p < push) { push = p; dir = k; }
    if (push < need) break;
  }
  return {push, dir};
}

/**
 * Tipping and sliding as one rigid whole: the pieces welded together, standing on their floor contacts, take a
 * sideways push λ·(each weight) — the same as tilting gravity by atan λ. Returns the weakest direction's largest
 * λ (capped), or −1 when it cannot stand at all.
 */
export function rigidStance(panels: Panel[], contacts: Contact[], o: StaticsOptions = STATICS_DEFAULTS, need = 0, cap = 1): {push: number; dir: number} {
  const {w, c} = bodies(panels), com: V3 = [0, 0, 0];
  for (let i = 0; i < panels.length; i++) for (let k = 0; k < 3; k++) com[k] += w[i] * c[i][k];
  const floor = contacts.filter(ct => ct.b < 0), {cols} = columns(floor, o);
  if (!cols.length) return {push: -1, dir: -1};
  const A = Array.from({length: 6}, () => new Float64Array(cols.length)), b = new Float64Array(6);
  cols.forEach((col, j) => {
    const tq = cross(scale(sub(col.x, com), 1 / L), col.f);
    for (let k = 0; k < 3; k++) { A[k][j] = col.f[k]; A[3 + k][j] = tq[k]; }
  });
  b[2] = 1;
  const f = Feasible.find(A, b);
  if (!f) return {push: -1, dir: -1};
  return weakest(f, dir => Float64Array.from([dir[0], dir[1], dir[2], 0, 0, 0]), need, cap);
}

/**
 * Pushing the top sideways: with the pieces' weight and the loads on, a horizontal force λ·(total weight) at the
 * top's centre, in eight directions. A frame whose joints let it rack (or whose top slides off) takes no push. A
 * piece that only swings on a hinge is not pushed, so it does not count. Returns whether the form holds at all
 * (λ = 0) and the weakest direction's largest λ (capped).
 */
export function topPush(panels: Panel[], contacts: Contact[], top: number, o: StaticsOptions = STATICS_DEFAULTS, loads: Load[] = [], need = 0, cap = 1): {holds: boolean; push: number; dir: number} {
  const {A, b, nc} = system(panels, contacts, o, loads);
  const f = nc > 0 ? Feasible.find(A, b) : null;
  if (!f) return {holds: false, push: -1, dir: -1};
  const total = 1 + loads.reduce((s, l) => s + l.weight, 0);
  const at = panels[top].frame.o, c = panelCentroid(panels[top]);
  const column = (dir: V3) => {
    const h = new Float64Array(6 * panels.length), r = 6 * top, F = scale(dir, total), tq = cross(scale(sub(at, c), 1 / L), F);
    for (let k = 0; k < 3; k++) { h[r + k] = F[k]; h[r + 3 + k] = tq[k]; }
    return h;
  };
  return {holds: true, ...weakest(f, column, need, cap)};
}
