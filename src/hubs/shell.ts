// Bulky shapes: place hubs evenly over the surface, then join hubs whose surface regions touch.
//
// 1. Farthest-point sampling picks V hub sites; it reaches tips and ends first, so they survive.
// 2. Lloyd iterations move each site to the middle of its geodesic region (a centroidal Voronoi
//    tessellation), which evens out the spacing.
// 3. Every dense triangle whose three corners belong to three different regions yields one
//    stick triangle. That dual is a triangulated shell, so it is rigid with pin joints.
// Size is free (a representation, not a scale model): the result is scaled so the mean stick
// span sits in the middle of the band one uncut stick can cover.
import {band, DEFAULT_HUB, stopFloor, type HubParams} from './params';
import type {TriMesh} from './shapes';
import {dedupe, type Edge, type StickGraph} from './graph';
import {add, angle, closestOnTriangle, dist, scale, sub, type V3} from './vec';

export type Tri = [number, number, number];
export interface ShellResult { graph: StickGraph; faces: Tri[] }

export function shellGraph(mesh: TriMesh, sticks: number, p: HubParams = DEFAULT_HUB, lloyd = 20): ShellResult {
  const verts: V3[] = [];
  for (let i = 0; i < mesh.positions.length; i += 3) verts.push([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]);
  const tris: Tri[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) tris.push([mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]]);
  const adj: [number, number][][] = verts.map(() => []);
  for (const [a, b] of dedupe(tris.flatMap(([a, b, c]) => [[a, b], [b, c], [c, a]] as Edge[]))) {
    const w = dist(verts[a], verts[b]);
    adj[a].push([b, w]); adj[b].push([a, w]);
  }

  // A closed triangulated shell with E sticks has V = (E + 6) / 3 hubs.
  const count = Math.max(4, Math.min(verts.length, Math.round((sticks + 6) / 3)));
  const c = verts.reduce<V3>((s, v) => [s[0] + v[0] / verts.length, s[1] + v[1] / verts.length, s[2] + v[2] / verts.length], [0, 0, 0]);
  let first = 0;
  verts.forEach((v, i) => { if (dist(v, c) > dist(verts[first], c)) first = i; });
  let sites = [first];
  let {d} = regions(adj, sites);
  while (sites.length < count) {
    let far = 0;
    d.forEach((x, i) => { if (x > d[far]) far = i; });
    sites.push(far);
    ({d} = regions(adj, sites));
  }

  for (let it = 0; it < lloyd; it++) {
    const {owner} = regions(adj, sites);
    sites = sites.map((s, k) => {
      const members = owner.flatMap((o, i) => (o === k ? [i] : []));
      if (!members.length) return s;
      const m = members.reduce<V3>((acc, i) => [acc[0] + verts[i][0], acc[1] + verts[i][1], acc[2] + verts[i][2]], [0, 0, 0]);
      const centroid = scale(m, 1 / members.length);
      return members.reduce((best, i) => (dist(verts[i], centroid) < dist(verts[best], centroid) ? i : best), members[0]);
    });
  }

  const {owner} = regions(adj, sites);
  const seen = new Set<string>(), faces: Tri[] = [];
  for (const [a, b, cc] of tris) {
    const t: Tri = [owner[a], owner[b], owner[cc]];
    if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2]) continue;
    const key = [...t].sort((x, y) => x - y).join(',');
    if (!seen.has(key)) { seen.add(key); faces.push(t); }
  }
  const edges = dedupe(faces.flatMap(([a, b, cc]) => [[a, b], [b, cc], [cc, a]] as Edge[]));
  const nodes = fitBand(sites.map(s => verts[s]), edges, tris.map(t => t.map(i => verts[i]) as [V3, V3, V3]), p);
  return {graph: {nodes, edges}, faces};
}

/**
 * Choose the overall scale that puts the most spans inside the uncut band, then nudge hubs
 * along the surface: only spans outside the band (with a 2 mm margin) pull or push.
 */
function fitBand(nodes: V3[], edges: Edge[], surface: [V3, V3, V3][], p: HubParams, iterations = 300): V3[] {
  // Spans at a typical hub use stop floors near 3 mm (60° neighbours), not the absolute minimum.
  const {hi} = band(p), lo = p.stickLength + 2 * stopFloor(Math.PI / 3, p);
  const [l0, l1] = [lo + 2, hi - 2];
  const spans = edges.map(([a, b]) => dist(nodes[a], nodes[b]));
  let k = 1, bestScore = -Infinity;
  for (const s of spans) for (const t of [l0, (l0 + l1) / 2, l1]) {
    const kk = t / s;
    const score = spans.filter(x => x * kk >= l0 && x * kk <= l1).length - 1e-3 * Math.abs(kk * spans.reduce((a, b) => a + b, 0) / spans.length - (l0 + l1) / 2);
    if (score > bestScore) { bestScore = score; k = kk; }
  }
  const pos = nodes.map(n => scale(n, k));
  const tri = surface.map(t => t.map(v => scale(v, k)) as [V3, V3, V3]);
  const project = (q: V3) => {
    let best = q, bd = Infinity;
    for (const [a, b, c] of tri) { const r = closestOnTriangle(q, a, b, c), d = dist(q, r); if (d < bd) { bd = d; best = r; } }
    return best;
  };
  const nb: number[][] = pos.map(() => []);
  edges.forEach(([a, b]) => { nb[a].push(b); nb[b].push(a); });
  // The exact lower bound per stick: each end's stop floor follows its nearest neighbouring stick.
  const floor = (hub: number, other: number) => {
    const d = sub(pos[other], pos[hub]);
    let theta = Math.PI;
    for (const o of nb[hub]) if (o !== other) theta = Math.min(theta, angle(d, sub(pos[o], pos[hub])));
    return stopFloor(theta, p);
  };
  for (let it = 0; it < iterations; it++) {
    const move: V3[] = pos.map(() => [0, 0, 0]);
    let worst = 0;
    for (const [a, b] of edges) {
      const d = sub(pos[b], pos[a]), l = Math.hypot(...d);
      const lower = Math.max(l0, p.stickLength + floor(a, b) + floor(b, a) + 1.5);
      const err = l < lower ? l - lower : l > l1 ? l - l1 : 0;
      worst = Math.max(worst, Math.abs(err));
      if (!err) continue;
      const step = scale(d, (0.25 * err) / l);
      move[a] = add(move[a], step); move[b] = sub(move[b], step);
    }
    if (!worst) break;
    pos.forEach((v, i) => (pos[i] = project(add(v, move[i]))));
  }
  return pos;
}

/** Multi-source Dijkstra over mesh edges: geodesic distance to, and index of, the nearest site. */
function regions(adj: [number, number][][], sites: number[]) {
  const d = new Float64Array(adj.length).fill(Infinity), owner = new Int32Array(adj.length).fill(-1);
  const heap: [number, number][] = [];
  const push = (x: [number, number]) => {
    heap.push(x);
    for (let i = heap.length - 1; i > 0;) { const pi = (i - 1) >> 1; if (heap[pi][0] <= heap[i][0]) break; [heap[pi], heap[i]] = [heap[i], heap[pi]]; i = pi; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  sites.forEach((s, k) => { d[s] = 0; owner[s] = k; push([0, s]); });
  while (heap.length) {
    const [du, u] = pop();
    if (du > d[u]) continue;
    for (const [v, w] of adj[u]) if (du + w < d[v]) { d[v] = du + w; owner[v] = owner[u]; push([d[v], v]); }
  }
  return {d: Array.from(d), owner: Array.from(owner)};
}
