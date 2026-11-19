/**
 * Pinwheel kit: identical regular polygons, each with one slit per edge set at the same position and angle
 * (rotationally symmetric, like the reference set). Two pieces join slit-to-slit at any dihedral angle the slit
 * width allows.
 *
 * Fit. Pieces of thickness t crossing at plane angle θ need a slit (t + t|cos θ|)/sin θ wide. With a fixed cut
 * width w and fit clearance c that holds for θ ∈ [2·atan(t/(w−c)), 180° − 2·atan(t/(w−c))].
 *
 * Joint = half-turn. Interlock slit k of P with slit k of an identical Q, overlapping 2ℓ along the slit line L.
 * Q is the image of P under the half-turn about the axis through the overlap's midpoint, perpendicular to L,
 * bisecting the two pieces' planes. For dihedral φ that axis has direction cos(φ/2)·d⊥ + sin(φ/2)·n.
 *
 * Chains. Pieces alternately joined through slit b then slit a are X₀, X₀H_B, X₀H_BH_A, … Two half-turns
 * compose to a screw motion S = H_B·H_A about the common perpendicular of their axes, turning 2γ and advancing
 * 2δ (γ = angle between the axes, δ = distance between them). In general that is a helix (Chasles). It closes
 * into a flat ring of 2N pieces exactly when δ = 0 and γ = π/N; the ring then has dihedral symmetry D_N.
 */
import {ConvexHull} from 'three/examples/jsm/math/ConvexHull.js';
import {Vector3} from 'three';
import {add, cross, dot, len, norm, scale, sub, type V2, type V3} from './math';
import {convexHull, convexOverlap, rayHit, signedArea} from './poly2d';
import {panelDepth} from './collide';
import {makePanel, type Frame} from './panel';

export interface KitParams {
  sides: number;
  /** Where a slit starts along its edge, 0–1. */
  slitAt: number;
  /** Slit direction, degrees from the edge's inward normal (the pinwheel twist). */
  slitAngle: number;
  /** Slit length as a fraction of the side. */
  slitLength: number;
  /** Cut width as a multiple of sheet thickness. */
  slitWidth: number;
}

export const DEFAULT_KIT: KitParams = {sides: 4, slitAt: 0.3, slitAngle: 30, slitLength: 0.26, slitWidth: 1.7};

export interface Module {side: number; outline: V2[]; slits: {e: V2; d: V2}[]; len: number; cuts: V2[][]}

export function makeModule(k: KitParams, side: number, t: number, clearance: number): Module {
  const n = k.sides, R = side / (2 * Math.sin(Math.PI / n)), ph = -Math.PI / 2 - Math.PI / n;
  const V = Array.from({length: n}, (_, i) => [R * Math.cos(ph + (2 * Math.PI * i) / n), R * Math.sin(ph + (2 * Math.PI * i) / n)] as V2);
  const ln = k.slitLength * side, w = k.slitWidth * t, b = (k.slitAngle * Math.PI) / 180;
  const slits = V.map((a, i) => {
    const c = V[(i + 1) % n], ex = c[0] - a[0], ey = c[1] - a[1], el = Math.hypot(ex, ey);
    const inx = -ey / el, iny = ex / el; // inward normal of a CCW edge
    const d: V2 = [inx * Math.cos(b) - iny * Math.sin(b), inx * Math.sin(b) + iny * Math.cos(b)];
    return {e: [a[0] + ex * k.slitAt, a[1] + ey * k.slitAt] as V2, d};
  });
  const cuts = slits.map(({e, d}) => {
    const p: V2 = [-d[1], d[0]], s0 = -2, s1 = ln + clearance / 2;
    const at = (s: number, q: number): V2 => [e[0] + d[0] * s + p[0] * q, e[1] + d[1] * s + p[1] * q];
    return [at(s0, -w / 2), at(s1, -w / 2), at(s1, w / 2), at(s0, w / 2)];
  });
  return {side, outline: V, slits, len: ln, cuts};
}

