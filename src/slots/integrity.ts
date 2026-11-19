/**
 * Panel integrity after cutting.
 *
 * Connectivity: two convex pieces are joined when they share a boundary segment of positive length. Union-find
 * over that relation counts the parts a panel would fall into; more than one means a slit cut it through.
 *
 * Ligament: the narrowest strip of material left. From points along every boundary edge a ray is cast into the
 * material (to the left of the edge; material is always on the left of boundary loops) and the distance to the
 * next boundary is measured. The minimum is the thinnest bridge, e.g. between a slit's end and the opposite edge.
 */
import {cross2, dot2, sub2, type V2} from './math.js';
import type {Panel} from './panel.js';
import {boundaryLoops, rayHit} from './poly2d.js';

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

export function minLigament(loops: V2[][]): Ligament {
  const segs: [V2, V2][] = loops.flatMap(l => l.map((a, i) => [a, l[(i + 1) % l.length]] as [V2, V2]));
  let best: Ligament = {width: Infinity, at: [0, 0]};
  for (const [a, b] of segs) {
    const e = sub2(b, a), L = Math.hypot(e[0], e[1]);
    if (L < 0.2) continue;
    const inward: V2 = [-e[1] / L, e[0] / L];
    for (const f of [0.2, 0.5, 0.8]) {
      const o: V2 = [a[0] + e[0] * f, a[1] + e[1] * f];
      const w = rayHit(o, inward, segs, 1e-6);
      if (w < best.width) best = {width: w, at: [o[0] + inward[0] * w / 2, o[1] + inward[1] * w / 2]};
    }
  }
  return best;
}

export interface Integrity {parts: number; ligament: Ligament; loops: V2[][]}

export function integrity(p: Panel): Integrity {
  const loops = boundaryLoops(p.pieces);
  return {parts: components(p.pieces), ligament: minLigament(loops), loops};
}
