/**
 * Planar polygon geometry for panel outlines.
 *
 * A panel's material is kept as a list of convex polygons that tile it exactly. Every cut (slit, slot, arch)
 * is a convex polygon C, and a convex piece P minus C splits into at most |C| convex pieces:
 *   P \ C = ⋃ₖ (P ∩ H₁ ∩ … ∩ Hₖ₋₁ ∩ H̄ₖ)
 * where Hᵢ is the inner half-plane of C's i-th edge and H̄ₖ its complement. So the material stays an exact
 * convex partition through any number of cuts, which is what the 3D separating-axis test needs.
 */
import {cross2, dot2, len2, sub2, type V2} from './math.js';

export const TOL = 1e-7;

export function signedArea(p: V2[]) {
  let s = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return s / 2;
}

export function centroid(p: V2[]): V2 {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const c = p[j][0] * p[i][1] - p[i][0] * p[j][1];
    a += c; cx += (p[j][0] + p[i][0]) * c; cy += (p[j][1] + p[i][1]) * c;
  }
  if (Math.abs(a) < 1e-12) {
    const n = p.length || 1;
    return [p.reduce((s, q) => s + q[0], 0) / n, p.reduce((s, q) => s + q[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export const ccw = (p: V2[]): V2[] => (signedArea(p) < 0 ? [...p].reverse() : p);

export const perimeter = (p: V2[]) => p.reduce((s, a, i) => s + len2(sub2(p[(i + 1) % p.length], a)), 0);

/** Drop repeated and collinear vertices. */
export function clean(p: V2[], eps = 1e-6): V2[] {
  let q = p.filter((v, i) => len2(sub2(v, p[(i + 1) % p.length])) > eps);
  let changed = true;
  while (changed && q.length > 3) {
    changed = false;
    for (let i = 0; i < q.length; i++) {
      const a = q[(i + q.length - 1) % q.length], b = q[i], c = q[(i + 1) % q.length];
      const ab = sub2(b, a), bc = sub2(c, b);
      if (Math.abs(cross2(ab, bc)) <= eps * Math.max(len2(ab), len2(bc), 1) && dot2(ab, bc) > 0) {
        q = q.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return q;
}

export function isConvex(p: V2[]) {
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length];
    if (cross2(sub2(b, a), sub2(c, b)) < -1e-9) return false;
  }
  return true;
}

/** Sutherland–Hodgman against one half-plane: keep points with n·x ≤ c. */
export function clipHalfPlane(p: V2[], n: V2, c: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const da = dot2(n, a) - c, db = dot2(n, b) - c;
    if (da <= TOL) out.push(a);
    if ((da < -TOL && db > TOL) || (da > TOL && db < -TOL)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out.length >= 3 ? clean(out, 1e-7) : [];
}

/** Outward normal and offset of each CCW edge: the polygon is {x : nᵢ·x ≤ cᵢ for all i}. */
export function halfPlanes(p: V2[]): {n: V2; c: number}[] {
  return p.map((a, i) => {
    const b = p[(i + 1) % p.length], e = sub2(b, a), l = len2(e) || 1;
    const n: V2 = [e[1] / l, -e[0] / l];
    return {n, c: dot2(n, a)};
  });
}

/** Do two convex polygons share interior (not just touch)? 2D separating-axis test. */
export function convexOverlap(a: V2[], b: V2[], tol = 1e-6) {
  for (const poly of [a, b]) {
    for (const {n} of halfPlanes(poly)) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const q of a) { const d = dot2(n, q); a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
      for (const q of b) { const d = dot2(n, q); b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
      if (Math.min(a1, b1) - Math.max(a0, b0) <= tol) return false;
    }
  }
  return true;
}

/** Convex P minus convex C, as convex pieces. */
export function convexMinus(P: V2[], C: V2[], minArea = 1e-6): V2[][] {
  if (!convexOverlap(P, C)) return [P];
  const out: V2[][] = [];
  let rest = P;
  for (const {n, c} of halfPlanes(C)) {
    const outside = clipHalfPlane(rest, [-n[0], -n[1]], -c);
    // Keep real pieces only. A cut line that nearly coincides with an existing edge leaves a sliver of zero
    // width (2·area/perimeter ≈ width), which would read as a fake hairline bridge and break adjacency.
    if (outside.length >= 3 && signedArea(outside) > minArea && (2 * signedArea(outside)) / perimeter(outside) > 1e-4) out.push(outside);
    rest = clipHalfPlane(rest, n, c);
    if (rest.length < 3) break;
  }
  return out;
}

/** Andrew's monotone chain. Counter-clockwise, collinear points removed. */
export function convexHull(pts: V2[]): V2[] {
  // Snap first: points that should share an x but differ by 1e-15 break the sort the chain relies on,
  // and then an end point of a collinear run gets dropped instead of a middle one.
  const snap = (x: number) => Math.round(x * 1e7) / 1e7;
  const seen = new Set<string>();
  const p = pts.map(q => [snap(q[0]), snap(q[1])] as V2).filter(q => { const k = `${q[0]},${q[1]}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const turn = (o: V2, a: V2, b: V2) => cross2(sub2(a, o), sub2(b, o));
  const lower: V2[] = [], upper: V2[] = [];
  for (const q of p) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-12) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-12) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * Smallest circle holding every point (Welzl's incremental form: the circle is fixed by two or three of the points).
 * Worst case cubic in the number of points, so pass a convex hull.
 */
export function enclosingCircle(pts: V2[]): {c: V2; r: number} {
  const dist = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const two = (a: V2, b: V2) => ({c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as V2, r: dist(a, b) / 2});
  const three = (a: V2, b: V2, q: V2) => {
    const d = 2 * (a[0] * (b[1] - q[1]) + b[0] * (q[1] - a[1]) + q[0] * (a[1] - b[1]));
    // Collinear: the circle on the two farthest apart.
    if (Math.abs(d) < 1e-12) return [two(a, b), two(a, q), two(b, q)].reduce((x, y) => (y.r > x.r ? y : x));
    const A = a[0] ** 2 + a[1] ** 2, B = b[0] ** 2 + b[1] ** 2, Q = q[0] ** 2 + q[1] ** 2;
    const c: V2 = [(A * (b[1] - q[1]) + B * (q[1] - a[1]) + Q * (a[1] - b[1])) / d, (A * (q[0] - b[0]) + B * (a[0] - q[0]) + Q * (b[0] - a[0])) / d];
    return {c, r: dist(c, a)};
  };
  const holds = (C: {c: V2; r: number}, p: V2) => dist(C.c, p) <= C.r + 1e-7;
  let C = {c: (pts[0] ?? [0, 0]) as V2, r: 0};
  for (let i = 1; i < pts.length; i++) {
    if (holds(C, pts[i])) continue;
    C = {c: pts[i], r: 0};
    for (let j = 0; j < i; j++) {
      if (holds(C, pts[j])) continue;
      C = two(pts[i], pts[j]);
      for (let k = 0; k < j; k++) if (!holds(C, pts[k])) C = three(pts[i], pts[j], pts[k]);
    }
  }
  return C;
}

/** Push every edge of a convex polygon outward by d (mitred). Used for fit clearance. */
export function offsetConvex(p: V2[], d: number): V2[] {
  if (d === 0 || p.length < 3) return p;
  const hp = halfPlanes(p).map(h => ({n: h.n, c: h.c + d}));
  const out: V2[] = [];
  for (let i = 0; i < hp.length; i++) {
    const a = hp[(i + hp.length - 1) % hp.length], b = hp[i];
    const det = cross2(a.n, b.n);
    if (Math.abs(det) < 1e-12) { out.push([p[i][0] + a.n[0] * d, p[i][1] + a.n[1] * d]); continue; }
    out.push([(a.c * b.n[1] - b.c * a.n[1]) / det, (a.n[0] * b.c - b.n[0] * a.c) / det]);
  }
  return out;
}

export function pointInPolygon(p: V2[], q: V2) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Ear clipping for a simple counter-clockwise polygon. Returns triangles as vertex indices. */
export function triangulate(p: V2[]): number[][] {
  const idx = p.map((_, i) => i), tris: number[][] = [];
  const inTri = (q: V2, a: V2, b: V2, c: V2) =>
    cross2(sub2(b, a), sub2(q, a)) > 1e-12 && cross2(sub2(c, b), sub2(q, b)) > 1e-12 && cross2(sub2(a, c), sub2(q, c)) > 1e-12;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length], i1 = idx[k], i2 = idx[(k + 1) % idx.length];
      const a = p[i0], b = p[i1], c = p[i2];
      if (cross2(sub2(b, a), sub2(c, b)) <= 1e-12) continue;
      if (idx.some(j => j !== i0 && j !== i1 && j !== i2 && inTri(p[j], a, b, c))) continue;
      tris.push([i0, i1, i2]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // Degenerate input (collinear runs): drop the flattest vertex and carry on.
      let best = 0, bestArea = Infinity;
      for (let k = 0; k < idx.length; k++) {
        const a = p[idx[(k + idx.length - 1) % idx.length]], b = p[idx[k]], c = p[idx[(k + 1) % idx.length]];
        const ar = Math.abs(cross2(sub2(b, a), sub2(c, b)));
        if (ar < bestArea) { bestArea = ar; best = k; }
      }
      idx.splice(best, 1);
    }
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

/** Hertel–Mehlhorn: merge ear-clipped triangles across diagonals while the union stays convex. */
export function convexDecompose(poly: V2[]): V2[][] {
  const p = clean(ccw(poly));
  if (isConvex(p)) return [p];
  let parts = triangulate(p);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++) {
        const A = parts[i], B = parts[j];
        for (let x = 0; x < A.length; x++) {
          const a = A[x], b = A[(x + 1) % A.length];
          const y = B.findIndex((v, k) => v === b && B[(k + 1) % B.length] === a);
          if (y < 0) continue;
          // Walk A from b round to a, then B from a round to b, skipping the shared diagonal.
          const startA = (x + 1) % A.length, pathA = A.slice(startA).concat(A.slice(0, startA));
          const startB = (y + 1) % B.length, pathB = B.slice(startB).concat(B.slice(0, startB));
          const union = pathA.concat(pathB.slice(1, -1));
          if (isConvex(union.map(k => p[k]))) {
            parts = parts.filter((_, k) => k !== i && k !== j).concat([union]);
            merged = true;
            break outer;
          }
        }
      }
    }
  }
  return parts.map(t => clean(t.map(k => p[k]), 1e-9)).filter(q => q.length >= 3 && signedArea(q) > 1e-6);
}

/**
 * Drop vertices of a convex polygon that sit within tol of the chord between their neighbours. Sections of swept
 * hulls carry hairline chamfers (from the slab skin); left in, every one becomes another cut line.
 */
export function simplifyConvex(p: V2[], tol = 2e-4): V2[] {
  let q = p;
  for (let changed = true; changed && q.length > 3;) {
    changed = false;
    for (let i = 0; i < q.length && q.length > 3; i++) {
      const a = q[(i + q.length - 1) % q.length], b = q[i], c = q[(i + 1) % q.length], e = sub2(c, a), l = len2(e);
      if (l < 1e-12 || Math.abs(cross2(e, sub2(b, a))) / l < tol) { q = q.filter((_, k) => k !== i); changed = true; }
    }
  }
  return q;
}

/** Nearest hit of a ray from o along d with a set of segments, ignoring hits closer than minT. */
export function rayHit(o: V2, d: V2, segs: [V2, V2][], minT = 1e-6) {
  let best = Infinity;
  for (const [a, b] of segs) {
    const e = sub2(b, a), den = cross2(d, e);
    if (Math.abs(den) < 1e-12) continue;
    const ao = sub2(a, o), t = cross2(ao, e) / den, s = cross2(ao, d) / den;
    if (t > minT && s >= -1e-9 && s <= 1 + 1e-9 && t < best) best = t;
  }
  return best;
}

/**
 * Boundary of a union of convex pieces that tile a region: split every edge at vertices lying on it,
 * cancel each edge against its reverse, then chain what is left. Outer loops come out counter-clockwise,
 * holes clockwise, and material is always on the left of an edge.
 */
export function boundaryLoops(pieces: V2[][], tol = 1e-4): V2[][] {
  const verts: V2[] = [];
  const key = (q: V2) => {
    for (let i = 0; i < verts.length; i++) if (Math.abs(verts[i][0] - q[0]) <= tol && Math.abs(verts[i][1] - q[1]) <= tol) return i;
    verts.push(q);
    return verts.length - 1;
  };
  const raw: [number, number][] = [];
  for (const p of pieces) for (let i = 0; i < p.length; i++) raw.push([key(p[i]), key(p[(i + 1) % p.length])]);
  const edges = new Map<string, [number, number]>();
  for (const [a, b] of raw) {
    if (a === b) continue;
    const A = verts[a], B = verts[b], e = sub2(B, A), l2 = dot2(e, e);
    const on: {t: number; k: number}[] = [];
    verts.forEach((q, k) => {
      if (k === a || k === b) return;
      const t = dot2(sub2(q, A), e) / l2;
      if (t <= 1e-9 || t >= 1 - 1e-9) return;
      const dist = Math.abs(cross2(e, sub2(q, A))) / Math.sqrt(l2);
      if (dist <= tol) on.push({t, k});
    });
    const chain = [a, ...on.sort((x, y) => x.t - y.t).map(o => o.k), b];
    for (let i = 0; i + 1 < chain.length; i++) {
      const u = chain[i], v = chain[i + 1];
      if (u === v) continue;
      const rev = `${v},${u}`;
      if (edges.has(rev)) edges.delete(rev);
      else edges.set(`${u},${v}`, [u, v]);
    }
  }
  const out = new Map<number, [number, number][]>();
  for (const e of edges.values()) (out.get(e[0]) ?? out.set(e[0], []).get(e[0])!).push(e);
  const used = new Set<string>(), loops: V2[][] = [];
  for (const start of edges.values()) {
    if (used.has(`${start[0]},${start[1]}`)) continue;
    const loop: number[] = [];
    let cur = start, guard = 0;
    while (guard++ < 100000) {
      used.add(`${cur[0]},${cur[1]}`);
      loop.push(cur[0]);
      const options = (out.get(cur[1]) ?? []).filter(e => !used.has(`${e[0]},${e[1]}`));
      if (!options.length) break;
      // At a pinch point take the sharpest left turn so each loop stays on one face.
      const din = sub2(verts[cur[1]], verts[cur[0]]);
      options.sort((x, y) => turnAngle(din, sub2(verts[y[1]], verts[y[0]])) - turnAngle(din, sub2(verts[x[1]], verts[x[0]])));
      cur = options[0];
    }
    if (loop.length >= 3) loops.push(clean(loop.map(k => verts[k]), 1e-9));
  }
  return loops.filter(l => l.length >= 3 && Math.abs(signedArea(l)) > 1e-6);
}

const turnAngle = (a: V2, b: V2) => Math.atan2(cross2(a, b), dot2(a, b));

/**
 * Part of a convex `subject` inside a convex CCW `clip`. A subject of one or two points (a touching vertex or a
 * thin edge seen end-on) is returned as whichever of its points lie inside.
 */
export function clipConvex(subject: V2[], clip: V2[], tol = 1e-6): V2[] {
  const hp = halfPlanes(clip);
  if (subject.length < 3) return subject.filter(q => hp.every(({n, c}) => dot2(n, q) <= c + tol));
  let out = subject;
  for (const {n, c} of hp) { out = clipHalfPlane(out, n, c + tol); if (out.length < 3) return []; }
  return out;
}
