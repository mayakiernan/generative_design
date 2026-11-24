/**
 * Contacts between pieces, found from the geometry alone (not from how a form was grown), as forces for the
 * statics check.
 *
 * Every contact is a set of pushes: a point, a direction, the piece pushed and the piece pushing back (or the floor).
 * A push is one-way (it can press, never pull), may carry friction across it, or is two-way with no friction.
 *
 * Two pieces in square planes meet along the line where their mid-planes cross. Along it each piece has material or
 * a gap (a slit, or beyond its rim). Where one piece's material passes through the other's slit, the slit's walls
 * hold it: a two-way, frictionless push square to the slit at each end of the gripped stretch. The walls lie
 * within a sheet thickness of the line, so they cannot stop a turn about it: the joint is a hinge, as in hinges.ts.
 * Where one piece's material meets the other's head-on along the line (a slit bottom against a slit bottom, a slit
 * bottom against a plain rim, a rim on a rim), the contact is one-way along the line, at the corners of the patch
 * where both pieces really touch. It gets friction only across directions the walls leave free.
 *
 *  - lap:  each piece passes through the other's slit (the kit's joint);
 *  - clip: only one piece passes through a slit, gripping a plain edge of the other;
 *  - rest: a piece rests on another's face, or rim to rim (stacking): one-way, with friction;
 *  - floor: corners on the lowest level: one-way up, with friction.
 *
 * A slit grips with clearance, so a wall never clamps: no friction is credited on walls, and a clip that only rests
 * on its slit bottom is as weak as its geometry. Slit bottoms of a seated joint sit up to a clearance apart and
 * still count as bearing (positions are on a 0.1 mm grid).
 */
import {add, dot, scale, type V2, type V3} from '../math.js';
import {toLocal, type Panel} from '../panel.js';
import {convexHull} from '../poly2d.js';
import {panelBox} from '../collide.js';

export type ContactKind = 'lap' | 'clip' | 'rest' | 'floor';

/** A force at x along n on piece `on`, and −n on `by` (−1: the floor). */
export interface Push {
  x: V3; n: V3; on: number; by: number;
  /** Two-way and frictionless (slit walls). */
  two?: boolean;
  /** Directions across n that friction can act along (both senses). */
  friction?: V3[];
}

export interface Contact {
  a: number;
  /** −1 for the floor. */
  b: number;
  kind: ContactKind;
  pushes: Push[];
  /** Axis of the crossing line (lap, clip) or of the push (rest, floor): 0 x, 1 y, 2 z. */
  axis: number;
  /** Length of slit gripping material (lap, clip), mm. */
  grip: number;
}

export interface ContactOptions {
  /** Gap along a crossing line still counted as bearing, mm. */
  lineGap: number;
  /** Gap between a face and a point still counted as touching, mm. */
  faceGap: number;
  /** Most pushes kept per group of same-direction contacts (their outline's corners). */
  maxPoints: number;
}
export const CONTACT_DEFAULTS: ContactOptions = {lineGap: 0.35, faceGap: 0.15, maxPoints: 6};

const AX: V3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const axisOfVec = (v: V3) => (Math.abs(v[0]) > 0.9 ? 0 : Math.abs(v[1]) > 0.9 ? 1 : Math.abs(v[2]) > 0.9 ? 2 : -1);
const cross2 = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0];

type Iv = [number, number];

/** Intervals of s where the line p + s·l (l along an axis in the panel's plane) runs through the panel's material,
 * and the interval inside the hull of its outline (slit mouths bridged). */
export function along(P: Panel, hull: V2[], p: V3, l: V3): {mat: Iv[]; hull: Iv | null} {
  const a = toLocal(P.frame, p), b = toLocal(P.frame, add(p, l)), q0: V2 = [a[0], a[1]], dq: V2 = [b[0] - a[0], b[1] - a[1]];
  const clipConvex = (poly: V2[]): Iv | null => {
    let lo = -Infinity, hi = Infinity;
    // CCW polygon: inside is to the left of every edge.
    for (let i = 0; i < poly.length; i++) {
      const u = poly[i], w = poly[(i + 1) % poly.length], e: V2 = [w[0] - u[0], w[1] - u[1]];
      // A line along an edge counts as inside: query lines often run exactly along the seams of the convex parts.
      const el = Math.hypot(e[0], e[1]) || 1, f0 = cross2(e, [q0[0] - u[0], q0[1] - u[1]]), f1 = cross2(e, dq);
      if (Math.abs(f1) < 1e-9 * el) { if (f0 < -1e-6 * el) return null; continue; }
      const s = -f0 / f1;
      if (f1 > 0) lo = Math.max(lo, s); else hi = Math.min(hi, s);
    }
    return hi > lo ? [lo, hi] : null;
  };
  const raw = P.pieces.map(clipConvex).filter((x): x is Iv => !!x).sort((x, y) => x[0] - y[0]);
  const mat: Iv[] = [];
  for (const iv of raw) {
    const last = mat[mat.length - 1];
    if (last && iv[0] <= last[1] + 1e-6) last[1] = Math.max(last[1], iv[1]); else mat.push([iv[0], iv[1]]);
  }
  return {mat, hull: clipConvex(hull)};
}

