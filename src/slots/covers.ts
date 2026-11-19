/**
 * Covers: a flat piece of the kit's own shape and size that sits where a surface is wanted.
 *
 * Where it sits. Take the convex hull of the whole design. A hull face whose outward normal points up (within
 * MAX_TILT of vertical) is a plane nothing rises above. Every piece that reaches that plane touches it in a contact
 * patch: the convex hull of its points on the plane (a thin rectangle along an upright piece's top edge, a short
 * segment at a rim, a whole face for a piece lying flat). The cover can rest there if, after clipping each patch to
 * the cover's outline, the clipped contacts surround the cover's centre by at least a margin. Candidate seats come
 * from mean shift over the contact points and from turning the cover's outline.
 *
 * Holding things. The cover only rests, so a load beyond its supports tips it off. The safe area is the part of the
 * cover over its contacts (cover ∩ contact hull), as a fraction of the cover. A load inside it cannot tip the cover;
 * it can still tip the whole design once W × (distance of the load beyond a floor support edge) exceeds the
 * design's weight × (distance of its centre of mass inside that edge), so the safe area is rated for that too.
 */
import type {V2, V3} from './math';
import {frameOf, hullFaces, IDENTITY, rotationBetween, type Xf} from './kit';
import {repose} from './kits';
import {groundSupport, insideMargin, underContacts} from './stability';
import {makePanel, panelVertices, toWorld, type Frame, type Panel} from './panel';
import {ccw, clipConvex, convexHull, signedArea} from './poly2d';
import {solids} from './collide';
import type {Grown, Piece} from './kits';
import type {Design} from './engine';

export const MAX_TILT_DEG = 2;
/** Supports must lie inside this fraction of the cover's outline (scaled about its centre). */
export const BEARING = 0.9;

export interface CoverSpot {frame: Frame; tiltDeg: number; supports: number[]; centreMargin: number}

/** Distance from q to the boundary of a CCW convex polygon (negative outside). */
function margin(poly: V2[], q: V2) {
  let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    m = Math.min(m, ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  return m;
}

const apothem = (outline: V2[]) => Math.min(...outline.map((a, i) => {
  const b = outline[(i + 1) % outline.length];
  return Math.abs(a[0] * b[1] - b[0] * a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1]);
}));

const applyR = (R: number[], p: V3): V3 => [R[0] * p[0] + R[1] * p[1] + R[2] * p[2], R[3] * p[0] + R[4] * p[1] + R[5] * p[2], R[6] * p[0] + R[7] * p[1] + R[8] * p[2]];
const mul = (A: number[], B: number[]) => Array.from({length: 9}, (_, k) => { const i = Math.floor(k / 3), j = k % 3; return A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; });

interface Patch {panel: number; poly: V2[]}

/** Best seat for the cover among the patches (all in one plane, as 2D). */
function seat(patches: Patch[], outline: V2[], minMargin: number) {
  const pts = patches.flatMap(p => p.poly), R = Math.max(...outline.map(q => Math.hypot(q[0], q[1])));
  const round = outline.length > 24, turns = round ? [0] : Array.from({length: 36}, (_, i) => (i / 36) * Math.PI * 2);
  const shape = ccw(outline);
  let best: {c: V2; phase: number; m: number; supports: number[]} | null = null;
  const starts: V2[] = [pts.reduce((s, q) => [s[0] + q[0] / pts.length, s[1] + q[1] / pts.length] as V2, [0, 0] as V2), ...pts];
  const tried = new Set<string>();
  for (const start of starts) {
    let c = start;
    for (let k = 0; k < 6; k++) {
      const near = pts.filter(q => Math.hypot(q[0] - c[0], q[1] - c[1]) <= R);
      if (!near.length) break;
      c = [near.reduce((s, q) => s + q[0], 0) / near.length, near.reduce((s, q) => s + q[1], 0) / near.length];
    }
    const key = `${c[0].toFixed(1)},${c[1].toFixed(1)}`;
    if (tried.has(key)) continue;
    tried.add(key);
    for (const phase of turns) {
      const cs = Math.cos(phase), sn = Math.sin(phase);
      // Only contacts at least a tenth of the radius inside the cover's edge bear on it: a cover held at its rim
      // rides off with the first knock.
      const placed = shape.map(q => [c[0] + (q[0] * cs - q[1] * sn) * BEARING, c[1] + (q[0] * sn + q[1] * cs) * BEARING] as V2);
      const supports: number[] = [], touched: V2[] = [];
      for (const p of patches) {
        const cut = clipConvex(p.poly, placed, 0.01);
        if (cut.length) { touched.push(...cut); supports.push(p.panel); }
      }
      const hull = convexHull(touched);
      if (hull.length < 3 || signedArea(hull) < 1e-3) continue;
      const m = margin(hull, c);
      if (m >= minMargin && (!best || m > best.m + 1e-9)) best = {c, phase, m, supports: [...new Set(supports)]};
    }
  }
  return best;
}

