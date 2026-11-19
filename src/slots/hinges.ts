/**
 * Slot joints as hinges.
 *
 * Two sheets pushed slit into slit cross along a line. Every contact at the joint (each slit's walls against the
 * other sheet's faces) lies within one sheet thickness of that line, so the joint resists turning about the line
 * only through a couple a few millimetres long: under load it is a hinge. It does resist every other relative
 * motion, through contacts spread along the slit. A design is rigid only if these hinges and the floor leave no
 * motion that raises or lowers anything.
 *
 * Linear mobility. Each piece i gets a twist (ω_i, v_i), v_i the velocity of its centroid c_i.
 *   crossing of a and b on the line through p along l:  ω_b − ω_a ∥ l, and p has no relative velocity (5 rows)
 *   floor contact x of piece i (friction, no slip):    v_i + ω_i × (x − c_i) = 0 (3 rows)
 * The null space holds the design's mechanism modes. A mode in which every piece only turns about vertical axes and
 * slides sideways (ω_x = ω_y = v_z = 0 for every piece) keeps every point at its height, so neither gravity nor a
 * load on top can drive it. Any other mode moves something up or down. If it moves the centre of mass, the design
 * sags under its own weight; if it moves a point a load rests on, it folds under that load; otherwise it balances
 * on its hinges and folds as soon as it is pushed.
 *
 * Crossings are found from the geometry, independent of how the design was grown: two pieces cross where their
 * mid-planes meet along a line that runs inside both outlines for more than a sheet thickness. Since they do not
 * overlap (checked elsewhere), they must pass through each other's slits there.
 */
import {add, cross, dot, norm, sub, type V2, type V3} from './math.js';
import {panelArea, panelCentroid, panelVertices, toLocal, type Frame, type Panel} from './panel.js';
import {convexHull} from './poly2d.js';

/** What the check needs of a piece; engine output panels qualify too. Kit outlines are convex, so the hull of the
 * material is the outline with its slit mouths bridged. */
export type HingePanel = Pick<Panel, 'frame' | 't' | 'pieces'>;

export interface Crossing {a: number; b: number; p: V3; l: V3; length: number}

const cross2 = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];

/** Parameter intervals of the line p + s·l (|l| = 1) that lie inside a panel's outline. */
function insideIntervals(f: Frame, outline: V2[], p: V3, l: V3): [number, number][] {
  const a = toLocal(f, p), b = toLocal(f, add(p, l));
  const q0: V2 = [a[0], a[1]], dq: V2 = [b[0] - a[0], b[1] - a[1]];
  const ss: number[] = [];
  for (let i = 0; i < outline.length; i++) {
    const u = outline[i], w = outline[(i + 1) % outline.length], e: V2 = [w[0] - u[0], w[1] - u[1]];
    const den = cross2(dq, e);
    if (Math.abs(den) < 1e-12) continue;
    const d: V2 = [u[0] - q0[0], u[1] - q0[1]], r = cross2(d, dq) / den;
    if (r >= 0 && r < 1) ss.push(cross2(d, e) / den);
  }
  ss.sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < ss.length; i += 2) out.push([ss[i], ss[i + 1]]);
  return out;
}

/** Every pair of pieces that pass through each other, with the line they cross on. */
export function crossings(panels: HingePanel[], skip: ReadonlySet<number> = new Set()): Crossing[] {
  const out: Crossing[] = [], hulls = panels.map(p => convexHull(p.pieces.flat()));
  for (let a = 0; a < panels.length; a++) for (let b = a + 1; b < panels.length; b++) {
    if (skip.has(a) || skip.has(b)) continue;
    const A = panels[a], B = panels[b], lv = cross(A.frame.n, B.frame.n), ll = Math.hypot(...lv);
    if (ll < 1e-6) continue;
    // A point on both mid-planes: p = (dA (nB × l) + dB (l × nA)) / |l|².
    const dA = dot(A.frame.n, A.frame.o), dB = dot(B.frame.n, B.frame.o), k = 1 / (ll * ll);
    const u = cross(B.frame.n, lv), v = cross(lv, A.frame.n);
    const p0: V3 = [(dA * u[0] + dB * v[0]) * k, (dA * u[1] + dB * v[1]) * k, (dA * u[2] + dB * v[2]) * k], l = norm(lv);
    const ia = insideIntervals(A.frame, hulls[a], p0, l), ib = insideIntervals(B.frame, hulls[b], p0, l);
    let length = 0, mid = 0;
    for (const [s0, s1] of ia) for (const [t0, t1] of ib) {
      const lo = Math.max(s0, t0), hi = Math.min(s1, t1);
      if (hi > lo) { if (hi - lo > length) mid = (lo + hi) / 2; length += hi - lo; }
    }
    if (length > Math.max(A.t, B.t)) out.push({a, b, p: add(p0, [l[0] * mid, l[1] * mid, l[2] * mid]), l, length});
  }
  return out;
}