/** Why this kit cannot be cut, or null. */
export function moduleProblem(m: Module): string | null {
  const segs = m.outline.map((a, i) => [a, m.outline[(i + 1) % m.outline.length]] as [V2, V2]);
  for (const {e, d} of m.slits) {
    const chord = rayHit([e[0] + d[0] * 1e-3, e[1] + d[1] * 1e-3], d, segs, 0);
    if (chord < 2 * m.len + 2) return 'each slit needs material twice its length behind it along its line; shorten the slits or turn them less';
  }
  for (let i = 0; i < m.cuts.length; i++) for (let j = i + 1; j < m.cuts.length; j++) {
    if (convexOverlap(m.cuts[i], m.cuts[j], 0.5)) return 'neighbouring slits run into each other; shorten them or move them along the edge';
  }
  return null;
}

/** Plane angles (radians) a slit of width w admits for sheet t and clearance c. */
export function fitRange(t: number, w: number, c: number): [number, number] {
  const lo = 2 * Math.atan(t / Math.max(w - c, 1e-6));
  return [lo, Math.PI - lo];
}

export function fits(phi: number, range: [number, number]) {
  const f = ((phi % Math.PI) + Math.PI) % Math.PI;
  return f >= range[0] - 1e-9 && f <= range[1] + 1e-9;
}

/* ---------- rigid transforms ---------- */

export interface Xf {R: number[]; t: V3}
export const IDENTITY: Xf = {R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0]};
const mv = (R: number[], v: V3): V3 => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const mm = (A: number[], B: number[]) => Array.from({length: 9}, (_, k) => { const i = Math.floor(k / 3), j = k % 3; return A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; });
export const compose = (X: Xf, Y: Xf): Xf => ({R: mm(X.R, Y.R), t: add(mv(X.R, Y.t), X.t)});
export const apply = (X: Xf, p: V3): V3 => add(mv(X.R, p), X.t);
export const rotate = (X: Xf, v: V3): V3 => mv(X.R, v);

export function halfTurn(p: V3, c: V3): Xf {
  const R = [2 * c[0] * c[0] - 1, 2 * c[0] * c[1], 2 * c[0] * c[2], 2 * c[1] * c[0], 2 * c[1] * c[1] - 1, 2 * c[1] * c[2], 2 * c[2] * c[0], 2 * c[2] * c[1], 2 * c[2] * c[2] - 1];
  return {R, t: sub(p, mv(R, p))};
}

/** Rotation taking unit a onto unit b (Rodrigues). */
export function rotationBetween(a: V3, b: V3): number[] {
  const v = cross(a, b), s = len(v), c = dot(a, b);
  if (s < 1e-12) {
    if (c > 0) return [...IDENTITY.R];
    const p = Math.abs(a[0]) < 0.9 ? norm(cross(a, [1, 0, 0])) : norm(cross(a, [0, 1, 0]));
    return halfTurn([0, 0, 0], p).R;
  }
  const k = scale(v, 1 / s), K = [0, -k[2], k[1], k[2], 0, -k[0], -k[1], k[0], 0], K2 = mm(K, K);
  return IDENTITY.R.map((x, i) => x + s * K[i] + (1 - c) * K2[i]);
}

/** Half-turn axis of the joint at slit k for dihedral φ, in the piece's own coordinates (plane z = 0). */
export function jointAxis(m: Module, k: number, phi: number) {
  const {e, d} = m.slits[k];
  const p: V3 = [e[0] + d[0] * m.len, e[1] + d[1] * m.len, 0];
  const c: V3 = [-d[1] * Math.cos(phi / 2), d[0] * Math.cos(phi / 2), Math.sin(phi / 2)];
  return {p, c};
}

/** Angle γ between two half-turn axes and their signed distance δ. S = H_B·H_A turns 2γ and advances 2δ. */
export function screwOf(m: Module, a: number, b: number, phiA: number, phiB: number) {
  const A = jointAxis(m, a, phiA), B = jointAxis(m, b, phiB), w = cross(A.c, B.c), s = len(w);
  const gamma = Math.acos(Math.min(1, Math.abs(dot(A.c, B.c))));
  const delta = s < 1e-12 ? NaN : dot(sub(B.p, A.p), w) / s;
  return {A, B, gamma, delta, axis: s < 1e-12 ? null : scale(w, 1 / s)};
}

