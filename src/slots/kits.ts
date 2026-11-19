/**
 * Slot kits: one shape at one size, cut with different slit patterns (discs, triangles, or a pinwheel polygon). Slits all have the same
 * length and a snug width. Any slit interlocks with any other; the two pieces end up perpendicular.
 *
 * Why only 90°: a slit of width w fits pieces meeting at θ when (t + t|cos θ|)/sin θ ≤ w − c. A snug slit
 * (w = t + c) admits exactly θ = 90°, so the joint is rigid. A wider slit admits a range of angles, which means
 * the joint can rock within it; a tree of rocking joints is a mechanism, not a stable object.
 *
 * Joint geometry. Give slit k a frame S_k: origin at its mouth e, x along its inward direction d, y = d⊥,
 * z = the piece normal. Q joins P (P's slit i to Q's slit j) when Q's slit frame, seen from P's, is
 *   translate (ℓ_P + ℓ_Q, 0, 0) · Rx(ψ) · Rz(π)
 * i.e. on the same line, facing back, mouths ℓ_P + ℓ_Q apart, turned ψ about the line. Q's frame is
 * F_P · S_i · that · S_j⁻¹. With snug slits ψ is 90° or 270° (Q on one side of P or the other).
 *
 * Designs grow as trees, one piece at a time. A piece is kept only if it overlaps nothing (separating-axis
 * test) and its straight slide into place is clear of everything already built, so the growth order is itself
 * a verified build order.
 */
import {add, cross, dot, norm, scale, sub, type Rng, type V2, type V3} from './math';
import {circle, makePanel, panelVertices, regular, truncate, type Panel} from './panel';
import {convexHull, convexOverlap, enclosingCircle, rayHit} from './poly2d';
import {exitDistance, panelDepth, pathBlocker} from './collide';
import {compose, frameOf, IDENTITY, restingPose, rotate, type Xf} from './kit';
import {massProps, partHold} from './stability';

export interface Slit {e: V2; d: V2}
export interface PieceType {
  id: string; name: string; outline: V2[]; slits: Slit[]; len: number;
  /** Notched along a flat top edge (y = 0): its two slits run along that edge, flush with it, from both ends. */
  notched?: boolean;
}
export type KitId = 'circle' | 'triangle' | 'pentagon' | 'hexagon' | 'decagon';
export interface KitDef {id: KitId; name: string; blurb: string; pieces: (size: number) => PieceType[]}

const radial = (R: number, deg: number): Slit => {
  const a = (deg * Math.PI) / 180;
  return {e: [R * Math.cos(a), R * Math.sin(a)], d: [-Math.cos(a), -Math.sin(a)]};
};

/** Mouth of a slit that runs along direction d at offset `off` from a line through the origin: where it meets the outline. */
export function mouth(outline: V2[], d: V2, off: number): V2 {
  const p: V2 = [-d[1] * off, d[0] * off], back: V2 = [-d[0], -d[1]];
  const segs = outline.map((a, i) => [a, outline[(i + 1) % outline.length]] as [V2, V2]);
  const s = rayHit(p, back, segs, 0);
  return [p[0] + back[0] * s, p[1] + back[1] * s];
}

/** The five disc pieces from the sketch. Slits run from the rim halfway to the centre. */
function circlePieces(size: number): PieceType[] {
  const R = size / 2, disc = circle(R, 72), ln = 0.48 * R;
  const half = truncate(circle(R, 72), [0, 1], 0); // flat edge on top, as drawn
  return [
    {id: 'C1', name: 'Disc, 1 slit', outline: disc, slits: [radial(R, 90)], len: ln},
    {id: 'C2L', name: 'Disc, 2 slits at 90°', outline: disc, slits: [radial(R, 90), radial(R, 0)], len: ln},
    {id: 'C2I', name: 'Disc, 2 slits at 180°', outline: disc, slits: [radial(R, 180), radial(R, 0)], len: ln},
    {id: 'C3T', name: 'Disc, 3 slits', outline: disc, slits: [radial(R, 90), radial(R, 180), radial(R, 0)], len: ln},
    // Half disc: the 180° disc cut along its slits, so both slits become notches along the flat edge.
    {id: 'H', name: 'Half disc, 2 notches', outline: half, slits: [], len: ln, notched: true},
  ];
}

