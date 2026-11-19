// Thin and flat shapes: turn each named part into a frame by its proportions, then fuse touching ends.
import {band, DEFAULT_HUB, type HubParams} from './params';
import {mergeClose, type Edge, type StickGraph} from './graph';
import type {Part} from './shapes';
import {lerp, type V3} from './vec';

export type PartKind = 'rod' | 'plate' | 'block';

/** rod: one long dimension; plate: one thin dimension; block: neither. */
export function classify(part: Part): {kind: PartKind; axes: [number, number, number]} {
  const ext = [0, 1, 2].map(i => part.max[i] - part.min[i]);
  const [s, m, l] = [0, 1, 2].sort((a, b) => ext[a] - ext[b]) as [number, number, number];
  if (ext[m] < 0.35 * ext[l]) return {kind: 'rod', axes: [s, m, l]};
  if (ext[s] < 0.35 * ext[m]) return {kind: 'plate', axes: [s, m, l]};
  return {kind: 'block', axes: [s, m, l]};
}

export function partsGraph(parts: Part[], p: HubParams = DEFAULT_HUB): StickGraph {
  const {target, hi} = band(p);
  const nodes: V3[] = [], edges: Edge[] = [];
  const node = (v: V3) => nodes.push(v) - 1;
  const spans = (length: number) => Math.max(1, Math.round(length / target));
  const chain = (a: V3, b: V3) => {
    const n = spans(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    let prev = node(a);
    for (let i = 1; i <= n; i++) { const cur = node(lerp(a, b, i / n)); edges.push([prev, cur]); prev = cur; }
  };
  for (const part of parts) {
    const {kind, axes: [, m, l]} = classify(part);
    const mid = part.min.map((v, i) => (v + part.max[i]) / 2) as V3;
    if (kind === 'rod') {
      const a = [...mid] as V3, b = [...mid] as V3;
      a[l] = part.min[l]; b[l] = part.max[l];
      chain(a, b);
    } else if (kind === 'plate') {
      // Grid in the plate's mid-plane; add a diagonal per cell only when one stick can span it.
      const nu = spans(part.max[m] - part.min[m]), nv = spans(part.max[l] - part.min[l]);
      const id: number[][] = [];
      for (let i = 0; i <= nu; i++) {
        id.push([]);
        for (let j = 0; j <= nv; j++) {
          const v = [...mid] as V3;
          v[m] = part.min[m] + ((part.max[m] - part.min[m]) * i) / nu;
          v[l] = part.min[l] + ((part.max[l] - part.min[l]) * j) / nv;
          id[i].push(node(v));
        }
      }
      const cellDiag = Math.hypot((part.max[m] - part.min[m]) / nu, (part.max[l] - part.min[l]) / nv);
      for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
        if (i < nu) edges.push([id[i][j], id[i + 1][j]]);
        if (j < nv) edges.push([id[i][j], id[i][j + 1]]);
        if (i < nu && j < nv && cellDiag <= hi) edges.push((i + j) % 2 ? [id[i][j], id[i + 1][j + 1]] : [id[i + 1][j], id[i][j + 1]]);
      }
    } else {
      // Block: its twelve box edges as a cage.
      const corner = (x: number, y: number, z: number): V3 => [x ? part.max[0] : part.min[0], y ? part.max[1] : part.min[1], z ? part.max[2] : part.min[2]];
      for (const [a, b] of [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]])
        chain(corner(a & 1, (a >> 1) & 1, (a >> 2) & 1), corner(b & 1, (b >> 1) & 1, (b >> 2) & 1));
    }
  }
  return mergeClose({nodes, edges}, 0.3 * target);
}