const hullCache = new WeakMap<Panel, V2[]>();
export function hullOf(P: Panel): V2[] {
  let h = hullCache.get(P);
  // The uncut outline: a slit's mouth, and a half disc's notch along its flat edge, are bridged by the outline itself.
  if (!h) { h = convexHull(P.outline.length ? P.outline : P.pieces.flat()); hullCache.set(P, h); }
  return h;
}

/** Is the local point inside the panel's material (within tol)? */
function inMaterial(P: Panel, q: V2, tol: number): boolean {
  return P.pieces.some(poly => poly.every((u, i) => {
    const w = poly[(i + 1) % poly.length], e: V2 = [w[0] - u[0], w[1] - u[1]], l = Math.hypot(e[0], e[1]) || 1;
    return cross2(e, [q[0] - u[0], q[1] - u[1]]) / l >= -tol;
  }));
}

const vertCache = new WeakMap<Panel, V3[]>();
function verts(P: Panel): V3[] {
  let vs = vertCache.get(P);
  if (!vs) {
    const seen = new Set<string>(), h = P.t / 2;
    vs = [];
    for (const q of P.pieces) for (const v of q) for (const s of [-h, h]) {
      const w = add(add(add(P.frame.o, scale(P.frame.u, v[0])), scale(P.frame.v, v[1])), scale(P.frame.n, s));
      const k = w.map(x => x.toFixed(3)).join(',');
      if (!seen.has(k)) { seen.add(k); vs.push(w); }
    }
    vertCache.set(P, vs);
  }
  return vs;
}

const boxGap = (A: Panel, B: Panel) => {
  const a = panelBox(A), b = panelBox(B);
  return Math.max(a.lo[0] - b.hi[0], b.lo[0] - a.hi[0], a.lo[1] - b.hi[1], b.lo[1] - a.hi[1], a.lo[2] - b.hi[2], b.lo[2] - a.hi[2]);
};

/** The two directions square to n (n along an axis). */
const across = (n: V3): V3[] => AX.filter(e => Math.abs(dot(e, n)) < 0.5);

/** Keep the corners of a group of same-direction pushes: their convex outline, thinned to at most k points. */
function corners(ps: Push[], k: number): Push[] {
  if (ps.length <= 3) return ps;
  const [e1, e2] = across(ps[0].n);
  const pts = ps.map(p => [dot(p.x, e1), dot(p.x, e2)] as V2), hull = convexHull(pts);
  const picked: Push[] = [];
  for (const h of hull) { const i = pts.findIndex(q => Math.abs(q[0] - h[0]) < 1e-6 && Math.abs(q[1] - h[1]) < 1e-6); if (i >= 0) picked.push(ps[i]); }
  if (picked.length <= k) return picked.length ? picked : ps.slice(0, k);
  return Array.from({length: k}, (_, i) => picked[Math.floor((i * picked.length) / k)]);
}

/** Merge pushes that share piece, partner, direction and kind, then thin each group to its corners. */
function thin(ps: Push[], k: number): Push[] {
  const groups = new Map<string, Push[]>();
  for (const p of ps) {
    const key = `${p.on}|${p.by}|${p.n.map(x => x.toFixed(3)).join(',')}|${p.two ? 2 : 1}|${(p.friction ?? []).length}`;
    const g = groups.get(key) ?? [];
    g.push(p);
    groups.set(key, g);
  }
  return [...groups.values()].flatMap(g => (g[0].two ? g : corners(g, k)));
}