/** Equilateral triangles with slits from edge midpoints toward the centre, plus a pinwheel triangle. */
function trianglePieces(size: number): PieceType[] {
  const Rc = size / Math.sqrt(3), V = regular(3, Rc, (-150 * Math.PI) / 180), h = 1.5 * Rc, ln = 0.3 * h;
  const edge = (k: number, at: number): Slit => {
    const a = V[k], b = V[(k + 1) % 3], ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey);
    return {e: [a[0] + ex * at, a[1] + ey * at], d: [-ey / l, ex / l]};
  };
  return [
    {id: 'T1', name: 'Triangle, 1 slit', outline: V, slits: [edge(0, 0.5)], len: ln},
    {id: 'T2', name: 'Triangle, 2 slits', outline: V, slits: [edge(0, 0.5), edge(1, 0.5)], len: ln},
    {id: 'T3', name: 'Triangle, 3 slits', outline: V, slits: [edge(0, 0.5), edge(1, 0.5), edge(2, 0.5)], len: ln},
    {id: 'TP', name: 'Triangle, pinwheel', outline: V, slits: [edge(0, 0.32), edge(1, 0.32), edge(2, 0.32)], len: 0.24 * h},
  ];
}

const POLY_NAME: Record<number, string> = {5: 'Pentagon', 6: 'Hexagon', 10: 'Decagon'};
const polyOutline = (n: number, size: number) => regular(n, size / 2, -Math.PI / 2 - Math.PI / n);

/** One regular polygon with an offset slit on every edge: the single-shape pinwheel kits of the first reference. */
function pinwheelPieces(n: number) {
  return (size: number): PieceType[] => {
    const V = polyOutline(n, size), ln = 0.26 * 2 * (size / 2) * Math.sin(Math.PI / n) * (n >= 10 ? 1.6 : 1);
    const slits = V.map((a, k): Slit => {
      const b = V[(k + 1) % n], ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey);
      return {e: [a[0] + ex * 0.32, a[1] + ey * 0.32], d: [-ey / l, ex / l]};
    });
    return [{id: `P${n}`, name: `${POLY_NAME[n]}, ${n} slits`, outline: V, slits, len: ln}];
  };
}

export const KITS: KitDef[] = [
  {id: 'circle', name: 'Circular', blurb: 'Discs with 1, 2 or 3 slits and a notched half disc', pieces: circlePieces},
  {id: 'triangle', name: 'Triangular', blurb: 'Triangles with 1, 2 or 3 slits and a pinwheel triangle', pieces: trianglePieces},
  {id: 'pentagon', name: 'Pentagon', blurb: 'One pentagon with a slit on every edge', pieces: pinwheelPieces(5)},
  {id: 'hexagon', name: 'Hexagon', blurb: 'One hexagon with a slit on every edge', pieces: pinwheelPieces(6)},
  {id: 'decagon', name: 'Decagon', blurb: 'One decagon with a slit on every edge', pieces: pinwheelPieces(10)},
];

/**
 * The cover: the kit's own shape at the same size, with no slits. It sits wherever a flat surface is wanted.
 */
export function coverPiece(kit: KitId, size: number, t: number, c: number): Piece {
  const outline = kit === 'circle' ? circle(size / 2, 72) : kit === 'triangle' ? regular(3, size / Math.sqrt(3), (-150 * Math.PI) / 180) : polyOutline(({pentagon: 5, hexagon: 6, decagon: 10} as const)[kit], size);
  return {id: 'CV', name: 'Cover', outline, slits: [], len: 0, cuts: [], w: t + c};
}

/** Slits and the half disc's notches need the sheet thickness, so pieces are finished here. */
export interface Piece extends PieceType {cuts: V2[][]; w: number}

