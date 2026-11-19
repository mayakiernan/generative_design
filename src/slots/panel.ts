/**
 * A panel is a flat sheet: a simple outline in its own 2D coordinates, a frame placing that plane in space,
 * and a thickness t centred on the plane. Local (x, y) maps to o + x·u + y·v; the solid is every such point
 * moved by h·n with |h| ≤ t/2. Cuts are convex polygons removed from the outline.
 */
import {add, cross, dot, norm, scale, sub, type V2, type V3} from './math.js';
import {ccw, centroid, clean, clipHalfPlane, convexDecompose, convexMinus, signedArea} from './poly2d.js';

export interface Frame {o: V3; u: V3; v: V3; n: V3}

export type SlitType = 'cross' | 'radial' | 'edge' | 'tab' | 'kit';
export type Role = 'top' | 'leg' | 'fin' | 'wall' | 'plate' | 'disc' | 'beam' | 'module';
export type CutKind = 'slit' | 'slot' | 'channel' | 'design';

export interface Cut {poly: V2[]; kind: CutKind; joint?: number}

export interface Panel {
  id: number;
  name: string;
  role: Role;
  outline: V2[];
  frame: Frame;
  t: number;
  cuts: Cut[];
  /** Convex partition of outline minus cuts. */
  pieces: V2[][];
}

export const toWorld = (f: Frame, q: V2, h = 0): V3 => add(add(add(f.o, scale(f.u, q[0])), scale(f.v, q[1])), scale(f.n, h));
export function toLocal(f: Frame, p: V3): [number, number, number] {
  const d = sub(p, f.o);
  return [dot(d, f.u), dot(d, f.v), dot(d, f.n)];
}

/** Upright panel standing on z = origin.z. Local x runs horizontally at `angle` (radians from +x), local y is up. */
export function uprightFrame(origin: V3, angle: number): Frame {
  const u: V3 = [Math.cos(angle), Math.sin(angle), 0], v: V3 = [0, 0, 1];
  return {o: origin, u, v, n: norm(cross(u, v))};
}

/** Flat panel whose mid-plane sits at origin.z. */
export function flatFrame(origin: V3, angle = 0): Frame {
  return {o: origin, u: [Math.cos(angle), Math.sin(angle), 0], v: [-Math.sin(angle), Math.cos(angle), 0], n: [0, 0, 1]};
}

export function makePanel(id: number, name: string, role: Role, outline: V2[], frame: Frame, t: number, design: V2[][] = []): Panel {
  const p: Panel = {id, name, role, outline: clean(ccw(outline)), frame, t, cuts: [], pieces: convexDecompose(outline)};
  for (const c of design) applyCut(p, {poly: ccw(c), kind: 'design'});
  return p;
}

export function applyCut(p: Panel, cut: Cut) {
  p.cuts.push(cut);
  p.pieces = p.pieces.flatMap(q => convexMinus(q, cut.poly));
}

export function panelArea(p: Pick<Panel, 'pieces'>) {
  return p.pieces.reduce((s, q) => s + signedArea(q), 0);
}

/** Area-weighted centroid of the material, in world coordinates. */
export function panelCentroid(p: Pick<Panel, 'pieces' | 'frame'>): V3 {
  let a = 0, x = 0, y = 0;
  for (const q of p.pieces) {
    const ar = signedArea(q), c = centroid(q);
    a += ar; x += c[0] * ar; y += c[1] * ar;
  }
  return toWorld(p.frame, [x / a, y / a]);
}

export function panelVertices(p: Pick<Panel, 'pieces' | 'frame' | 't'>): V3[] {
  const h = p.t / 2;
  return p.pieces.flatMap(q => q.flatMap(v => [toWorld(p.frame, v, -h), toWorld(p.frame, v, h)]));
}

/* ---------- outline builders (local 2D, counter-clockwise) ---------- */

export function rect(x0: number, y0: number, x1: number, y1: number): V2[] {
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

export function circle(r: number, segs = 72, cx = 0, cy = 0, phase = 0): V2[] {
  return Array.from({length: segs}, (_, i) => {
    const a = phase + (i / segs) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as V2;
  });
}

export function regular(n: number, r: number, phase = Math.PI / 2, cx = 0, cy = 0): V2[] {
  return circle(r, n, cx, cy, phase);
}

export function roundedRect(w: number, h: number, r: number, segs = 6): V2[] {
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3), out: V2[] = [];
  if (rr <= 0.5) return rect(-w / 2, -h / 2, w / 2, h / 2);
  const corners: [number, number, number][] = [[w / 2 - rr, -h / 2 + rr, -Math.PI / 2], [w / 2 - rr, h / 2 - rr, 0], [-w / 2 + rr, h / 2 - rr, Math.PI / 2], [-w / 2 + rr, -h / 2 + rr, Math.PI]];
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= segs; i++) {
    const a = a0 + (i / segs) * (Math.PI / 2);
    out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return clean(out);
}

/** Symmetric profile from (half-width, height) stations, bottom first. Concave profiles are fine. */
export function profile(stations: [number, number][]): V2[] {
  const right = stations.map(([w, y]) => [w, y] as V2);
  const left = [...stations].reverse().map(([w, y]) => [-w, y] as V2);
  return clean(right.concat(left));
}

/** Arch cut-out rising from the bottom edge: a half-ellipse, extended below y = 0 so it opens cleanly. Convex. */
export function arch(cx: number, halfWidth: number, height: number, segs = 14): V2[] {
  const pts: V2[] = [[cx - halfWidth, -10], [cx + halfWidth, -10]];
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI;
    pts.push([cx + halfWidth * Math.cos(a), height * Math.sin(a)]);
  }
  return clean(pts);
}

/** Window cut-out: rectangle, diamond or circle centred at (cx, cy). */
export function windowCut(kind: 'rect' | 'diamond' | 'round', cx: number, cy: number, w: number, h: number): V2[] {
  if (kind === 'diamond') return [[cx, cy - h / 2], [cx + w / 2, cy], [cx, cy + h / 2], [cx - w / 2, cy]];
  if (kind === 'round') return Array.from({length: 20}, (_, i) => { const a = (i / 20) * Math.PI * 2; return [cx + (w / 2) * Math.cos(a), cy + (h / 2) * Math.sin(a)] as V2; });
  return rect(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2);
}

/**
 * Add rectangular tabs on edge `edge` of a counter-clockwise outline. Each tab sits at fraction `at` along the
 * edge and protrudes outward (to the right of the edge direction) by `height`.
 */
export function withTabs(outline: V2[], edge: number, tabs: {at: number; width: number; height: number}[]): V2[] {
  const a = outline[edge], b = outline[(edge + 1) % outline.length];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), d: V2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], out: V2 = [d[1], -d[0]];
  const at = (s: number, h: number): V2 => [a[0] + d[0] * s + out[0] * h, a[1] + d[1] * s + out[1] * h];
  const bumps: V2[] = [];
  for (const t of [...tabs].sort((x, y) => x.at - y.at)) {
    const s0 = t.at * L - t.width / 2, s1 = t.at * L + t.width / 2;
    bumps.push(at(s0, 0), at(s0, t.height), at(s1, t.height), at(s1, 0));
  }
  return [...outline.slice(0, edge + 1), ...bumps, ...outline.slice(edge + 1)];
}

/** Clip an outline to the half-plane n·x ≤ c (e.g. flatten the bottom of a disc). Convex outlines only. */
export function truncate(outline: V2[], n: V2, c: number): V2[] {
  return clipHalfPlane(outline, n, c);
}
