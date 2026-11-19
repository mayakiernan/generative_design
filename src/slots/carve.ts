/**
 * Slit carving from insertion paths.
 *
 * Panels go in one at a time. Panel B travels in a straight line along unit m into its final pose. For each joint
 * declared between B and an earlier panel A, material is removed so that B's path is clear:
 *
 *   B's swept region (world):            S_B = ⋃_{τ∈[0,D]} (B − τ·m)
 *   A's swept region seen from B:         S_A = ⋃_{τ∈[0,D]} (A + τ·m)
 *
 *   through : A loses S_B ∩ slab(A)        B passes clean through a channel in A
 *   moving  : B loses S_A ∩ slab(B)        A's tab or edge passes through a slot in B (mortise)
 *   lap     : A loses S_B ∩ slab(A) on the side of the split plane B arrives from, then B loses S_A ∩ slab(B)
 *             for whatever A kept. With L ∥ m this is the half-lap: A slit from one edge, B from the other.
 *
 * Each piece is convex, so its sweep is the convex hull of the piece and its translate. The part of that hull
 * inside A's slab, projected onto A's plane, is the convex hull of: hull vertices inside the slab plus every
 * vertex-pair segment crossing a slab face. Projection of a convex polytope is the hull of its projected vertices,
 * so the cut is exact. Cuts are then grown by half the fit clearance on every side.
 *
 * Only declared joints are carved. Anything else in the way stays in the way, so the collision check and the
 * assembly planner report it rather than this step quietly eating a panel.
 */
import {add, dot, scale, sub, type V2, type V3} from './math.js';
import {solids} from './collide.js';
import {applyCut, toLocal, type CutKind, type Panel, type SlitType} from './panel.js';
import {convexHull, offsetConvex, signedArea, simplifyConvex} from './poly2d.js';

export type JointMode = 'lap' | 'through' | 'moving';

export interface JointSpec {
  a: number;
  b: number;
  mode: JointMode;
  slit: SlitType;
  /** For laps: a point on the split plane. The plane's normal is B's travel direction. */
  split?: V3;
}

export interface Step {panel: number; motion: V3 | null}

/** Slab faces are pulled in by this much so faces that only touch never generate a cut. */
const SKIN = 1e-4;

/** Section of conv(points) by the slab of panel T, projected to T's 2D coordinates. */
export function slabSection(T: Panel, points: V3[]): V2[] | null {
  const th = T.t / 2 - SKIN, f = T.frame;
  const loc = points.map(p => toLocal(f, p));
  let lo = Infinity, hi = -Infinity;
  for (const q of loc) { lo = Math.min(lo, q[2]); hi = Math.max(hi, q[2]); }
  if (hi < -th || lo > th) return null;
  const pts: V2[] = [];
  for (const q of loc) if (Math.abs(q[2]) <= th) pts.push([q[0], q[1]]);
  for (let i = 0; i < loc.length; i++) for (let j = i + 1; j < loc.length; j++) {
    const a = loc[i], b = loc[j];
    for (const h of [-th, th]) {
      if ((a[2] - h) * (b[2] - h) < 0) {
        const s = (h - a[2]) / (b[2] - a[2]);
        pts.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s]);
      }
    }
  }
  if (pts.length < 3) return null;
  const hull = simplifyConvex(convexHull(pts));
  return hull.length >= 3 && signedArea(hull) > 1e-4 ? hull : null;
}

/** Cut regions in T left by the sweep of every piece of `src` along w. */
function sweepCuts(T: Panel, src: Panel, w: V3): V2[][] {
  const out: V2[][] = [];
  for (const s of solids(src)) {
    const sec = slabSection(T, s.v.concat(s.v.map(p => add(p, w))));
    if (sec) out.push(sec);
  }
  return out;
}

function cutAll(T: Panel, regions: V2[][], kind: CutKind, joint: number, clearance: number) {
  for (const r of regions) applyCut(T, {poly: offsetConvex(r, clearance / 2), kind, joint});
}

/**
 * Carve every declared joint in insertion order. `reach` must exceed the assembly's size so sweeps start
 * outside it. Returns the joints that could not be carved as asked (a lap whose travel is normal to A).
 */
export function carve(panels: Panel[], order: Step[], joints: JointSpec[], clearance: number, reach: number): string[] {
  const byId = new Map(panels.map(p => [p.id, p]));
  const motion = new Map(order.map(s => [s.panel, s.motion]));
  const notes: string[] = [];
  for (const step of order) {
    if (!step.motion) continue;
    const m = step.motion;
    joints.forEach((j, ji) => {
      if (j.b !== step.panel) return;
      const A = byId.get(j.a)!, B = byId.get(j.b)!;
      if (!motion.has(j.a)) throw new Error(`Joint ${A.name}–${B.name}: ${A.name} is not in the assembly order.`);
      let mode = j.mode;
      // A lap needs travel inside A's plane; otherwise the split plane cannot cross A.
      const inPlane = Math.hypot(dot(m, A.frame.u), dot(m, A.frame.v));
      if (mode === 'lap' && inPlane < 0.2) { mode = 'through'; notes.push(`${A.name}–${B.name}: travel is across ${A.name}, cut as a through channel.`); }
      if (mode === 'through') {
        cutAll(A, sweepCuts(A, B, scale(m, -reach)), 'channel', ji, clearance);
      } else if (mode === 'moving') {
        cutAll(B, sweepCuts(B, A, scale(m, reach)), j.slit === 'tab' ? 'slot' : 'slit', ji, clearance);
      } else {
        const split = j.split!;
        // A keeps material on B's far side: points x with (x − split)·m > 0. Channel = the rest, in A's 2D coords.
        const nx = dot(A.frame.u, m), ny = dot(A.frame.v, m), c = dot(sub(split, A.frame.o), m);
        const keepOut = (poly: V2[]) => clipToHalf(poly, [nx, ny], c);
        const regions = sweepCuts(A, B, scale(m, -reach)).map(r => keepOut(offsetConvex(r, clearance / 2))).filter(r => r.length >= 3);
        for (const r of regions) applyCut(A, {poly: r, kind: 'slit', joint: ji});
        cutAll(B, sweepCuts(B, A, scale(m, reach)), 'slit', ji, clearance);
      }
    });
  }
  return notes;
}

/** Keep the part of a convex polygon with n·x ≤ c. */
function clipToHalf(p: V2[], n: V2, c: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const da = n[0] * a[0] + n[1] * a[1] - c, db = n[0] * b[0] + n[1] * b[1] - c;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out.length >= 3 && signedArea(out) > 1e-4 ? out : [];
}