export function finishPieces(kit: KitId, size: number, t: number, c: number): Piece[] {
  const w = t + c;
  return KITS.find(k => k.id === kit)!.pieces(size).map(p => {
    let slits = p.slits;
    if (p.notched) {
      // Notches: slits along the flat edge (y = 0), flush with it, entering from the rim at each end.
      slits = [{e: mouth(p.outline, [1, 0], -w / 2), d: [1, 0]}, {e: mouth(p.outline, [-1, 0], w / 2), d: [-1, 0]}];
    }
    const cuts = slits.map(({e, d}) => {
      const q: V2 = [-d[1], d[0]], s1 = p.len + c / 2;
      const at = (s: number, o: number): V2 => [e[0] + d[0] * s + q[0] * o, e[1] + d[1] * s + q[1] * o];
      const s0 = -(2 + 2 * w); // start well outside: at a sharp corner the rim meets the slit edge beyond its centre line
    return [at(s0, -w / 2), at(s1, -w / 2), at(s1, w / 2), at(s0, w / 2)];
    });
    return {...p, slits, cuts, w};
  });
}

/** Why a piece can't work: slits must not run into each other, and each needs 2ℓ of material along its line. */
export function pieceProblem(p: Piece): string | null {
  const segs = p.outline.map((a, i) => [a, p.outline[(i + 1) % p.outline.length]] as [V2, V2]);
  for (const {e, d} of p.slits) if (rayHit([e[0] + d[0] * 1e-3, e[1] + d[1] * 1e-3], d, segs, 0) < 2 * p.len + 1) return `${p.name}: a slit has less than twice its length of material behind it`;
  for (let i = 0; i < p.cuts.length; i++) for (let j = i + 1; j < p.cuts.length; j++) if (convexOverlap(p.cuts[i], p.cuts[j], 0.5)) return `${p.name}: two slits meet`;
  return null;
}

/* ---------- joints ---------- */

const slitFrame = (p: Piece, k: number): Xf => {
  const {e, d} = p.slits[k];
  return {R: [d[0], -d[1], 0, d[1], d[0], 0, 0, 0, 1], t: [e[0], e[1], 0]};
};
const invert = (X: Xf): Xf => {
  const R = [X.R[0], X.R[3], X.R[6], X.R[1], X.R[4], X.R[7], X.R[2], X.R[5], X.R[8]];
  return {R, t: scale(rotate({R, t: [0, 0, 0]}, X.t), -1)};
};

/** Frame of Q when its slit j takes P's slit i, turned ψ about the slit line. */
/**
 * Two half discs notch to notch: both cuts are shallow notches along a straight edge, so the joint engages only a
 * sheet thickness and the lying half disc hangs off a line with its weight to one side. Never grown.
 */
export const weakJoint = (P: Piece, Q: Piece) => P.id === 'H' && Q.id === 'H';

export function childFrame(FP: Xf, P: Piece, i: number, Q: Piece, j: number, psi: number): Xf {
  const c = Math.cos(psi), s = Math.sin(psi);
  // Rx(ψ)·Rz(π) = [[−1,0,0],[0,−c,−s],[0,−s,c]]
  const rel: Xf = {R: [-1, 0, 0, 0, -c, -s, 0, -s, c], t: [P.len + Q.len, 0, 0]};
  return compose(compose(compose(FP, slitFrame(P, i)), rel), invert(slitFrame(Q, j)));
}

/* ---------- growth ---------- */

export type Intent = 'any' | 'tower' | 'spread' | 'compact' | 'table' | 'random';

export interface Grown {
  types: string[];
  X: Xf[];
  joints: {child: number; parent: number; childSlit: number; parentSlit: number}[];
  /** Direction each piece slides in, world. Null for the first. */
  travel: (V3 | null)[];
  panels: Panel[];
}

export type Branching = 'chain' | 'mixed' | 'bushy';
/** How a recipe steers growth: relative weight per piece type (0 = never use) and branching style. */
export interface Steer {weights?: Record<string, number>; branching?: Branching}

/**
 * A random design's limit. Seen down `up`, every piece stays inside a circle of this radius; and no piece reaches
 * below the first piece's lowest point along `up`, so the design grows up from a floor and comes out with its feet
 * on that floor.
 */
export interface Footprint {up: V3; radius: number}

