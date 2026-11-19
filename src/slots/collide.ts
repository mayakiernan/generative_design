/**
 * Collision engine: separating-axis test (SAT) on convex polyhedra.
 *
 * Every panel is a union of convex prisms (one per convex piece). Two convex polyhedra are disjoint iff some axis
 * separates their projections, and it suffices to try the face normals of each and the cross products of their
 * edge directions. The smallest overlap over those axes is the penetration depth (the minimum translation
 * distance). Unions collide iff some pair of pieces does.
 *
 * Motion: a convex piece P translated along w sweeps conv(P ∪ P+w). That hull is convex, its face normals lie in
 * {faces of P} ∪ {e × w : e an edge of P} and its edges in {edges of P} ∪ {w}, so the same test decides whether
 * a straight insertion path is clear. This is exact, not sampled.
 */
import {add, cross, dot, type V3} from './math';
import {toWorld, type Panel} from './panel';

export interface Solid {v: V3[]; f: V3[]; e: V3[]; lo: V3; hi: V3}

/** Overlaps up to this many mm count as touching, not colliding. */
export const TOUCH = 1e-3;

function box(v: V3[]): {lo: V3; hi: V3} {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const p of v) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  return {lo, hi};
}

export function prism(p: Panel, piece: [number, number][]): Solid {
  const {frame: fr, t} = p, h = t / 2, v: V3[] = [], f: V3[] = [fr.n], e: V3[] = [fr.n];
  for (const q of piece) v.push(toWorld(fr, q, -h), toWorld(fr, q, h));
  for (let i = 0; i < piece.length; i++) {
    const a = piece[i], b = piece[(i + 1) % piece.length], dx = b[0] - a[0], dy = b[1] - a[1];
    e.push(add([fr.u[0] * dx, fr.u[1] * dx, fr.u[2] * dx], [fr.v[0] * dy, fr.v[1] * dy, fr.v[2] * dy]));
    f.push(add([fr.u[0] * dy, fr.u[1] * dy, fr.u[2] * dy], [-fr.v[0] * dx, -fr.v[1] * dx, -fr.v[2] * dx]));
  }
  return {v, f, e, ...box(v)};
}

export function swept(s: Solid, w: V3): Solid {
  const v = s.v.concat(s.v.map(p => add(p, w)));
  return {v, f: s.f.concat(s.e.map(e => cross(e, w))), e: s.e.concat([w]), ...box(v)};
}

// Keyed on both the pieces and the frame object: cutting replaces pieces, moving a panel replaces its frame.
const solidCache = new WeakMap<Panel, {pieces: Panel['pieces']; frame: Panel['frame']; solids: Solid[]}>();
export function solids(p: Panel): Solid[] {
  const c = solidCache.get(p);
  if (c && c.pieces === p.pieces && c.frame === p.frame) return c.solids;
  const s = p.pieces.map(q => prism(p, q));
  solidCache.set(p, {pieces: p.pieces, frame: p.frame, solids: s});
  return s;
}

export function panelBox(p: Panel) {
  return box(solids(p).flatMap(s => [s.lo, s.hi]));
}

const boxesOverlap = (a: {lo: V3; hi: V3}, b: {lo: V3; hi: V3}, tol: number) =>
  a.lo[0] <= b.hi[0] + tol && b.lo[0] <= a.hi[0] + tol && a.lo[1] <= b.hi[1] + tol && b.lo[1] <= a.hi[1] + tol && a.lo[2] <= b.hi[2] + tol && b.lo[2] <= a.hi[2] + tol;

/**
 * Penetration depth of two convex solids (≤ 0 when separated). Stops as soon as some axis shows overlap ≤ stop,
 * returning that overlap, because the pair is then known not to collide.
 */
export function depth(a: Solid, b: Solid, stop = TOUCH): number {
  let best = Infinity;
  const test = (x: number, y: number, z: number) => {
    const l = Math.hypot(x, y, z);
    if (l < 1e-9) return true;
    x /= l; y /= l; z /= l;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of a.v) { const d = p[0] * x + p[1] * y + p[2] * z; if (d < a0) a0 = d; if (d > a1) a1 = d; }
    for (const p of b.v) { const d = p[0] * x + p[1] * y + p[2] * z; if (d < b0) b0 = d; if (d > b1) b1 = d; }
    const o = Math.min(a1, b1) - Math.max(a0, b0);
    if (o < best) best = o;
    return o > stop;
  };
  for (const n of a.f) if (!test(n[0], n[1], n[2])) return best;
  for (const n of b.f) if (!test(n[0], n[1], n[2])) return best;
  for (const e of a.e) for (const g of b.e) {
    if (!test(e[1] * g[2] - e[2] * g[1], e[2] * g[0] - e[0] * g[2], e[0] * g[1] - e[1] * g[0])) return best;
  }
  return best;
}

export interface Hit {a: number; b: number; depth: number}

/** Deepest piece-pair penetration between two panels, or 0 when they only touch or are apart. */
export function panelDepth(A: Panel, B: Panel, tol = TOUCH): number {
  if (!boxesOverlap(panelBox(A), panelBox(B), tol)) return 0;
  let worst = 0;
  for (const sa of solids(A)) for (const sb of solids(B)) {
    if (!boxesOverlap(sa, sb, tol)) continue;
    const d = depth(sa, sb, tol);
    if (d > tol && d > worst) worst = d;
  }
  return worst;
}

/** Every interfering pair in an assembly. */
export function collisions(panels: Panel[], tol = TOUCH): Hit[] {
  const hits: Hit[] = [];
  for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
    const d = panelDepth(panels[i], panels[j], tol);
    if (d > 0) hits.push({a: panels[i].id, b: panels[j].id, depth: d});
  }
  return hits;
}

/** Does moving panel P by w (a straight path from where it is) hit any of `others`? Returns the first blocker. */
export function pathBlocker(P: Panel, w: V3, others: Panel[], tol = TOUCH): number | null {
  const moving = solids(P).map(s => swept(s, w));
  const mbox = box(moving.flatMap(s => [s.lo, s.hi]));
  for (const Q of others) {
    if (!boxesOverlap(mbox, panelBox(Q), tol)) continue;
    for (const m of moving) for (const q of solids(Q)) {
      if (!boxesOverlap(m, q, tol)) continue;
      if (depth(m, q, tol) > tol) return Q.id;
    }
  }
  return null;
}

/** How far P must travel along unit d before its bounding box clears every other panel's. */
export function exitDistance(P: Panel, others: Panel[], d: V3) {
  if (!others.length) return 0;
  let pMin = Infinity, oMax = -Infinity;
  for (const s of solids(P)) for (const v of s.v) pMin = Math.min(pMin, dot(v, d));
  for (const Q of others) for (const s of solids(Q)) for (const v of s.v) oMax = Math.max(oMax, dot(v, d));
  return Math.max(0, oMax - pMin) + 1;
}