/** Null space of a dense matrix (rows × n) by reduced row echelon form with partial pivoting. */
function nullSpace(rows: number[][], n: number, tol = 1e-9): number[][] {
  const A = rows.map(r => r.slice()), pivots: number[] = [];
  let r = 0;
  for (let c = 0; c < n && r < A.length; c++) {
    let best = r;
    for (let i = r + 1; i < A.length; i++) if (Math.abs(A[i][c]) > Math.abs(A[best][c])) best = i;
    if (Math.abs(A[best][c]) < tol) continue;
    [A[r], A[best]] = [A[best], A[r]];
    const pv = A[r][c];
    for (let j = c; j < n; j++) A[r][j] /= pv;
    for (let i = 0; i < A.length; i++) {
      const f = A[i][c];
      if (i !== r && f !== 0) for (let j = c; j < n; j++) A[i][j] -= f * A[r][j];
    }
    pivots.push(c);
    r++;
  }
  const isPivot = new Set(pivots);
  const out: number[][] = [];
  for (let fc = 0; fc < n; fc++) {
    if (isPivot.has(fc)) continue;
    const x = new Array<number>(n).fill(0);
    x[fc] = 1;
    pivots.forEach((pc, i) => { x[pc] = -A[i][fc]; });
    out.push(x);
  }
  return out;
}

export interface HingeReport {
  crossings: Crossing[];
  /** Pieces some mode moves up or down (empty when the design is braced). */
  swinging: number[];
  /** A mode lowers the centre of mass: the design sags under its own weight. */
  sags: boolean;
  /** A mode moves one of the `loadPoints` up or down: the design folds under a load resting there. */
  foldsUnderLoad: boolean;
}

/**
 * Mechanism modes of a design whose joints are hinges and whose floor contacts do not slip. `skip`: pieces left
 * out (a cover resting on top). `loadPoints`: where a load is applied, each on a piece, e.g. where a cover rests.
 */
export function hingeModes(panels: HingePanel[], skip: ReadonlySet<number> = new Set(), loadPoints: {piece: number; at: V3}[] = [], eps = 0.05): HingeReport {
  const idx = panels.map((_, i) => i).filter(i => !skip.has(i)), col = new Map(idx.map((i, k) => [i, k]));
  const n = 6 * idx.length, L = 100; // lengths in units of L keep rotations and velocities comparable
  const c = panels.map(p => panelCentroid(p));
  const rows: number[][] = [];
  // Velocity rows of point x on piece i, times sign, added into three rows: v_i + ω_i × r, r = (x − c_i) / L.
  const pointRows = (target: number[][], i: number, x: V3, sign: number) => {
    const k = 6 * col.get(i)!, r = sub(x, c[i]).map(q => q / L);
    // x: ω_y r_z − ω_z r_y + v_x ; y: ω_z r_x − ω_x r_z + v_y ; z: ω_x r_y − ω_y r_x + v_z
    target[0][k + 1] += sign * r[2]; target[0][k + 2] -= sign * r[1]; target[0][k + 3] += sign;
    target[1][k + 2] += sign * r[0]; target[1][k + 0] -= sign * r[2]; target[1][k + 4] += sign;
    target[2][k + 0] += sign * r[1]; target[2][k + 1] -= sign * r[0]; target[2][k + 5] += sign;
  };
  const blank = () => new Array<number>(n).fill(0);
  const cx = crossings(panels, skip);
  for (const {a, b, p, l} of cx) {
    const three = [blank(), blank(), blank()];
    pointRows(three, b, p, 1); pointRows(three, a, p, -1);
    rows.push(...three);
    // Relative rotation only about l: zero along two directions perpendicular to it.
    const e1 = norm(Math.abs(l[2]) < 0.9 ? cross(l, [0, 0, 1]) : cross(l, [1, 0, 0])), e2 = cross(l, e1);
    for (const e of [e1, e2]) {
      const row = blank(), ka = 6 * col.get(a)!, kb = 6 * col.get(b)!;
      for (let j = 0; j < 3; j++) { row[kb + j] += e[j]; row[ka + j] -= e[j]; }
      rows.push(row);
    }
  }
  const z0 = Math.min(...idx.flatMap(i => panelVertices(panels[i]).map(v => v[2])));
  for (const i of idx) {
    const seen = new Set<string>();
    for (const v of panelVertices(panels[i])) {
      if (v[2] > z0 + eps) continue;
      const key = v.map(q => q.toFixed(2)).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      const three = [blank(), blank(), blank()];
      pointRows(three, i, v, 1);
      rows.push(...three);
    }
  }
  const modes = nullSpace(rows, n);
  const mass = idx.map(i => panelArea(panels[i]) * panels[i].t), total = mass.reduce((s, m) => s + m, 0);
  const swinging = new Set<number>();
  let sags = false, foldsUnderLoad = false;
  for (const x of modes) {
    const big = Math.max(...x.map(Math.abs)) || 1, tol = 1e-6 * big;
    let work = 0;
    idx.forEach((i, k) => {
      const [wx, wy, , , , vz] = x.slice(6 * k, 6 * k + 6);
      if (Math.abs(wx) > tol || Math.abs(wy) > tol || Math.abs(vz) > tol) swinging.add(i);
      work += mass[k] * vz;
    });
    if (Math.abs(work) / total > tol) sags = true;
    for (const {piece, at} of loadPoints) {
      const k = col.get(piece);
      if (k === undefined) continue;
      const [wx, wy, , , , vz] = x.slice(6 * k, 6 * k + 6), r = sub(at, c[piece]).map(q => q / L);
      if (Math.abs(vz + wx * r[1] - wy * r[0]) > tol) foldsUnderLoad = true;
    }
  }
  return {crossings: cx, swinging: [...swinging].sort((a, b) => a - b), sags, foldsUnderLoad};
}