/** Panel corners seen down `up`, as coordinates in the plane across it. */
export function planPoints(panels: Panel[], up: V3): V2[] {
  const e1 = norm(Math.abs(up[2]) < 0.9 ? cross(up, [0, 0, 1]) : cross(up, [1, 0, 0])), e2 = cross(up, e1);
  return panels.flatMap(panelVertices).map(v => [dot(v, e1), dot(v, e2)] as V2);
}

/** Weighted pick; falls back to uniform when every weight is zero. */
function weighted<T extends {id: string}>(xs: T[], w: Record<string, number> | undefined, r: Rng): T {
  const ws = xs.map(x => Math.max(0, w?.[x.id] ?? 1)), sum = ws.reduce((a, b) => a + b, 0);
  if (sum <= 0) return r.pick(xs);
  let u = r.next() * sum;
  for (let i = 0; i < xs.length; i++) { u -= ws[i]; if (u <= 0) return xs[i]; }
  return xs[xs.length - 1];
}

/**
 * Tree growth. `within` keeps the design above a floor and inside a circle on it: the smallest circle round every
 * piece placed so far, seen down `up`, may not grow past the radius, wherever that circle's centre ends up.
 */
export function grow(pieces: Piece[], count: number, intent: Intent, t: number, r: Rng, steer: Steer = {}, within?: Footprint): Grown | null {
  const byId = new Map(pieces.map(p => [p.id, p]));
  const allowed = pieces.filter(p => (steer.weights?.[p.id] ?? 1) > 0);
  const growers = (allowed.length ? allowed : pieces).filter(p => p.slits.length >= 2);
  if (!growers.length) return null;
  // Random designs draw their branching style too, whatever a recipe asked for.
  const branching: Branching = intent === 'random' ? r.pick<Branching>(['chain', 'mixed', 'bushy']) : steer.branching ?? (intent === 'tower' ? 'chain' : intent === 'compact' ? 'bushy' : 'mixed');
  const start = weighted(growers, steer.weights, r);
  const g: Grown = {types: [start.id], X: [IDENTITY], joints: [], travel: [null], panels: [makePanel(0, '1', 'module', start.outline, frameOf(IDENTITY), t, start.cuts)]};
  const free: Set<number>[] = [new Set(start.slits.map((_, k) => k))];
  let plan = within ? convexHull(planPoints(g.panels, within.up)) : [];
  const floor = within ? Math.min(...panelVertices(g.panels[0]).map(v => dot(v, within.up))) - 1e-6 : 0;
  // Inside a circle growth often runs out of room: stop once 150 tries in a row place nothing.
  let placedAt = 0;
  for (let tries = 0; g.X.length < count && tries < count * 60 && !(within && tries - placedAt > 150); tries++) {
    const open = free.map((f, k) => (f.size ? k : -1)).filter(k => k >= 0);
    if (!open.length) break;
    // Towers extend the newest piece (chains); compact designs fill the oldest first (bushes).
    const at = branching === 'chain' && r.next() < 0.8 ? open[open.length - 1] : branching === 'bushy' && r.next() < 0.8 ? open[0] : r.pick(open);
    const P = byId.get(g.types[at])!, i = r.pick([...free[at]]);
    const last = g.X.length >= count - 1, pool = allowed.length ? allowed : pieces;
    const kind = last || r.next() < 0.15 ? weighted(pool, steer.weights, r) : weighted(growers, steer.weights, r);
    const j = r.int(0, kind.slits.length - 1), psi = r.pick([Math.PI / 2, (3 * Math.PI) / 2]);
    if (weakJoint(P, kind)) continue;
    const X = childFrame(g.X[at], P, i, kind, j, psi);
    const panel = makePanel(g.X.length, String(g.X.length + 1), 'module', kind.outline, frameOf(X), t, kind.cuts);
    const nextPlan = within ? convexHull([...plan, ...planPoints([panel], within.up)]) : plan;
    // Below the floor or past the circle: sometimes give up on that slit, so growth turns to slits with room.
    if (within && (panelVertices(panel).some(v => dot(v, within.up) < floor) || enclosingCircle(nextPlan).r > within.radius)) { if (r.next() < 0.3) free[at].delete(i); continue; }
    if (g.panels.some(q => panelDepth(panel, q) > 0)) continue;
    const dir = rotate(g.X[at], [P.slits[i].d[0], P.slits[i].d[1], 0]), back = scale(dir, -1);
    if (pathBlocker(panel, scale(back, exitDistance(panel, g.panels, back)), g.panels) !== null) continue;
    free[at].delete(i);
    free.push(new Set(kind.slits.map((_, k) => k).filter(k => k !== j)));
    g.joints.push({child: g.X.length, parent: at, childSlit: j, parentSlit: i});
    g.types.push(kind.id); g.X.push(X); g.travel.push(dir); g.panels.push(panel);
    plan = nextPlan; placedAt = tries;
  }
  // A design grown in a circle may stop short; the gallery still holds it to three quarters of the count it wants.
  return g.X.length >= Math.max(3, Math.ceil(count * (within ? 0.625 : 0.75))) ? g : null;
}

