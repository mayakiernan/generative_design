// Graph -> per-hole stop depths, build order and a validation report.
import {band, DEFAULT_HUB, minAngle, stopFloor, type HubParams} from './params';
import {buildOrder, hubMinAngles, isConnected, neighbours, type StickGraph} from './graph';
import {angle, dist, norm, sub, type V3} from './vec';

export interface Hole {
  /** Stick this hole receives. */
  stick: number;
  /** Unit direction from hub center along the stick. */
  dir: V3;
  /** Distance from hub center to where the stick bottoms out. */
  stop: number;
}

export type StickStatus = 'ok' | 'cut' | 'long';
export interface Stick {
  hubs: [number, number];
  /** Hub-center spacing. */
  span: number;
  status: StickStatus;
  /** How far the span misses what the hub can absorb (0 when it fits exactly). For 'cut', how much to trim; for 'long', how far short the stick falls. */
  mm: number;
}

export interface HubReport { valence: number; minAngleDeg: number; maxStop: number; diameter: number }

export interface StickDesign {
  name: string;
  params: HubParams;
  nodes: V3[];
  sticks: Stick[];
  holes: Hole[][];
  order: number[];
  hubs: HubReport[];
  report: {
    hubCount: number; stickCount: number; ok: number; cut: number; long: number;
    connected: boolean; tooTightHubs: number[];
    /** Degrees of freedom left if every joint were a free pin; 0 means the frame is rigid without joint friction. */
    pinFreedom: number;
    spanRange: [number, number]; band: [number, number];
  };
}

export function design(name: string, graph: StickGraph, p: HubParams = DEFAULT_HUB): StickDesign {
  // Rest the object on z = 0.
  const zMin = Math.min(...graph.nodes.map(n => n[2]));
  const nodes = graph.nodes.map(n => [n[0], n[1], n[2] - zMin] as V3);
  const g = {nodes, edges: graph.edges};
  const nb = neighbours(g);
  // Each hole's floor depends only on its nearest neighbouring hole at the same hub.
  const floorOf = (hub: number, other: number) => {
    const d = sub(nodes[other], nodes[hub]);
    let theta = Math.PI;
    for (const o of nb[hub]) if (o !== other) theta = Math.min(theta, angle(d, sub(nodes[o], nodes[hub])));
    return stopFloor(theta, p);
  };
  const holes: Hole[][] = nodes.map(() => []);
  const sticks: Stick[] = g.edges.map(([a, b], i) => {
    const span = dist(nodes[a], nodes[b]), need = span - p.stickLength;
    const loA = floorOf(a, b), loB = floorOf(b, a), hi = p.maxStop;
    let sA: number, sB: number, status: StickStatus = 'ok', mm = 0;
    if (need < loA + loB) { sA = loA; sB = loB; mm = loA + loB - need; status = mm > p.tolerance ? 'cut' : 'ok'; }
    else if (need > 2 * hi) { sA = hi; sB = hi; mm = need - 2 * hi; status = mm > p.tolerance ? 'long' : 'ok'; }
    else {
      sA = Math.min(hi, Math.max(loA, need / 2)); sB = need - sA;
      if (sB > hi) { sB = hi; sA = need - hi; }
      if (sB < loB) { sB = loB; sA = need - loB; }
    }
    holes[a].push({stick: i, dir: norm(sub(nodes[b], nodes[a])), stop: sA});
    holes[b].push({stick: i, dir: norm(sub(nodes[a], nodes[b])), stop: sB});
    return {hubs: [a, b], span, status, mm};
  });
  const mins = hubMinAngles(g), limit = minAngle(p);
  const hubs = holes.map((hs, i) => {
    const maxStop = Math.max(0, ...hs.map(h => h.stop));
    return {valence: hs.length, minAngleDeg: (mins[i] * 180) / Math.PI, maxStop, diameter: 2 * (maxStop + p.insertion)};
  });
  const spans = sticks.map(s => s.span), b = band(p);
  return {
    name, params: p, nodes, sticks, holes, order: buildOrder(g), hubs,
    report: {
      hubCount: nodes.length, stickCount: sticks.length,
      ok: sticks.filter(s => s.status === 'ok').length, cut: sticks.filter(s => s.status === 'cut').length, long: sticks.filter(s => s.status === 'long').length,
      connected: isConnected(g),
      tooTightHubs: mins.flatMap((m, i) => (m < limit ? [i] : [])),
      pinFreedom: pinFreedom(g),
      spanRange: [Math.min(...spans), Math.max(...spans)], band: [b.lo, b.hi],
    },
  };
}

/**
 * Internal degrees of freedom of the frame with free pin joints: 3V − 6 − rank(rigidity matrix).
 * The rigidity matrix has one row per stick; a stick a–b contributes (pa − pb) at a's columns and (pb − pa) at b's.
 */
export function pinFreedom(g: StickGraph): number {
  const V = g.nodes.length;
  if (V < 2) return 0;
  const rows = g.edges.map(([a, b]) => {
    const r = new Float64Array(3 * V), d = sub(g.nodes[a], g.nodes[b]);
    for (let k = 0; k < 3; k++) { r[3 * a + k] = d[k]; r[3 * b + k] = -d[k]; }
    return r;
  });
  let rank = 0;
  const scaleTol = 1e-9 * Math.max(1, ...g.edges.map(([a, b]) => dist(g.nodes[a], g.nodes[b]) ** 2));
  for (let col = 0; col < 3 * V && rank < rows.length; col++) {
    let piv = rank;
    for (let r = rank + 1; r < rows.length; r++) if (Math.abs(rows[r][col]) > Math.abs(rows[piv][col])) piv = r;
    if (Math.abs(rows[piv][col]) < scaleTol) continue;
    [rows[rank], rows[piv]] = [rows[piv], rows[rank]];
    for (let r = rank + 1; r < rows.length; r++) {
      const f = rows[r][col] / rows[rank][col];
      if (f) for (let c = col; c < 3 * V; c++) rows[r][c] -= f * rows[rank][c];
    }
    rank++;
  }
  const trivial = V === 2 ? 5 : 6; // a lone stick has 5 rigid motions (spin about its axis does nothing)
  return Math.max(0, 3 * V - trivial - rank);
}