/** Piece placements along a chain that alternates slit b and slit a. Also the travel of each piece into place. */
export function chain(m: Module, a: number, b: number, phiA: number, phiB: number, count: number) {
  const HA = halfTurn(jointAxis(m, a, phiA).p, jointAxis(m, a, phiA).c), HB = halfTurn(jointAxis(m, b, phiB).p, jointAxis(m, b, phiB).c);
  const X: Xf[] = [IDENTITY], travel: (V3 | null)[] = [null];
  for (let j = 0; j + 1 < count; j++) {
    const viaB = j % 2 === 0, k = viaB ? b : a;
    X.push(compose(X[j], viaB ? HB : HA));
    // The new piece slides along the slit line, inward into the previous piece's slit.
    travel.push(rotate(X[j], [m.slits[k].d[0], m.slits[k].d[1], 0]));
  }
  return {X, travel};
}

export interface RingSolution {a: number; b: number; N: number; phiA: number; phiB: number}

/**
 * Every flat ring the kit closes: solve δ(φA, φB) = 0 and γ(φA, φB) = π/N by Newton's method from a grid of
 * starts, keeping only angles the slit width admits.
 */
export function ringSolutions(m: Module, range: [number, number], Nmax = 10): RingSolution[] {
  const n = m.slits.length, out: RingSolution[] = [];
  const angles: number[] = [];
  for (let x = 0; x < 2 * Math.PI; x += Math.PI / 72) if (fits(x, range) && Math.abs(Math.sin(x)) > 0.05) angles.push(x);
  for (let b = 1; b < n; b++) {
    const grid = angles.map(pa => angles.map(pb => screwOf(m, 0, b, pa, pb)));
    for (let N = 3; N <= Nmax; N++) {
      const target = Math.PI / N;
      const F = (pa: number, pb: number): [number, number] => { const s = screwOf(m, 0, b, pa, pb); return [s.delta / m.side, s.gamma - target]; };
      for (let i = 0; i < angles.length; i++) for (let j = 0; j < angles.length; j++) {
        const g = grid[i][j];
        if (!(Math.abs(g.delta) / m.side < 0.12 && Math.abs(g.gamma - target) < 0.08)) continue;
        let x = angles[i], y = angles[j], ok = false;
        for (let it = 0; it < 40; it++) {
          const f = F(x, y);
          if (!isFinite(f[0]) || !isFinite(f[1])) break;
          if (Math.abs(f[0]) < 1e-11 && Math.abs(f[1]) < 1e-11) { ok = true; break; }
          const h = 1e-6, fx = F(x + h, y), fy = F(x, y + h);
          const j11 = (fx[0] - f[0]) / h, j12 = (fy[0] - f[0]) / h, j21 = (fx[1] - f[1]) / h, j22 = (fy[1] - f[1]) / h, det = j11 * j22 - j12 * j21;
          if (Math.abs(det) < 1e-14) break;
          let dx = (j22 * f[0] - j12 * f[1]) / det, dy = (j11 * f[1] - j21 * f[0]) / det;
          const st = Math.hypot(dx, dy);
          if (st > 0.2) { dx *= 0.2 / st; dy *= 0.2 / st; }
          x -= dx; y -= dy;
        }
        if (!ok) continue;
        const pa = ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), pb = ((y % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        if (!fits(pa, range) || !fits(pb, range)) continue;
        if (out.some(s => s.b === b && s.N === N && Math.abs(s.phiA - pa) + Math.abs(s.phiB - pb) < 1e-4)) continue;
        out.push({a: 0, b, N, phiA: pa, phiB: pb});
      }
    }
  }
  return out;
}

export const frameOf = (F: Xf): Frame => ({o: F.t, u: rotate(F, [1, 0, 0]), v: rotate(F, [0, 1, 0]), n: rotate(F, [0, 0, 1])});

/** Pieces of a chain as panels, for collision tests. */
export function chainPanels(m: Module, X: Xf[], t: number) {
  return X.map((x, i) => makePanel(i, `Piece ${i + 1}`, 'module', m.outline, frameOf(x), t, m.cuts));
}

/** A closed ring is buildable only if no two of its pieces interpenetrate (neighbours meet only in their slits). */
export function ringClear(m: Module, s: RingSolution, t: number) {
  const P = chainPanels(m, chain(m, s.a, s.b, s.phiA, s.phiB, 2 * s.N).X, t);
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) if (panelDepth(P[i], P[j]) > 0) return false;
  return true;
}