/** The highest level spot on top of the design where the cover's centre sits at least `minMargin` inside its contacts. */
export function findCoverSpot(panels: Panel[], t: number, cover: Piece, minMargin: number): CoverSpot | null {
  const faces = hullFaces(panels.flatMap(panelVertices))
    .filter(f => f.n[2] >= Math.cos((MAX_TILT_DEG * Math.PI) / 180))
    .sort((a, b) => Math.max(...b.pts.map(p => p[2])) - Math.max(...a.pts.map(p => p[2])));
  for (const f of faces) {
    // Work in the face's own plane: rotate its normal to +z, take each piece's contact patch there.
    const R = rotationBetween(f.n, [0, 0, 1]), Rt = [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]];
    const z = applyR(R, f.pts[0])[2];
    const patches: Patch[] = [];
    for (const p of panels) for (const s of solids(p)) {
      const on = s.v.map(v => applyR(R, v)).filter(q => Math.abs(q[2] - z) < 0.05).map(q => [q[0], q[1]] as V2);
      if (!on.length) continue;
      const hull = on.length >= 3 ? convexHull(on) : on;
      patches.push({panel: p.id, poly: hull.length >= 3 && signedArea(hull) > 1e-9 ? hull : hull.slice(0, 2)});
    }
    const s = seat(patches, cover.outline, minMargin);
    if (!s) continue;
    const local: Xf = {R: [Math.cos(s.phase), -Math.sin(s.phase), 0, Math.sin(s.phase), Math.cos(s.phase), 0, 0, 0, 1], t: [s.c[0], s.c[1], z + t / 2]};
    const frame = frameOf({R: mul(Rt, local.R), t: applyR(Rt, local.t)});
    return {frame, tiltDeg: (Math.acos(Math.min(1, f.n[2])) * 180) / Math.PI, supports: s.supports, centreMargin: s.m};
  }
  return null;
}

/** Put a cover on the design's top surface. Returns the design with the cover appended, or null. */
export function addCover(g: Grown, cover: Piece, t: number): {g: Grown; spot: CoverSpot} | null {
  const spot = findCoverSpot(g.panels, t, cover, 0.15 * apothem(cover.outline));
  if (!spot) return null;
  const id = g.panels.length, f = spot.frame;
  const X: Xf = {R: [f.u[0], f.v[0], f.n[0], f.u[1], f.v[1], f.n[1], f.u[2], f.v[2], f.n[2]], t: f.o};
  const panel = makePanel(id, 'Cover', 'top', cover.outline, f, t, []);
  return {g: {types: [...g.types, cover.id], X: [...g.X, X], joints: g.joints, travel: [...g.travel, [0, 0, -1]], panels: [...g.panels, panel]}, spot};
}

/** How the cover serves as a surface. `top` is the cover panel's index. */
export function coverReport(d: Design, panels: Panel[], top: number) {
  const P = panels[top], n = P.frame.n;
  const tiltDeg = (Math.acos(Math.min(1, Math.abs(n[2]))) * 180) / Math.PI;
  const height = Math.max(...panelVertices(P).map(v => v[2]));
  const outline = ccw(P.outline);
  const contacts = convexHull(underContacts(P, panels.filter((_, i) => i !== top)));
  const safe = contacts.length >= 3 ? clipConvex(outline, contacts) : [];
  const safeFrac = safe.length >= 3 ? signedArea(safe) / signedArea(outline) : 0;
  // Least load anywhere in the safe area that tips the whole design over a floor support edge.
  const hull = d.support.hull, M = d.support.mass, com = d.support.com;
  const side = (a: V2, b: V2, q: V2) => ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
  let loadG = Infinity;
  for (const q of safe.map(v => toWorld(P.frame, v))) for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length], dq = side(a, b, [q[0], q[1]]);
    if (dq < 0) loadG = Math.min(loadG, (M * Math.max(0, side(a, b, [com[0], com[1]]))) / -dq);
  }
  return {tiltDeg, height, safeFrac, loadKg: loadG / 1000, contacts: contacts.length};
}

