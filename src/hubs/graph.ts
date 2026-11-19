import {angle, dist, sub, type V3} from './vec';

export type Edge = [number, number];
export interface StickGraph { nodes: V3[]; edges: Edge[] }

export function neighbours(g: StickGraph) {
  const out: number[][] = g.nodes.map(() => []);
  g.edges.forEach(([a, b]) => { out[a].push(b); out[b].push(a); });
  return out;
}

/** Fuse nodes closer than `tol` (averaging their positions), then drop loops and duplicate edges. */
export function mergeClose(g: StickGraph, tol: number): StickGraph {
  const parent = g.nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < g.nodes.length; i++) for (let j = i + 1; j < g.nodes.length; j++)
    if (dist(g.nodes[i], g.nodes[j]) < tol) parent[find(i)] = find(j);
  const groups = new Map<number, number[]>();
  g.nodes.forEach((_, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), i]); });
  const index = new Map<number, number>(), nodes: V3[] = [];
  for (const [root, members] of groups) {
    index.set(root, nodes.length);
    const s = members.reduce<V3>((acc, m) => [acc[0] + g.nodes[m][0], acc[1] + g.nodes[m][1], acc[2] + g.nodes[m][2]], [0, 0, 0]);
    nodes.push([s[0] / members.length, s[1] / members.length, s[2] / members.length]);
  }
  return {nodes, edges: dedupe(g.edges.map(([a, b]) => [index.get(find(a))!, index.get(find(b))!] as Edge))};
}

export function dedupe(edges: Edge[]): Edge[] {
  const seen = new Set<string>(), out: Edge[] = [];
  for (const [a, b] of edges) {
    if (a === b) continue;
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    if (!seen.has(k)) { seen.add(k); out.push(a < b ? [a, b] : [b, a]); }
  }
  return out;
}

export function isConnected(g: StickGraph) {
  if (!g.nodes.length) return true;
  const nb = neighbours(g), seen = new Set([0]), stack = [0];
  while (stack.length) for (const n of nb[stack.pop()!]) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  return seen.size === g.nodes.length;
}

/** Smallest angle between any two sticks meeting at each hub (π for hubs with one stick). */
export function hubMinAngles(g: StickGraph) {
  const nb = neighbours(g);
  return g.nodes.map((p, i) => {
    let m = Math.PI;
    const dirs = nb[i].map(j => sub(g.nodes[j], p));
    for (let a = 0; a < dirs.length; a++) for (let b = a + 1; b < dirs.length; b++) m = Math.min(m, angle(dirs[a], dirs[b]));
    return m;
  });
}

/**
 * Build order: start at the lowest hub and add one stick at a time, always touching what is built.
 * Sticks that close a loop between two built hubs go first so triangles stiffen early;
 * otherwise the stick reaching the lowest new hub goes next.
 */
export function buildOrder(g: StickGraph): number[] {
  if (!g.edges.length) return [];
  const built = new Set<number>(), used = new Set<number>(), order: number[] = [];
  let start = 0;
  g.nodes.forEach((p, i) => { if (p[2] < g.nodes[start][2]) start = i; });
  built.add(start);
  while (order.length < g.edges.length) {
    let best = -1, bestKey = Infinity;
    g.edges.forEach(([a, b], e) => {
      if (used.has(e) || !(built.has(a) || built.has(b))) return;
      const closes = built.has(a) && built.has(b);
      const fresh = built.has(a) ? b : a;
      const key = closes ? -1 : g.nodes[fresh][2];
      if (key < bestKey) { bestKey = key; best = e; }
    });
    if (best < 0) break; // disconnected remainder; reported by validation
    used.add(best); order.push(best);
    built.add(g.edges[best][0]); built.add(g.edges[best][1]);
  }
  return order;
}