/** Place a closed ring with its axis vertical, centred on the origin. */
export function ringPlacement(m: Module, s: RingSolution): Xf {
  const {A, B, axis} = screwOf(m, s.a, s.b, s.phiA, s.phiB);
  // Intersection of the two axes (least squares on pA + u·cA = pB + v·cB).
  const w0 = sub(A.p, B.p), aa = dot(A.c, A.c), bb = dot(A.c, B.c), cc = dot(B.c, B.c), dd = dot(A.c, w0), ee = dot(B.c, w0);
  const den = aa * cc - bb * bb, u = (bb * ee - cc * dd) / den;
  const X = add(A.p, scale(A.c, u));
  const R = rotationBetween(axis!, [0, 0, 1]);
  return {R, t: scale(mv(R, X), -1)};
}

/**
 * Rest a rigid object on the convex-hull face that tips last: the face its centre of mass projects into with
 * the largest atan(margin / height). Coplanar hull triangles are merged into one support polygon.
 */
/** Faces of the convex hull of a point set, coplanar triangles merged: outward normal n, plane n·x = c, and its points. */
export function hullFaces(points: V3[]): {n: V3; c: number; pts: V3[]}[] {
  const hull = new ConvexHull().setFromPoints(points.map(p => new Vector3(...p)));
  const groups: {n: V3; c: number; pts: V3[]}[] = [];
  for (const f of hull.faces) {
    const n: V3 = [f.normal.x, f.normal.y, f.normal.z];
    const pts: V3[] = [];
    let e = f.edge;
    do { const q = e.head().point; pts.push([q.x, q.y, q.z]); e = e.next; } while (e !== f.edge);
    const c = dot(n, pts[0]);
    const g = groups.find(x => dot(x.n, n) > 1 - 1e-7 && Math.abs(x.c - c) < 1e-4);
    if (g) g.pts.push(...pts); else groups.push({n, c, pts});
  }
  return groups;
}

export function restingPose(points: V3[], com: V3, upright?: {axis: V3; maxTiltDeg: number}): {R: number[]; tipDeg: number} {
  const groups = hullFaces(points);
  let best = {R: [...IDENTITY.R], tipDeg: -Infinity};
  for (const g of groups) {
    const h = g.c - dot(g.n, com);
    if (h <= 0) continue;
    // Standing a tower up: the face it rests on must have its outward normal near −axis.
    if (upright && Math.abs(dot(g.n, upright.axis)) < Math.cos((upright.maxTiltDeg * Math.PI) / 180)) continue;
    const R = rotationBetween(g.n, [0, 0, -1]);
    const flat = convexHull(g.pts.map(p => { const q = mv(R, p); return [q[0], q[1]] as V2; }));
    if (flat.length < 3 || signedArea(flat) < 1e-6) continue;
    const c2 = mv(R, com);
    let margin = Infinity;
    for (let i = 0; i < flat.length; i++) {
      const a = flat[i], b = flat[(i + 1) % flat.length], ex = b[0] - a[0], ey = b[1] - a[1];
      margin = Math.min(margin, (ex * (c2[1] - a[1]) - ey * (c2[0] - a[0])) / Math.hypot(ex, ey));
    }
    const tip = margin <= 0 ? -1 : (Math.atan2(margin, h) * 180) / Math.PI;
    if (tip > best.tipDeg) best = {R, tipDeg: tip};
  }
  return best;
}