/**
 * Box-filling growth: grow a tree as usual, but keep a piece only if it stays inside a box around the first piece
 * (half-width `half` across, half-height `halfH` up and down). Filling a box several pieces wide and a few layers
 * tall turns the tree into a stacked grid. With slits at right angles (the circle kit) every piece ends up
 * lying flat or standing upright, so all the upright pieces of the top layer reach exactly one height and all those
 * of the bottom layer stand on one plane: the top and the feet come out level without being forced.
 */
export function growBoxed(pieces: Piece[], count: number, t: number, r: Rng, half: number, halfH: number, steer: Steer = {}): Grown | null {
  const byId = new Map(pieces.map(p => [p.id, p]));
  const allowed = pieces.filter(p => (steer.weights?.[p.id] ?? 1) > 0 && p.slits.length >= 1);
  const growers = allowed.filter(p => p.slits.length >= 2);
  if (!growers.length) return null;
  const start = weighted(growers, steer.weights, r);
  const g: Grown = {types: [start.id], X: [IDENTITY], joints: [], travel: [null], panels: [makePanel(0, '1', 'module', start.outline, frameOf(IDENTITY), t, start.cuts)]};
  const free: Set<number>[] = [new Set(start.slits.map((_, k) => k))];
  const inside = (p: Panel) => panelVertices(p).every(v => Math.abs(v[0]) <= half && Math.abs(v[1]) <= half && Math.abs(v[2]) <= halfH);
  for (let tries = 0; g.X.length < count && tries < count * 60; tries++) {
    const open = free.map((f, k) => (f.size ? k : -1)).filter(k => k >= 0);
    if (!open.length) break;
    // Fill outward from the oldest pieces first, so the box fills as a grid rather than a long arm.
    const at = r.next() < 0.7 ? open[Math.floor(r.next() * Math.min(open.length, 3))] : r.pick(open);
    const P = byId.get(g.types[at])!, i = r.pick([...free[at]]);
    const kind = r.next() < 0.15 ? weighted(allowed, steer.weights, r) : weighted(growers, steer.weights, r);
    const j = r.int(0, kind.slits.length - 1), psi = r.pick([Math.PI / 2, (3 * Math.PI) / 2]);
    if (weakJoint(P, kind)) continue;
    const X = childFrame(g.X[at], P, i, kind, j, psi);
    const panel = makePanel(g.X.length, String(g.X.length + 1), 'module', kind.outline, frameOf(X), t, kind.cuts);
    if (!inside(panel)) { if (r.next() < 0.3) free[at].delete(i); continue; }
    if (g.panels.some(q => panelDepth(panel, q) > 0)) continue;
    const dir = rotate(g.X[at], [P.slits[i].d[0], P.slits[i].d[1], 0]), back = scale(dir, -1);
    if (pathBlocker(panel, scale(back, exitDistance(panel, g.panels, back)), g.panels) !== null) continue;
    free[at].delete(i);
    free.push(new Set(kind.slits.map((_, k) => k).filter(k => k !== j)));
    g.joints.push({child: g.X.length, parent: at, childSlit: j, parentSlit: i});
    g.types.push(kind.id); g.X.push(X); g.travel.push(dir); g.panels.push(panel);
  }
  return g.X.length >= Math.max(4, Math.ceil(count * 0.6)) ? g : null;
}

