/**
 * Static checks, rigid parts, no friction credited.
 *
 * Ground: the assembly rests on every vertex at the lowest height. Their convex hull is the support polygon.
 * The centre of mass must project inside it; about each hull edge the assembly tips once tilted by
 * atan(d / h), d = horizontal distance from the projected centre of mass to that edge, h = its height. The
 * smallest such angle is the tip angle, and tan(tip angle) is the sideways push (as a fraction of the weight,
 * applied at the centre of mass) that starts tipping.
 *
 * Parts: each panel is nudged along a set of directions with every other panel held fixed, using the swept
 * collision test. Directions that stay clear are its free motions:
 *   locked    no free motion
 *   seated    only motions that lift it (gravity holds it in)
 *   friction  it can slide sideways; only friction holds it
 *   loose     it can move downward; gravity pulls it out
 * This is a translational check. Snug slits also block rotation, which is not tested here.
 */
import {cross, dot, len, norm, scale, type V2, type V3} from './math';
import {panelBox, pathBlocker, solids} from './collide';
import {panelArea, panelCentroid, toLocal, type Panel} from './panel';
import {centroid, clipConvex, convexHull, pointInPolygon, signedArea} from './poly2d';

export type Hold = 'locked' | 'seated' | 'friction' | 'loose';

export interface Support {
  contacts: V2[];
  hull: V2[];
  com: V3;
  mass: number;
  /** Signed distance from the projected centre of mass to the support boundary (negative = outside). */
  margin: number;
  tipDeg: number;
  /** Hull edge index it tips over first. */
  tipEdge: number;
}

/** Plywood ≈ 0.6 g/cm³. Only ratios matter for stability; mass is reported for reference. */
export const DENSITY = 0.6e-3;

export function massProps(panels: Panel[]) {
  let m = 0;
  const c: V3 = [0, 0, 0];
  for (const p of panels) {
    const mi = panelArea(p) * p.t * DENSITY, ci = panelCentroid(p);
    m += mi; c[0] += ci[0] * mi; c[1] += ci[1] * mi; c[2] += ci[2] * mi;
  }
  return {mass: m, com: [c[0] / m, c[1] / m, c[2] / m] as V3};
}

export function minZ(panels: Panel[]) {
  return Math.min(...panels.map(p => panelBox(p).lo[2]));
}

/** Signed distance from q to a CCW convex polygon's boundary; positive inside. */
export function insideMargin(hull: V2[], q: V2) {
  if (hull.length < 3 || Math.abs(signedArea(hull)) < 1e-6) return {margin: -Infinity, edge: -1};
  let best = Infinity, edge = -1;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length], ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey);
    const d = (ex * (q[1] - a[1]) - ey * (q[0] - a[0])) / l;
    if (d < best) { best = d; edge = i; }
  }
  return {margin: best, edge};
}

export function groundSupport(panels: Panel[], eps = 0.05): Support {
  const z0 = minZ(panels), contacts: V2[] = [];
  for (const p of panels) for (const s of solids(p)) for (const v of s.v) if (v[2] <= z0 + eps) contacts.push([v[0], v[1]]);
  const hull = convexHull(contacts);
  const {mass, com} = massProps(panels);
  const {margin, edge} = insideMargin(hull, [com[0], com[1]]);
  const h = com[2] - z0;
  const tipDeg = margin <= 0 ? 0 : (Math.atan2(margin, h) * 180) / Math.PI;
  return {contacts: hull, hull, com, mass, margin, tipDeg, tipEdge: edge};
}

/** Directions to probe: axes, diagonals, the panel normal and every plane–plane line with a neighbour. */
function probeDirections(P: Panel, others: Panel[]): V3[] {
  const out: V3[] = [];
  const push = (d: V3) => { if (len(d) < 1e-9) return; const u = norm(d); if (!out.some(o => dot(o, u) > 0.999)) out.push(u); };
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) push([x, y, z]);
  push(P.frame.n); push(scale(P.frame.n, -1));
  for (const Q of others) {
    const l = cross(P.frame.n, Q.frame.n);
    if (len(l) > 1e-6) { push(l); push(scale(l, -1)); }
  }
  return out;
}

export function partHold(P: Panel, others: Panel[], groundZ: number, nudge: number): {hold: Hold; free: V3[]} {
  const near = others.filter(Q => {
    const A = panelBox(P), B = panelBox(Q);
    return [0, 1, 2].every(k => A.lo[k] <= B.hi[k] + nudge + 1 && B.lo[k] <= A.hi[k] + nudge + 1);
  });
  const onGround = panelBox(P).lo[2] <= groundZ + 0.05;
  const free: V3[] = [];
  for (const d of probeDirections(P, near)) {
    if (onGround && d[2] < -1e-6) continue; // the floor blocks it
    if (pathBlocker(P, scale(d, nudge), near) === null) free.push(d);
  }
  let hold: Hold = 'locked';
  if (free.some(d => d[2] < -0.2)) hold = 'loose';
  else if (free.some(d => Math.abs(d[2]) <= 0.2)) hold = 'friction';
  else if (free.length) hold = 'seated';
  return {hold, free};
}

/**
 * A part held only by resting on others (no slit or tab of its own) must have its centre of mass over the
 * hull of its contact points, or it tips off.
 */
/**
 * What touches the underside of P, in P's own 2D coordinates. For every convex piece of every other panel, the
 * points lying on P's underside plane form a contact patch (a thin rectangle where an upright piece's edge meets
 * it, a point or short segment where a rim does). Each patch is clipped to P's material, so an edge that runs
 * under P counts along its whole length under P, not only at its corners.
 */
export function underContacts(P: Panel, others: Panel[], eps = 0.05): V2[] {
  const under = -Math.sign(P.frame.n[2] || 1) * (P.t / 2), pts: V2[] = [];
  for (const Q of others) for (const s of solids(Q)) {
    const patch = s.v.map(v => toLocal(P.frame, v)).filter(q => Math.abs(q[2] - under) <= eps).map(q => [q[0], q[1]] as V2);
    if (!patch.length) continue;
    const hull = patch.length >= 3 ? convexHull(patch) : patch;
    for (const piece of P.pieces) pts.push(...clipConvex(hull.length >= 3 && signedArea(hull) > 1e-9 ? hull : hull.slice(0, 2), piece, eps));
  }
  return pts;
}

export function restingSupport(P: Panel, others: Panel[], eps = 0.05) {
  const local = underContacts(P, others, eps), hull = convexHull(local);
  const c = P.pieces.reduce((s, q) => { const a = signedArea(q), m = centroid(q); return [s[0] + m[0] * a, s[1] + m[1] * a, s[2] + a]; }, [0, 0, 0]);
  const {margin} = insideMargin(hull, [c[0] / c[2], c[1] / c[2]]);
  return {contacts: local.length, hull, margin};
}

function onBoundary(poly: V2[], q: V2, eps: number) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const e: V2 = [b[0] - a[0], b[1] - a[1]], l2 = e[0] * e[0] + e[1] * e[1];
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * e[0] + (q[1] - a[1]) * e[1]) / l2));
    if (Math.hypot(a[0] + e[0] * t - q[0], a[1] + e[1] * t - q[1]) <= eps) return true;
  }
  return false;
}

export const describeHold: Record<Hold, string> = {
  locked: 'locked: cannot move in any direction',
  seated: 'seated: only lifts out, gravity keeps it in',
  friction: 'friction-held: can slide sideways',
  loose: 'loose: gravity can pull it out',
};