/** The contact between two pieces whose planes are square: along their crossing line. */
function crossing(A: Panel, B: Panel, ia: number, ib: number, o: ContactOptions): Contact | null {
  const aA: number = axisOfVec(A.frame.n), aB: number = axisOfVec(B.frame.n);
  const k = 3 - aA - aB, l = AX[k], nA = AX[aA], nB = AX[aB];
  // Point on both mid-planes, at s = 0 on the l axis.
  const p0: V3 = [0, 0, 0];
  p0[aA] = A.frame.o[aA]; p0[aB] = B.frame.o[aB];
  const at = (s: number, off: V3 = [0, 0, 0]): V3 => add(add(p0, scale(l, s)), off);
  const LA = along(A, hullOf(A), p0, l), LB = along(B, hullOf(B), p0, l);
  if (!LA.hull || !LB.hull) return null;
  const lo = Math.max(LA.hull[0], LB.hull[0]), hi = Math.min(LA.hull[1], LB.hull[1]);
  const t = A.t, g = o.lineGap;
  const pushes: Push[] = [];
  // Which corners of a head-on patch at s really touch: X's material ends at s (from below if up) and Y's starts.
  const patch = (X: Panel, Y: Panel, nX: V3, nY: V3, s: number, up: boolean): V3[] => {
    const pts: V3[] = [];
    for (const dx of [-1, 1]) for (const dy of [-1, 1]) {
      // X's material along a line offset across its own plane (along nY), Y's along nX.
      const mx = along(X, hullOf(X), add(p0, scale(nY, (dy * t) / 2)), l).mat, my = along(Y, hullOf(Y), add(p0, scale(nX, (dx * t) / 2)), l).mat;
      const xEnd = up ? Math.max(-Infinity, ...mx.filter(iv => iv[0] < s + g).map(iv => iv[1])) : Math.min(Infinity, ...mx.filter(iv => iv[1] > s - g).map(iv => iv[0]));
      const yStart = up ? Math.min(Infinity, ...my.filter(iv => iv[1] > s - g).map(iv => iv[0])) : Math.max(-Infinity, ...my.filter(iv => iv[0] < s + g).map(iv => iv[1]));
      const gap = up ? yStart - xEnd : xEnd - yStart;
      if (gap > -0.05 && gap <= g && Math.abs(xEnd - s) <= g && Math.abs(yStart - s) <= g) pts.push(at(s, add(scale(nX, (dx * t) / 2), scale(nY, (dy * t) / 2))));
    }
    return pts;
  };

  if (hi - lo > g) {
    // Material of each piece inside the shared stretch.
    const inside = (mat: Iv[]) => mat.map(([s0, s1]) => [Math.max(s0, lo), Math.min(s1, hi)] as Iv).filter(([s0, s1]) => s1 - s0 > 0.3);
    const segA = inside(LA.mat), segB = inside(LB.mat);
    if (!segA.length && !segB.length) return null;
    let grip = 0;
    // Walls: B's slit holds A's material (pushes along ±nA), and A's slit holds B's.
    for (const [s0, s1] of segA) { grip += s1 - s0; for (const s of [s0, s1]) pushes.push({x: at(s), n: nA, on: ia, by: ib, two: true}); }
    for (const [s0, s1] of segB) { grip += s1 - s0; for (const s of [s0, s1]) pushes.push({x: at(s), n: nB, on: ib, by: ia, two: true}); }
    const free = [segA.length ? null : nA, segB.length ? null : nB].filter((v): v is V3 => !!v);
    const bear = (X: number, Y: number, s: number, dir: number) => {
      // Y pushes X along dir·l at s (X's material on the dir side).
      const PX = X === ia ? A : B, PY = Y === ia ? A : B, nX = X === ia ? nA : nB, nY = Y === ia ? nA : nB;
      let pts = patch(PY, PX, nY, nX, s, dir > 0);
      if (!pts.length) pts = [at(s)];
      for (const x of pts) pushes.push({x, n: scale(l, dir), on: X, by: Y, friction: free});
    };
    // Head-on contacts inside the stretch: one piece's material followed by the other's.
    const segs = [...segA.map(s => ({s, who: ia})), ...segB.map(s => ({s, who: ib}))].sort((x, y) => x.s[0] - y.s[0]);
    for (let i = 0; i + 1 < segs.length; i++) {
      const X = segs[i], Y = segs[i + 1];
      if (X.who !== Y.who && Y.s[0] - X.s[1] <= g) bear(Y.who, X.who, (X.s[1] + Y.s[0]) / 2, 1);
    }
    // At the ends of the stretch: material inside meets the other piece's material continuing outside.
    const first = segs[0], last = segs[segs.length - 1];
    const outside = (who: number, s: number, below: boolean) => (who === ia ? LA.mat : LB.mat).some(([s0, s1]) => (below ? s0 < s - 0.3 && s1 >= s - g : s1 > s + 0.3 && s0 <= s + g));
    if (first.s[0] - lo <= g) { const Y = first.who === ia ? ib : ia; if (outside(Y, lo, true)) bear(first.who, Y, lo, 1); }
    if (hi - last.s[1] <= g) { const Y = last.who === ia ? ib : ia; if (outside(Y, hi, false)) bear(last.who, Y, hi, -1); }
    return {a: ia, b: ib, kind: segA.length && segB.length ? 'lap' : 'clip', pushes, axis: k, grip};
  }
  // Rim on rim: the hulls meet end to end along the line.
  const endToEnd = (X: Panel, Y: Panel, ix: number, iy: number, LX: typeof LA, LY: typeof LB, nX: V3, nY: V3): Contact | null => {
    if (!LX.hull || !LY.hull || Math.abs(LY.hull[0] - LX.hull[1]) > g) return null;
    const xEnd = Math.max(...LX.mat.map(iv => iv[1])), yStart = Math.min(...LY.mat.map(iv => iv[0]));
    if (!(Math.abs(xEnd - LX.hull[1]) <= g && Math.abs(yStart - LY.hull[0]) <= g)) return null;
    const s = (xEnd + yStart) / 2;
    let pts = patch(X, Y, nX, nY, s, true);
    if (!pts.length) pts = [at(s)];
    // X (lower along l) pushes Y up the line.
    return {a: ix, b: iy, kind: 'rest', pushes: pts.map(x => ({x, n: l, on: iy, by: ix, friction: [nA, nB]})), axis: k, grip: 0};
  };
  return endToEnd(A, B, ia, ib, LA, LB, nA, nB) ?? endToEnd(B, A, ib, ia, LB, LA, nB, nA);
}