/** Turns of a piece about its centre that map its slit set onto itself (k-fold symmetry), as slit-index steps. */
export function slitSymmetry(p: Piece): {k: number; step: number}[] {
  const n = p.slits.length, out: {k: number; step: number}[] = [];
  if (n < 3) return out;
  for (let k = n; k >= 3; k--) {
    if (n % k) continue;
    const a = (2 * Math.PI) / k, c = Math.cos(a), s = Math.sin(a);
    const turn = (q: V2): V2 => [q[0] * c - q[1] * s, q[0] * s + q[1] * c];
    const same = (u: V2, v: V2) => Math.hypot(u[0] - v[0], u[1] - v[1]) < 1e-6;
    // Every slit turned must land on a slit (mouth and direction), with a constant index step.
    const step = p.slits.findIndex(sl => same(sl.e, turn(p.slits[0].e)) && same(sl.d, turn(p.slits[0].d)));
    if (step <= 0) continue;
    if (p.slits.every((sl, i) => { const q = p.slits[(i + step) % n]; return same(q.e, turn(sl.e)) && same(q.d, turn(sl.d)); })) out.push({k, step});
  }
  return out;
}

/**
 * Symmetric growth: a flat centre piece with k-fold symmetric slits; one arm grown from its first slit; the arm
 * copied by turns of 2π/k about the vertical axis onto the matching slits. The whole design then has k-fold
 * symmetry about that axis, so its centre of mass lies on the axis and every orbit of points is level: the feet
 * stand level, and the highest points form a level ring a cover can sit on.
 */
export function growSymmetric(pieces: Piece[], count: number, t: number, r: Rng, steer: Steer = {}): Grown | null {
  const centres = pieces.flatMap(p => slitSymmetry(p).map(s => ({p, ...s})));
  if (!centres.length) return null;
  const {p: centre, k, step} = r.pick(centres);
  const n = centre.slits.length, perArm = Math.max(1, Math.round((count - 1) / k));
  const allowed = pieces.filter(p => (steer.weights?.[p.id] ?? 1) > 0);
  const growers = allowed.filter(p => p.slits.length >= 2);
  if (!growers.length) return null;
  const byId = new Map(pieces.map(p => [p.id, p]));
  // Grow one arm off centre slit 0, checking it against the centre and itself.
  const arm: Grown = {types: [centre.id], X: [IDENTITY], joints: [], travel: [null], panels: [makePanel(0, '1', 'module', centre.outline, frameOf(IDENTITY), t, centre.cuts)]};
  const free: Set<number>[] = [new Set()];
  const place = (at: number, i: number, kind: Piece, j: number, psi: number) => {
    const P = byId.get(arm.types[at])!;
    if (weakJoint(P, kind)) return false;
    const X = childFrame(arm.X[at], P, i, kind, j, psi);
    const panel = makePanel(arm.X.length, String(arm.X.length + 1), 'module', kind.outline, frameOf(X), t, kind.cuts);
    if (arm.panels.some(q => panelDepth(panel, q) > 0)) return false;
    const dir = rotate(arm.X[at], [P.slits[i].d[0], P.slits[i].d[1], 0]), back = scale(dir, -1);
    if (pathBlocker(panel, scale(back, exitDistance(panel, arm.panels, back)), arm.panels) !== null) return false;
    arm.joints.push({child: arm.X.length, parent: at, childSlit: j, parentSlit: i});
    arm.types.push(kind.id); arm.X.push(X); arm.travel.push(dir); arm.panels.push(panel);
    free.push(new Set(kind.slits.map((_, q) => q).filter(q => q !== j)));
    return true;
  };
  let ok = false;
  for (let tries = 0; tries < 30 && !ok; tries++) {
    const kind = weighted(growers, steer.weights, r);
    ok = place(0, 0, kind, r.int(0, kind.slits.length - 1), r.pick([Math.PI / 2, (3 * Math.PI) / 2]));
  }
  if (!ok) return null;
  for (let tries = 0; arm.X.length < 1 + perArm && tries < perArm * 60; tries++) {
    const open = free.map((f, at) => (at > 0 && f.size ? at : -1)).filter(at => at > 0);
    if (!open.length) break;
    const at = r.pick(open), i = r.pick([...free[at]]);
    const kind = arm.X.length >= perArm || r.next() < 0.2 ? weighted(allowed.filter(p => p.slits.length >= 1), steer.weights, r) : weighted(growers, steer.weights, r);
    if (place(at, i, kind, r.int(0, kind.slits.length - 1), r.pick([Math.PI / 2, (3 * Math.PI) / 2]))) free[at].delete(i);
  }
  // Copy the arm round: turn m maps centre slit 0 to slit m·step and every arm piece with it.
  const g: Grown = {types: [centre.id], X: [IDENTITY], joints: [], travel: [null], panels: [arm.panels[0]]};
  const armLen = arm.X.length - 1;
  for (let m = 0; m < k; m++) {
    const a = (2 * Math.PI * m) / k, c = Math.cos(a), sn = Math.sin(a), turn: Xf = {R: [c, -sn, 0, sn, c, 0, 0, 0, 1], t: [0, 0, 0]};
    const base = g.X.length;
    for (let q = 1; q <= armLen; q++) {
      const X = compose(turn, arm.X[q]), id = g.X.length;
      const panel = makePanel(id, String(id + 1), 'module', byId.get(arm.types[q])!.outline, frameOf(X), t, byId.get(arm.types[q])!.cuts);
      if (g.panels.some(o => panelDepth(panel, o) > 0)) return null; // arms run into each other
      g.types.push(arm.types[q]); g.X.push(X); g.travel.push(rotate(turn, arm.travel[q]!)); g.panels.push(panel);
    }
    for (const j of arm.joints) {
      const parent = j.parent === 0 ? 0 : base + j.parent - 1;
      g.joints.push({child: base + j.child - 1, parent, childSlit: j.childSlit, parentSlit: j.parent === 0 ? (j.parentSlit + m * step) % n : j.parentSlit});
    }
  }
  repose(g, IDENTITY.R);
  return g;
}

