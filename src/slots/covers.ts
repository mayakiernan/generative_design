/**
 * Covers: a flat piece with no slits that rests where a surface is wanted, either the kit's own shape scaled up or
 * an outline cut to fit the design's top (fittedCover).
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
import type {V2, V3} from './math.js';
import {frameOf, hullFaces, IDENTITY, rotationBetween, type Xf} from './kit.js';
import {repose} from './kits.js';
import {groundSupport, insideMargin, underContacts} from './stability.js';
import {makePanel, panelVertices, toWorld, type Frame, type Panel} from './panel.js';
import {ccw, centroid, clipConvex, convexHull, signedArea} from './poly2d.js';
import {solids} from './collide.js';
import type {Grown, Piece} from './kits.js';
import type {Design} from './engine.js';

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

export const apothem = (outline: V2[]) => Math.min(...outline.map((a, i) => {
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

/** The design with the cover appended at `spot`. */
function withCover(g: Grown, cover: Piece, t: number, spot: CoverSpot): Grown {
  const id = g.panels.length, f = spot.frame;
  const X: Xf = {R: [f.u[0], f.v[0], f.n[0], f.u[1], f.v[1], f.n[1], f.u[2], f.v[2], f.n[2]], t: f.o};
  const panel = makePanel(id, 'Cover', 'top', cover.outline, f, t, []);
  return {types: [...g.types, cover.id], X: [...g.X, X], joints: g.joints, travel: [...g.travel, [0, 0, -1]], panels: [...g.panels, panel]};
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
 * Set a design on the floor as built and rest a cover level on top. It must stand with its centre of mass at least
 * `minTip` degrees from tipping, and the stance must pass `accept`. Covers are tried at each of `scales` (× piece
 * size, via `makeCover`) in turn; the first that rests and is accepted wins. Returns the design with the cover
 * appended, or why it failed.
 */
export function coverDesign(g: Grown, makeCover: (scale: number) => Piece, t: number, opts: {minTip?: number; accept?: (s: Stance) => string | null; scales?: number[]} = {}):
  {g: Grown; spot: CoverSpot; cover: Piece; scale: number} | {why: string} {
  const minTip = opts.minTip ?? 4, accept = opts.accept ?? (() => null);
  repose(g, IDENTITY.R);
  const sup = groundSupport(g.panels);
  if (!(sup.margin > 0)) return {why: 'would not stand'};
  if (sup.tipDeg < minTip) return {why: `tips under ${minTip}°`};
  const xs = g.panels.flatMap(p => panelVertices(p));
  const span = (k: 0 | 1 | 2) => Math.max(...xs.map(v => v[k])) - Math.min(...xs.map(v => v[k]));
  let why = 'no level spot on top for the cover';
  for (const scale of opts.scales ?? COVER_SCALES) {
    const cover = makeCover(scale), spot = findCoverSpot(g.panels, t, cover, 0.15 * apothem(cover.outline));
    if (!spot) continue;
    const coverWidth = Math.max(...cover.outline.map(q => Math.hypot(q[0], q[1]))) * 2;
    const no = accept({height: span(2) + t, plan: Math.max(span(0), span(1)), coverWidth, centreMargin: insideMargin(sup.hull, [spot.frame.o[0], spot.frame.o[1]]).margin, tipDeg: sup.tipDeg});
    if (no) { why = no; continue; }
    return {g: withCover(g, cover, t, spot), spot, cover, scale};
  }
  return {why};
}

/** Width of a convex polygon: its least extent across any of its edges. */
export function minWidth(poly: V2[]): number {
  let w = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 1e-9) continue;
    const n: V2 = [(b[1] - a[1]) / l, -(b[0] - a[0]) / l], d = poly.map(q => (q[0] - a[0]) * n[0] + (q[1] - a[1]) * n[1]);
    w = Math.min(w, Math.max(...d) - Math.min(...d));
  }
  return w;
}

/**
 * A large cover for a design whose very top is a point or a line (a form resting tilted, say): the contacts on its
 * highest near-level face that three or more pieces touch, not all on one line, grown outward by `margin` like
 * fittedCover and widened to at least `least` across. Null when no such face exists.
 */
export function faceCover(panels: Panel[], t: number, clearance: number, margin: number, least = 0): Piece | null {
  const vs = panels.map(p => panelVertices(p));
  const faces = hullFaces(vs.flat())
    .filter(f => f.n[2] >= Math.cos((MAX_TILT_DEG * Math.PI) / 180))
    .sort((a, b) => Math.max(...b.pts.map(p => p[2])) - Math.max(...a.pts.map(p => p[2])));
  for (const f of faces) {
    const plane = (v: V3) => f.n[0] * v[0] + f.n[1] * v[1] + f.n[2] * v[2];
    const on = vs.map(ps => ps.filter(v => plane(v) >= f.c - 0.05)).filter(ps => ps.length);
    if (on.length < 3) continue;
    const hull = ccw(convexHull(on.flat().map(v => [v[0], v[1]] as V2)));
    if (hull.length < 3 || signedArea(hull) < 1) continue;
    return grownCover(hull, t, clearance, margin, least);
  }
  return null;
}

/**
 * A cover cut to fit the design's top: the plan hull of its highest points grown outward by `margin`, corners
 * rounded (the hull's Minkowski sum with a disc), and widened until it is at least `minWidth` across in every
 * direction. Centred on its centroid. Null when the top is a single point or line, which leaves nothing to fit.
 */
export function fittedCover(panels: Panel[], t: number, clearance: number, margin: number, least = 0, arcSteps = 8): Piece | null {
  const vs = panels.flatMap(panelVertices), top = Math.max(...vs.map(v => v[2]));
  const hull = ccw(convexHull(vs.filter(v => v[2] > top - 0.05).map(v => [v[0], v[1]] as V2)));
  if (hull.length < 3 || signedArea(hull) < 1e-6) return null;
  return grownCover(hull, t, clearance, margin, least, arcSteps);
}

/** A CCW plan hull grown outward by `margin` (corners rounded), widened to `least` across, centred on its centroid. */
function grownCover(hull: V2[], t: number, clearance: number, margin: number, least = 0, arcSteps = 8): Piece {
  const grown = (m: number): V2[] => {
    const out: V2[] = [];
    hull.forEach((v, i) => {
      const a = hull[(i + hull.length - 1) % hull.length], b = hull[(i + 1) % hull.length];
      // Outward normals of the edges into and out of v (CCW hull: the right-hand normal points out).
      let a0 = Math.atan2(-(v[0] - a[0]), v[1] - a[1]), a1 = Math.atan2(-(b[0] - v[0]), b[1] - v[1]);
      if (a1 < a0) a1 += 2 * Math.PI;
      for (let k = 0; k <= arcSteps; k++) { const th = a0 + ((a1 - a0) * k) / arcSteps; out.push([v[0] + m * Math.cos(th), v[1] + m * Math.sin(th)]); }
    });
    return out;
  };
  let outline = grown(margin);
  const short = least - minWidth(outline);
  if (short > 0) outline = grown(margin + short / 2);
  const c = centroid(outline);
  return {id: 'CF', name: 'Cover, cut to fit', outline: outline.map(q => [q[0] - c[0], q[1] - c[1]] as V2), slits: [], len: 0, cuts: [], w: t + clearance};
}
