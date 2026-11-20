/**
 * Panel integrity after cutting.
 *
 * Connectivity: two convex pieces are joined when they share a boundary segment of positive length. Union-find
 * over that relation counts the parts a panel would fall into; more than one means a slit cut it through.
 *
 * Ligament: the narrowest strip of material left. From points along every boundary edge a ray is cast into the
 * material (to the left of the edge; material is always on the left of boundary loops) and the distance to the
 * next boundary is measured. The minimum is the thinnest bridge, e.g. between a slit's end and the opposite edge.
 *
 * Tips are not bridges. Near a sharp corner (where a notch meets a curved rim, say) a ray crosses the wedge a short
 * way from its point and finds a narrow width, but nothing hangs on that neck except the point itself. So a
 * crossing is skipped as a tip when, cut along it, the smaller side is both under TIP_AREA neck-widths squared of
 * material and under TIP_SHARE of the piece: a wedge sharper than about 2° could still count (such a point is
 * mostly lost to the laser's kerf anyway), and a thin arm sticking out more than about 8 widths is still caught.
 * Crossings between two different loops (around a hole) always count.
 */
import {cross2, dot2, sub2, type V2} from './math.js';
import type {Panel} from './panel.js';
import {boundaryLoops} from './poly2d.js';

export function components(pieces: V2[][], tol = 1e-4): number {
  const parent = pieces.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
    if (find(i) === find(j)) continue;
    if (shareEdge(pieces[i], pieces[j], tol)) parent[find(i)] = find(j);
  }
  return new Set(pieces.map((_, i) => find(i))).size;
}

function shareEdge(A: V2[], B: V2[], tol: number) {
  for (let i = 0; i < A.length; i++) {
    const a0 = A[i], a1 = A[(i + 1) % A.length], e = sub2(a1, a0), L = Math.hypot(e[0], e[1]);
    if (L < tol) continue;
    const d: V2 = [e[0] / L, e[1] / L];
    for (let j = 0; j < B.length; j++) {
      const b0 = B[j], b1 = B[(j + 1) % B.length];
      if (Math.abs(cross2(d, sub2(b0, a0))) > tol || Math.abs(cross2(d, sub2(b1, a0))) > tol) continue;
      const s0 = dot2(d, sub2(b0, a0)), s1 = dot2(d, sub2(b1, a0));
      if (Math.min(L, Math.max(s0, s1)) - Math.max(0, Math.min(s0, s1)) > tol * 10) return true;
    }
  }
  return false;
}

export interface Ligament {width: number; at: V2}

/** Below both of these, what lies beyond a narrow crossing is a tip, not something a bridge holds: neck-widths
 * squared of material, and share of the piece. */
export const TIP_AREA = 8, TIP_SHARE = 0.05;

const shoelace = (poly: V2[]) => poly.reduce((s, a, i) => s + cross2(a, poly[(i + 1) % poly.length]), 0) / 2;

export function minLigament(loops: V2[][]): Ligament {
  const segs = loops.flatMap((l, li) => l.map((a, i) => ({a, b: l[(i + 1) % l.length], li, i})));
  const areas = loops.map(l => Math.abs(shoelace(l)));
  // The first boundary a ray meets: distance, and which edge (loop and index) at which point.
  const hit = (o: V2, d: V2) => {
    let best = {t: Infinity, k: -1};
    segs.forEach(({a, b}, k) => {
      const e = sub2(b, a), den = cross2(d, e);
      if (Math.abs(den) < 1e-12) return;
      const ao = sub2(a, o), t = cross2(ao, e) / den, s = cross2(ao, d) / den;
      if (t > 1e-6 && s >= -1e-9 && s <= 1 + 1e-9 && t < best.t) best = {t, k};
    });
    return best;
  };
  // Cut a loop along the chord from o (on edge i) to h (on edge j): the area on the side reached going forward.
  const sideArea = (l: V2[], i: number, o: V2, j: number, h: V2) => {
    const path: V2[] = [o];
    for (let k = (i + 1) % l.length, n = 0; n < l.length; k = (k + 1) % l.length, n++) { path.push(l[k]); if (k === j) break; }
    path.push(h);
    return Math.abs(shoelace(path));
  };
  let best: Ligament = {width: Infinity, at: [0, 0]};
  for (const {a, b, li, i} of segs) {
    const e = sub2(b, a), L = Math.hypot(e[0], e[1]);
    if (L < 0.2) continue;
    const inward: V2 = [-e[1] / L, e[0] / L];
    for (const f of [0.2, 0.5, 0.8]) {
      const o: V2 = [a[0] + e[0] * f, a[1] + e[1] * f], {t: w, k} = hit(o, inward);
      if (!(w < best.width) || k < 0) continue;
      const to = segs[k];
      if (to.li === li && to.i !== i) {
        // Same loop: a tip, unless enough material lies on both sides of the crossing.
        const h: V2 = [o[0] + inward[0] * w, o[1] + inward[1] * w], A = sideArea(loops[li], i, o, to.i, h);
        const small = Math.min(A, areas[li] - A);
        if (small < TIP_AREA * w * w && small < TIP_SHARE * areas[li]) continue;
      }
      best = {width: w, at: [o[0] + inward[0] * w / 2, o[1] + inward[1] * w / 2]};
    }
  }
  return best;
}

export interface Integrity {parts: number; ligament: Ligament; loops: V2[][]}

export function integrity(p: Panel): Integrity {
  const loops = boundaryLoops(p.pieces);
  return {parts: components(p.pieces), ligament: minLigament(loops), loops};
}