/** Principal axes of a point set: longest by power iteration on the covariance, then the next, then their cross product. */
function principalAxes(pts: V3[]): {major: V3; minor: V3} {
  const m = scale(pts.reduce((s, p) => add(s, p), [0, 0, 0] as V3), 1 / pts.length);
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of pts) { const q = sub(p, m); for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a * 3 + b] += q[a] * q[b]; }
  const power = (M: number[]) => { let v: V3 = [0.3, 0.5, 0.8]; for (let k = 0; k < 80; k++) v = norm(rotate({R: M, t: [0, 0, 0]}, v)); return v; };
  const major = power(C), Cm = rotate({R: C, t: [0, 0, 0]}, major), lam = major[0] * Cm[0] + major[1] * Cm[1] + major[2] * Cm[2];
  const mid = power(C.map((x, i) => x - lam * major[Math.floor(i / 3)] * major[i % 3]));
  const minor = norm([major[1] * mid[2] - major[2] * mid[1], major[2] * mid[0] - major[0] * mid[2], major[0] * mid[1] - major[1] * mid[0]]);
  return {major, minor};
}

/**
 * Stand the design on its convex hull: towers on the face across their long axis, the rest on whichever tips last.
 * With `up`, a face within 15° of across it if one stands (a random design on the floor it grew from), else the
 * steadiest face. With `orFall`, a design with no such face that stands is still set on the best of them, its
 * intended pose (a tower upright), and comes back marked `fell`: shown that way it needs propping.
 */