/** Cover sizes tried, as multiples of the piece size: the same size first, then a little larger. */
export const COVER_SCALES = [1, 1.25, 1.5, 1.75, 2, 2.5];

/** What a table stance is judged on: how tall it stands with the cover on, how wide it spreads, where the cover sits. */
export interface Stance {height: number; plan: number; coverWidth: number; centreMargin: number; tipDeg: number}

/**
 * Stand a grown design so a cover rests level on top, and add the cover. Tries the design on each axis (and, for
 * kits whose pieces do not line up with the axes, on each hull face with a parallel face opposite); `upright` keeps
 * it standing as built. A stance must
 * stand with its centre of mass at least `minTip` degrees from tipping and pass `accept`; among those, the smallest
 * cover that rests wins, then the stance that tips last. `makeCover(scale)` builds the cover at scale × piece size.
 * Returns the design with the cover appended, or the reason the best attempt failed.
 */
export function coverDesign(g: Grown, makeCover: (scale: number) => Piece, t: number, opts: {minTip?: number; accept?: (s: Stance) => string | null; upright?: boolean} = {}):
  {g: Grown; spot: CoverSpot; cover: Piece; scale: number} | {why: string} {
  const minTip = opts.minTip ?? 4, accept = opts.accept ?? (() => null);
  const X0 = g.X.slice(), T0 = g.travel.slice();
  const reset = (R: number[]) => { g.X = X0.slice(); g.travel = T0.slice(); repose(g, R); };
  const why = new Map<string, number>();
  const reject = (w: string) => why.set(w, (why.get(w) ?? 0) + 1);
  let best: {R: number[]; scale: number; tip: number} | null = null;
  const judge = (R: number[]) => {
    reset(R);
    const sup = groundSupport(g.panels);
    if (!(sup.margin > 0)) return reject('would not stand');
    if (sup.tipDeg < minTip) return reject(`tips under ${minTip}°`);
    for (const scale of COVER_SCALES) {
      if (best && scale > best.scale) return;
      const cover = makeCover(scale), spot = findCoverSpot(g.panels, t, cover, 0.15 * apothem(cover.outline));
      if (!spot) continue;
      const xs = g.panels.flatMap(p => panelVertices(p)), coverWidth = Math.max(...cover.outline.map(q => Math.hypot(q[0], q[1]))) * 2;
      const span = (k: 0 | 1) => Math.max(...xs.map(v => v[k])) - Math.min(...xs.map(v => v[k]));
      const stance: Stance = {height: Math.max(...xs.map(v => v[2])) - Math.min(...xs.map(v => v[2])) + t, plan: Math.max(span(0), span(1)), coverWidth,
        centreMargin: insideMargin(sup.hull, [spot.frame.o[0], spot.frame.o[1]]).margin, tipDeg: sup.tipDeg};
      const no = accept(stance);
      if (no) { reject(no); continue; }
      if (!best || scale < best.scale || sup.tipDeg > best.tip) best = {R, scale, tip: sup.tipDeg};
      return;
    }
    if (!best) reject('no level spot on top for the cover');
  };
  for (const up of (opts.upright ? [[0, 0, 1]] : [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]) as V3[]) judge(rotationBetween(up, [0, 0, 1]));
  if (!best && !opts.upright) {
    // Not axis-aligned (triangles, pentagons, hexagons): rest on a hull face that has a parallel face opposite.
    reset(IDENTITY.R);
    const cosT = Math.cos((MAX_TILT_DEG * Math.PI) / 180), faces = hullFaces(g.panels.flatMap(panelVertices));
    for (const A of faces) if (faces.some(B => dot3(A.n, B.n) <= -cosT)) judge(rotationBetween(A.n, [0, 0, -1]));
  }
  if (!best) { reset(IDENTITY.R); return {why: [...why.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'no level spot on top for the cover'}; }
  const chosen: {R: number[]; scale: number} = best;
  reset(chosen.R);
  const cover = makeCover(chosen.scale), placed = addCover(g, cover, t);
  return placed ? {g: placed.g, spot: placed.spot, cover, scale: chosen.scale} : {why: 'no level spot on top for the cover'};
}

const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