/** Points of one piece resting on the other's faces: one-way pushes along the face normal, with friction. */
function onFaces(A: Panel, B: Panel, ia: number, ib: number, o: ContactOptions): Push[] {
  const out: Push[] = [], h = A.t / 2;
  for (const v of verts(B)) {
    const [x, y, z] = toLocal(A.frame, v), d = Math.abs(z) - h;
    if (d < -0.02 || d > o.faceGap || !inMaterial(A, [x, y], 0.02)) continue;
    const n = scale(A.frame.n, z > 0 ? 1 : -1);
    out.push({x: v, n, on: ib, by: ia, friction: across(n)});
  }
  return out;
}

/**
 * Every contact in a set of panels (pieces in square planes; any extra panel, such as a top, rests by its faces).
 * The floor is the lowest level any panel reaches.
 */
export function findContacts(panels: Panel[], o: ContactOptions = CONTACT_DEFAULTS): Contact[] {
  const out: Contact[] = [], n = panels.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const A = panels[i], B = panels[j];
    if (boxGap(A, B) > o.faceGap + 0.01) continue;
    const square = Math.abs(dot(A.frame.n, B.frame.n)) < 1e-6;
    const c = square && axisOfVec(A.frame.n) >= 0 && axisOfVec(B.frame.n) >= 0 ? crossing(A, B, i, j, o) : null;
    if (c && c.kind !== 'rest') { out.push(c); continue; }
    const pushes = [...(c?.pushes ?? []), ...onFaces(A, B, i, j, o), ...onFaces(B, A, j, i, o)];
    if (!pushes.length) continue;
    const axis = axisOfVec(pushes[0].n);
    out.push({a: i, b: j, kind: 'rest', pushes: thin(pushes, o.maxPoints), axis, grip: 0});
  }
  const z0 = Math.min(...panels.map(p => panelBox(p).lo[2]));
  panels.forEach((P, i) => {
    const ps: Push[] = verts(P).filter(v => v[2] <= z0 + o.faceGap).map(x => ({x, n: [0, 0, 1] as V3, on: i, by: -1, friction: [[1, 0, 0], [0, 1, 0]] as V3[]}));
    if (ps.length) out.push({a: i, b: -1, kind: 'floor', pushes: thin(ps, o.maxPoints), axis: 2, grip: 0});
  });
  return out;
}

/** Pieces joined into one through contacts (the floor does not join anything). */
export function joinedParts(n: number, contacts: Contact[]): number[][] {
  const adj: number[][] = Array.from({length: n}, () => []);
  for (const c of contacts) if (c.b >= 0) { adj[c.a].push(c.b); adj[c.b].push(c.a); }
  const seen = new Array<boolean>(n).fill(false), parts: number[][] = [];
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const part = [s], todo = [s];
    seen[s] = true;
    while (todo.length) for (const k of adj[todo.pop()!]) if (!seen[k]) { seen[k] = true; part.push(k); todo.push(k); }
    parts.push(part);
  }
  return parts;
}