export function standUp(g: Grown, intent: Intent, up?: V3, orFall = false): {tipDeg: number; R: number[]; fell?: boolean} | null {
  const pts = g.panels.flatMap(panelVertices), {com} = massProps(g.panels);
  // Towers stand on their long axis; spreads lie down on their thinnest direction; others take the steadiest face.
  const ax = intent === 'spread' ? principalAxes(pts) : null;
  // A tower grows as a chain, so its axis runs from the first piece to the last.
  const chainAxis = norm(sub(g.panels[g.panels.length - 1].frame.o, g.panels[0].frame.o));
  const intended = restingPose(pts, com, up ? {axis: up, maxTiltDeg: 15} : ax || intent === 'tower' ? {axis: intent === 'tower' ? chainAxis : ax!.minor, maxTiltDeg: intent === 'tower' ? 35 : 40} : undefined);
  let rest = intended;
  // A random design that will not stand on its floor turns to its steadiest face, unless it may be shown falling.
  if (up && !(rest.tipDeg > 4) && !(orFall && Number.isFinite(intended.tipDeg))) rest = restingPose(pts, com);
  if (!(rest.tipDeg > 4)) {
    if (!orFall || !Number.isFinite(intended.tipDeg)) return null;
    repose(g, intended.R);
    return {tipDeg: intended.tipDeg, R: intended.R, fell: true};
  }
  repose(g, rest.R);
  return {tipDeg: rest.tipDeg, R: rest.R};
}

/** Rotate a grown design by R about the origin, then set it on the floor (lowest point z = 0), centred. */
export function repose(g: Grown, R: number[]) {
  const turn: Xf = {R, t: [0, 0, 0]};
  g.X = g.X.map(x => compose(turn, x));
  g.travel = g.travel.map(d => (d ? rotate(turn, d) : null));
  g.panels.forEach((p, k) => { p.frame = frameOf(g.X[k]); });
  const v = g.panels.flatMap(panelVertices);
  const z0 = Math.min(...v.map(p => p[2])), cx = (Math.min(...v.map(p => p[0])) + Math.max(...v.map(p => p[0]))) / 2, cy = (Math.min(...v.map(p => p[1])) + Math.max(...v.map(p => p[1]))) / 2;
  const shift: V3 = [-cx, -cy, -z0];
  g.X = g.X.map(x => ({R: x.R, t: add(x.t, shift)}));
  g.panels.forEach((p, k) => { p.frame = frameOf(g.X[k]); });
}


/** Keep only pieces whose index passes `keep`, renumbering everything (panel ids must equal their index). */
function subset(g: Grown, keep: (k: number) => boolean): Grown {
  const idx = g.types.map((_, k) => k).filter(keep), map = new Map(idx.map((k, n) => [k, n]));
  const panels = idx.map(k => g.panels[k]);
  panels.forEach((p, n) => { p.id = n; p.name = String(n + 1); });
  return {
    types: idx.map(k => g.types[k]), X: idx.map(k => g.X[k]), travel: idx.map(k => g.travel[k]), panels,
    joints: g.joints.filter(j => map.has(j.child) && map.has(j.parent)).map(j => ({...j, child: map.get(j.child)!, parent: map.get(j.parent)!})),
  };
}

/**
 * End pieces hang on a single joint (and a piece in a half disc's notch is held from one side only). Once the
 * design stands, ask the engine's own hold test which end pieces gravity can pull out, prune them (repeatedly:
 * pruning exposes new ends), then trim the newest end pieces down to `count`.
 */
export function pruneLoose(g: Grown, count: number, clearance: number): Grown {
  const ends = (h: Grown) => {
    const kids = new Map<number, number>();
    for (const j of h.joints) kids.set(j.parent, (kids.get(j.parent) ?? 0) + 1);
    const out = h.joints.map(j => j.child).filter(k => !kids.has(k));
    if (kids.get(0) === 1) out.push(0);
    return out;
  };
  for (let round = 0; round < 50; round++) {
    const z0 = Math.min(...g.panels.flatMap(panelVertices).map(v => v[2]));
    const drop = new Set(ends(g).filter(k => partHold(g.panels[k], g.panels.filter((_, i) => i !== k), z0, 1.5 + clearance).hold === 'loose'));
    if (!drop.size) break;
    g = subset(g, k => !drop.has(k));
  }
  while (g.types.length > count) {
    const e = ends(g).filter(k => k !== 0);
    if (!e.length) break;
    const last = Math.max(...e);
    g = subset(g, k => k !== last);
  }
  return g;
}
