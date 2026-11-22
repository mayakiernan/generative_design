/**
 * The Circular kit as a lattice.
 *
 * A joint puts two full discs' centres p = 2R − 2ℓ apart along the slit line (R radius, ℓ slit length), in
 * perpendicular planes (see childFrame in kits.ts: mouths ℓ_P + ℓ_Q apart, facing back, turned 90° about the line).
 * Every disc slit runs radially along a quarter turn of its own plane, so starting from one disc every disc of a
 * design sits on a cubic lattice of pitch p, with its plane square to an axis and its slit mouths along axes.
 * grids.ts uses the same pitch: columns 2p apart, layers p apart.
 *
 * A disc is a Pose: lattice point c, normal axis a (0 x, 1 y, 2 z) and its mouths, a bitmask over the six axis
 * directions (all square to a). One, two at 90°, two at 180° or three mouths are the pieces C1, C2L, C2I, C3T.
 *
 * Half discs. H1 (one slit from the middle of the curved edge toward the flat edge) has its slit along a radius
 * like C1, so its circle centre sits on the lattice; its material is the half on its slit's side. H (two notches
 * along its straight edge, flush with it) has both notches on one line half a slit width off its diameter, so its
 * lattice point is the middle of that notch line and `s` says which side of the line its material lies. Its
 * partners then sit 0.03 mm farther than the true joint would put them, well inside the slit clearance; the
 * overlap test runs on the real panels either way. Two H are never joined notch to notch (kits.ts weakJoint). A
 * lattice point holds one piece.
 *
 * Geometry is exact: each pair of poses that can touch (centres one lattice step apart in each coordinate or less)
 * is tested once with the separating-axis test on the real panels and memoised. Discs whose centres are two or
 * more steps apart in any coordinate are 2p > 2R apart and cannot touch.
 */
import {childFrame, finishPieces, type Piece} from '../kits.js';
import {frameOf, IDENTITY} from '../kit.js';
import {panelBox, panelDepth, pathBlocker} from '../collide.js';
import {cross, norm, scale, type V3} from '../math.js';
import {makePanel, type Frame, type Panel} from '../panel.js';

/** The six axis directions: +x, −x, +y, −y, +z, −z. The opposite of d is d ^ 1; its axis is d >> 1. */
export const DIRS: readonly V3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const DIR_NAMES = ['+x', '−x', '+y', '−y', '+z', '−z'] as const;
export const axisOf = (d: number) => d >> 1;
export const opposite = (d: number) => d ^ 1;

export type Axis = 0 | 1 | 2;
export type Cell = [number, number, number];
/** k: a half disc (absent for full discs). s: for H, the side of its notch line its material lies (a direction). */
export interface Pose {c: Cell; a: Axis; m: number; k?: 'H' | 'H1'; s?: number}
export const FULL_PIECES = ['C1', 'C2L', 'C2I', 'C3T'] as const;
export const HALF_PIECES = ['H', 'H1'] as const;
export type FullPiece = (typeof FULL_PIECES)[number];
export type PieceId = FullPiece | (typeof HALF_PIECES)[number];

const bits = (m: number) => { let n = 0; for (let d = 0; d < 6; d++) if (m & (1 << d)) n++; return n; };
export const mouthCount = bits;
export const mouths = (m: number) => [0, 1, 2, 3, 4, 5].filter(d => m & (1 << d));
/** Directions square to axis a (the ones a disc in that plane can point a slit along). */
export const inPlane = (a: Axis) => [0, 1, 2, 3, 4, 5].filter(d => axisOf(d) !== a);

/** Which piece a mouth set is, or null if no disc has it (none, four, or a slit out of plane). */
export function pieceOf(a: Axis, m: number): FullPiece | null {
  if (!m || mouths(m).some(d => axisOf(d) === a)) return null;
  const n = bits(m);
  if (n === 1) return 'C1';
  if (n === 3) return 'C3T';
  if (n === 2) { const [d0, d1] = mouths(m); return opposite(d0) === d1 ? 'C2I' : 'C2L'; }
  return null;
}

/** The kit piece a pose is, or null if no piece fits it. */
export function pieceId(p: Pose): PieceId | null {
  if (!p.k) return pieceOf(p.a, p.m);
  const ds = mouths(p.m);
  if (ds.some(d => axisOf(d) === p.a)) return null;
  if (p.k === 'H1') return ds.length === 1 ? 'H1' : null;
  return ds.length === 2 && opposite(ds[0]) === ds[1] && p.s !== undefined && axisOf(p.s) !== p.a && axisOf(p.s) !== axisOf(ds[0]) ? 'H' : null;
}

/** How many lattice steps a piece reaches: an H's material runs a slit half-width past R from its lattice point. */
const reach = (p: Pose) => (p.k === 'H' ? 2 : 1);
/** A pose's shape, for memo keys. */
const shapeKey = (p: Pose) => `${p.a},${p.m}${p.k === 'H1' ? ',H1' : p.k === 'H' ? `,Hs${p.s}` : ''}`;
const at0 = (p: Pose, c: Cell = [0, 0, 0]): Pose => ({...p, c});

export const cellKey = (c: Cell) => `${c[0]},${c[1]},${c[2]}`;
export const step = (c: Cell, d: number): Cell => [c[0] + DIRS[d][0], c[1] + DIRS[d][1], c[2] + DIRS[d][2]];

/** Everything about one kit at one size and sheet that the lattice needs. Overlaps are memoised per kit. */
export interface Kit {
  size: number; t: number; clearance: number;
  /** Lattice pitch (centre spacing of two joined discs), mm. */
  p: number;
  R: number;
  pieces: Map<string, Piece>;
  /** Panel at the origin for each (axis, mouths), and its frame axes. */
  base: Map<string, Panel>;
  overlapMemo: Map<string, boolean>;
  slideMemo: Map<string, boolean>;
  nudgeMemo: Map<string, boolean>;
}

export function makeKit(size = 80, t = 3, clearance = 0.2): Kit {
  const pieces = new Map(finishPieces('circle', size, t, clearance).map(p => [p.id, p]));
  const C2I = pieces.get('C2I')!;
  const p = Math.hypot(...frameOf(childFrame(IDENTITY, C2I, 0, C2I, 0, Math.PI / 2)).o);
  return {size, t, clearance, p, R: size / 2, pieces, base: new Map(), overlapMemo: new Map(), slideMemo: new Map(), nudgeMemo: new Map()};
}

/** Frame axes (u, v, n) putting piece `id` in plane a with its slit mouths exactly along `m`. */
function axesFor(piece: Piece, a: Axis, m: number): {u: V3; v: V3; n: V3} {
  const local = piece.slits.map(s => { const l = Math.hypot(s.e[0], s.e[1]); return [Math.round(s.e[0] / l), Math.round(s.e[1] / l)]; });
  const want = mouths(m).sort().join(',');
  for (const du of inPlane(a)) for (const dv of inPlane(a)) {
    if (axisOf(du) === axisOf(dv)) continue;
    const u = DIRS[du], v = DIRS[dv];
    const got = local.map(([x, y]) => dirIndex([u[0] * x + v[0] * y, u[1] * x + v[1] * y, u[2] * x + v[2] * y])).sort().join(',');
    if (got === want) return {u, v, n: cross(u, v)};
  }
  throw new Error(`no frame puts ${piece.id} in plane ${a} with mouths ${want}`);
}

/** Index of an axis direction vector (within rounding), or −1. */
export function dirIndex(v: V3): number {
  for (let d = 0; d < 6; d++) if (Math.abs(v[0] - DIRS[d][0]) + Math.abs(v[1] - DIRS[d][1]) + Math.abs(v[2] - DIRS[d][2]) < 1e-6) return d;
  return -1;
}

function basePanel(kit: Kit, pose: Pose): Panel {
  const key = shapeKey(pose);
  let P = kit.base.get(key);
  if (!P) {
    const id = pieceId(pose);
    if (!id) throw new Error(`no piece has mouths ${mouths(pose.m).map(d => DIR_NAMES[d]).join(' ')} in plane ${'xyz'[pose.a]}${pose.k ? ` as ${pose.k}` : ''}`);
    const piece = kit.pieces.get(id)!;
    let frame: Frame;
    if (id === 'H') {
      // Local x runs along the notch line, local −y is the material side; the circle centre sits half a slit width
      // from the notch line, on the far side from the material, so the lattice point is the notch line's middle.
      const u = DIRS[mouths(pose.m)[0]], v: V3 = scale(DIRS[pose.s!], -1), half = piece.w / 2;
      frame = {o: scale(DIRS[pose.s!], -half), u, v, n: cross(u, v)};
    } else {
      const {u, v, n} = axesFor(piece, pose.a, pose.m);
      frame = {o: [0, 0, 0], u, v, n};
    }
    P = makePanel(0, id, 'module', piece.outline, frame, kit.t, piece.cuts);
    kit.base.set(key, P);
  }
  return P;
}

/** The real panel for a pose (id = index), at its lattice point. */
export function posePanel(kit: Kit, pose: Pose, id: number): Panel {
  const B = basePanel(kit, pose), o: V3 = [B.frame.o[0] + pose.c[0] * kit.p, B.frame.o[1] + pose.c[1] * kit.p, B.frame.o[2] + pose.c[2] * kit.p];
  const frame: Frame = {...B.frame, o};
  return {...B, id, name: String(id + 1), frame};
}

/** Do two poses' panels interpenetrate? Exact (SAT on the convex pieces), memoised on their relative placement. */
export function overlaps(kit: Kit, A: Pose, B: Pose): boolean {
  const dx = B.c[0] - A.c[0], dy = B.c[1] - A.c[1], dz = B.c[2] - A.c[2], r = Math.max(reach(A), reach(B));
  if (Math.abs(dx) > r || Math.abs(dy) > r || Math.abs(dz) > r) return false;
  if (!dx && !dy && !dz) return true;
  const key = `${dx},${dy},${dz}|${shapeKey(A)}|${shapeKey(B)}`;
  let hit = kit.overlapMemo.get(key);
  if (hit === undefined) {
    const PA = posePanel(kit, at0(A), 0), PB = posePanel(kit, at0(B, [dx, dy, dz]), 1);
    hit = panelDepth(PA, PB) > 0;
    kit.overlapMemo.set(key, hit);
  }
  return hit;
}

/**
 * Would A, slid along DIRS[d] until it is clear of everything, run into B? That depends only on where B is relative
 * to A and on both poses: B two or more steps off the slide line is out of reach, B behind A cannot be hit, and B
 * two or more steps ahead is hit or missed the same at any distance. Exact (swept SAT), memoised.
 */
export function slideBlocked(kit: Kit, A: Pose, B: Pose, d: number): boolean {
  const k = axisOf(d), s = DIRS[d][k], D = [B.c[0] - A.c[0], B.c[1] - A.c[1], B.c[2] - A.c[2]], r = Math.max(reach(A), reach(B));
  for (let i = 0; i < 3; i++) if (i !== k && Math.abs(D[i]) > r) return false;
  const along = D[k] * s;
  if (along < -r) return false;
  D[k] = Math.min(along, r + 1) * s;
  const key = `${D.join(',')}|${shapeKey(A)}|${shapeKey(B)}|${d}`;
  let hit = kit.slideMemo.get(key);
  if (hit === undefined) {
    const PA = posePanel(kit, at0(A), 0), PB = posePanel(kit, at0(B, D as Cell), 1);
    hit = pathBlocker(PA, scale(DIRS[d], 8 * kit.p), [PB]) !== null;
    kit.slideMemo.set(key, hit);
  }
  return hit;
}

/** The 26 directions the engine's hold test probes (axes, face and body diagonals; plane normals and plane–plane lines are axes here). */
export const PROBES: readonly V3[] = [-1, 0, 1].flatMap(x => [-1, 0, 1].flatMap(y => [-1, 0, 1].map(z => [x, y, z] as V3))).filter(v => v.some(Boolean)).map(norm);

/** Does B stop A being nudged `nudge` mm along PROBES[k]? Memoised on the relative pose. */
function nudgeBlocked(kit: Kit, A: Pose, B: Pose, k: number, nudge: number): boolean {
  const D = [B.c[0] - A.c[0], B.c[1] - A.c[1], B.c[2] - A.c[2]], r = Math.max(reach(A), reach(B));
  if (D.some(x => Math.abs(x) > r)) return false;
  const key = `${D.join(',')}|${shapeKey(A)}|${shapeKey(B)}|${k}|${nudge}`;
  let hit = kit.nudgeMemo.get(key);
  if (hit === undefined) {
    const PA = posePanel(kit, at0(A), 0), PB = posePanel(kit, at0(B, D as Cell), 1);
    hit = pathBlocker(PA, scale(PROBES[k], nudge), [PB]) !== null;
    kit.nudgeMemo.set(key, hit);
  }
  return hit;
}

/**
 * Discs gravity can pull out: the engine's hold test (stability.ts partHold, 'loose'), on the lattice. A disc is
 * loose if some probe direction pointing down more than a little is free; a disc on the floor cannot go down.
 */
export function looseDiscs(kit: Kit, form: Form, panels = form.panels(kit)): number[] {
  const nudge = 1.5 + kit.clearance, z0 = Math.min(...panels.map(P => panelBox(P).lo[2])), r = form.hasH ? 2 : 1;
  const out: number[] = [];
  form.discs.forEach((A, i) => {
    const onGround = panelBox(panels[i]).lo[2] <= z0 + 0.05, near: Pose[] = [];
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
      const j = form.at.get(cellKey([A.c[0] + dx, A.c[1] + dy, A.c[2] + dz]));
      if (j !== undefined && j !== i) near.push(form.discs[j]);
    }
    const free = PROBES.some((v, k) => v[2] < -0.2 && !(onGround && v[2] < -1e-6) && !near.some(B => nudgeBlocked(kit, A, B, k, nudge)));
    if (free) out.push(i);
  });
  return out;
}

/** A joint: disc i's slit d takes disc j's slit d ^ 1 (j is one step from i along d, planes square). */
export interface Joint {i: number; j: number; d: number}

/** A form: discs on the lattice, with an index from lattice point to disc. */
export class Form {
  readonly discs: Pose[];
  readonly at: Map<string, number>;
  /** Some piece is an H, whose material reaches two lattice steps. */
  readonly hasH: boolean;
  constructor(discs: Pose[]) {
    this.discs = discs;
    this.at = new Map(discs.map((p, i) => [cellKey(p.c), i]));
    this.hasH = discs.some(p => p.k === 'H');
  }
  get size() { return this.discs.length; }
  /** Every joint once (i < j). */
  joints(): Joint[] {
    const out: Joint[] = [];
    this.discs.forEach((P, i) => {
      for (const d of mouths(P.m)) {
        const j = this.at.get(cellKey(step(P.c, d)));
        if (j === undefined || j < i) continue;
        const Q = this.discs[j];
        if (Q.m & (1 << opposite(d)) && Q.a !== P.a) out.push({i, j, d});
      }
    });
    return out;
  }
  /** Slits whose mouth faces an empty lattice point: (disc, direction). */
  openSlits(): [number, number][] {
    const out: [number, number][] = [];
    this.discs.forEach((P, i) => { for (const d of mouths(P.m)) if (!this.at.has(cellKey(step(P.c, d)))) out.push([i, d]); });
    return out;
  }
  /** Can `pose` join this form without running into anything? (It need not join anything.) */
  fits(kit: Kit, pose: Pose, skip = -1): boolean {
    if (!pieceId(pose)) return false;
    // Two H are never joined notch to notch: the joint barely engages.
    if (pose.k === 'H') for (const d of mouths(pose.m)) {
      const j = this.at.get(cellKey(step(pose.c, d))), Q = j === undefined || j === skip ? null : this.discs[j];
      if (Q?.k === 'H' && Q.m & (1 << opposite(d)) && Q.a !== pose.a) return false;
    }
    const r = pose.k === 'H' || this.hasH ? 2 : 1;
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
      const j = this.at.get(cellKey([pose.c[0] + dx, pose.c[1] + dy, pose.c[2] + dz]));
      if (j !== undefined && j !== skip && overlaps(kit, pose, this.discs[j])) return false;
    }
    return true;
  }
  with(pose: Pose): Form { return new Form([...this.discs, pose]); }
  without(k: number): Form { return new Form(this.discs.filter((_, i) => i !== k)); }
  replace(k: number, pose: Pose): Form { return new Form(this.discs.map((p, i) => (i === k ? pose : p))); }
  /** Panels in disc order (panel id = disc index), in lattice coordinates × p. */
  panels(kit: Kit): Panel[] { return this.discs.map((p, i) => posePanel(kit, p, i)); }
}

/** Is the form one piece, joined through its slits? */
export function connected(form: Form, joints = form.joints()): boolean {
  const n = form.size;
  if (n <= 1) return true;
  const adj: number[][] = Array.from({length: n}, () => []);
  for (const {i, j} of joints) { adj[i].push(j); adj[j].push(i); }
  const seen = new Set([0]), todo = [0];
  while (todo.length) for (const k of adj[todo.pop()!]) if (!seen.has(k)) { seen.add(k); todo.push(k); }
  return seen.size === n;
}

/**
 * The poses a new piece can take on the far side of open slit d of `from`: square plane, a slit facing back. Full
 * discs with any other slits; an H1 (its material toward `from`); an H with its notch line along d, material to
 * either side (never onto another H).
 */
export function posesOnto(from: Pose, d: number, halves = true): Pose[] {
  const c = step(from.c, d), back = opposite(d);
  const a = ([0, 1, 2] as Axis[]).find(x => x !== from.a && x !== axisOf(d))!;
  const others = inPlane(a).filter(x => x !== back);
  const out: Pose[] = [];
  for (let mask = 0; mask < 8; mask++) {
    const m = (1 << back) | others.reduce((s, x, k) => (mask & (1 << k) ? s | (1 << x) : s), 0);
    if (pieceOf(a, m)) out.push({c, a, m});
  }
  if (halves) {
    out.push({c, a, m: 1 << back, k: 'H1'});
    if (from.k !== 'H') for (const s of [2 * from.a, 2 * from.a + 1]) out.push({c, a, m: (1 << back) | (1 << d), k: 'H', s});
  }
  return out;
}

/* ---------- symmetry and canonical keys ---------- */

/** The 8 symmetries of the square about the vertical (gravity fixes z): (x, y) → M (x, y). */
const D4: [number, number, number, number][] = [
  [1, 0, 0, 1], [0, -1, 1, 0], [-1, 0, 0, -1], [0, 1, -1, 0],
  [-1, 0, 0, 1], [1, 0, 0, -1], [0, 1, 1, 0], [0, -1, -1, 0],
];
const mapDir = (M: number[], d: number) => {
  const v = DIRS[d];
  return dirIndex([M[0] * v[0] + M[1] * v[1], M[2] * v[0] + M[3] * v[1], v[2]]);
};
const DIR_MAP = D4.map(M => [0, 1, 2, 3, 4, 5].map(d => mapDir(M, d)));

/** Direction d after symmetry k. */
export const transformDir = (d: number, k: number) => DIR_MAP[k][d];

export function transformPose(p: Pose, k: number): Pose {
  const M = D4[k], map = DIR_MAP[k];
  const c: Cell = [M[0] * p.c[0] + M[1] * p.c[1], M[2] * p.c[0] + M[3] * p.c[1], p.c[2]];
  const a = (p.a === 2 ? 2 : axisOf(map[2 * p.a])) as Axis;
  let m = 0;
  for (const d of mouths(p.m)) m |= 1 << map[d];
  const out: Pose = {c: c.map(x => x + 0) as Cell, a, m};
  if (p.k) out.k = p.k;
  if (p.s !== undefined) out.s = map[p.s];
  return out;
}

function keyOf(discs: Pose[]): string {
  const lo = [0, 1, 2].map(k => Math.min(...discs.map(p => p.c[k])));
  return discs.map(p => `${p.c[0] - lo[0]},${p.c[1] - lo[1]},${p.c[2] - lo[2]},${shapeKey(p)}`).sort().join(';');
}

/** The same key for a form however it is turned or mirrored about the vertical, or slid. */
export function canonicalKey(form: Form | Pose[]): string {
  const discs = form instanceof Form ? form.discs : form;
  let best = '';
  for (let k = 0; k < 8; k++) { const s = keyOf(discs.map(p => transformPose(p, k))); if (!best || s < best) best = s; }
  return best;
}

/**
 * The joined structure, ignoring slits that join nothing: the canonical key of the form with every disc cut down to
 * its joined slits. Two forms with the same skeleton differ only in which kit piece fills a place.
 */
export function skeletonKey(form: Form): string {
  const keep = form.discs.map(() => 0);
  for (const {i, j, d} of form.joints()) { keep[i] |= 1 << d; keep[j] |= 1 << opposite(d); }
  // A half disc's slits come with the piece, so it keeps them.
  return canonicalKey(form.discs.map((p, i) => ({...p, m: p.k ? p.m : keep[i] || p.m})));
}

/** How many of the 8 symmetries map the form onto itself (1, 2, 4 or 8). */
export function symmetryOrder(form: Form): number {
  const own = keyOf(form.discs);
  let n = 0;
  for (let k = 0; k < 8; k++) if (keyOf(form.discs.map(p => transformPose(p, k))) === own) n++;
  return n;
}

/** Rebuild a form from a canonical key. */
export function fromKey(key: string): Form {
  return new Form(key.split(';').map(str => {
    const f = str.split(','), [x, y, z, a, m] = f.slice(0, 5).map(Number), pose: Pose = {c: [x, y, z], a: a as Axis, m};
    // 'H1' is the one-slit half disc; 'Hs<d>' a notched half disc with its material toward direction d.
    if (f[5] === 'H1') pose.k = 'H1';
    else if (f[5]?.startsWith('Hs')) { pose.k = 'H'; pose.s = Number(f[5].slice(2)); }
    return pose;
  }));
}

/** Piece mix: how many of each kit piece. */
export function pieceMix(form: Form): Record<PieceId, number> {
  const out: Record<PieceId, number> = {C1: 0, C2L: 0, C2I: 0, C3T: 0, H: 0, H1: 0};
  for (const p of form.discs) out[pieceId(p)!]++;
  return out;
}

/**
 * Map a design's panels (kit pieces, as grown or gridded) onto lattice poses, or say why they are off it. Joints
 * through an H's notch sit 0.03 mm short of the lattice spacing, so positions are rounded to within 0.3 mm.
 */
export function latticeOf(kit: Kit, panels: Panel[], types: string[]): Form | {why: string} {
  const read = (k: number): {ref: V3; pose: Omit<Pose, 'c'>} | {why: string} => {
    const piece = kit.pieces.get(types[k]), f = panels[k].frame;
    if (!piece || ![...FULL_PIECES, ...HALF_PIECES].includes(types[k] as PieceId)) return {why: `piece ${k + 1} is ${types[k]}, not a kit piece`};
    const ai = [0, 1, 2].findIndex(i => Math.abs(Math.abs(f.n[i]) - 1) < 1e-6);
    if (ai < 0) return {why: `piece ${k + 1} is not square to an axis`};
    const a = ai as Axis;
    if (types[k] === 'H') {
      const e = dirIndex(f.u), s = dirIndex(scale(f.v, -1));
      if (e < 0 || s < 0) return {why: `piece ${k + 1} is turned off the axes`};
      return {ref: [f.o[0] + (piece.w / 2) * DIRS[s][0], f.o[1] + (piece.w / 2) * DIRS[s][1], f.o[2] + (piece.w / 2) * DIRS[s][2]], pose: {a, m: (1 << e) | (1 << opposite(e)), k: 'H', s}};
    }
    let m = 0;
    for (const sl of piece.slits) {
      const l = Math.hypot(sl.e[0], sl.e[1]), x = sl.e[0] / l, y = sl.e[1] / l;
      const d = dirIndex([f.u[0] * x + f.v[0] * y, f.u[1] * x + f.v[1] * y, f.u[2] * x + f.v[2] * y]);
      if (d < 0) return {why: `piece ${k + 1} has a slit off the axes`};
      m |= 1 << d;
    }
    return {ref: f.o, pose: types[k] === 'H1' ? {a, m, k: 'H1'} : {a, m}};
  };
  const first = read(0);
  if ('why' in first) return first;
  const discs: Pose[] = [];
  for (let k = 0; k < panels.length; k++) {
    const r = k ? read(k) : first;
    if ('why' in r) return r;
    const c = [0, 1, 2].map(i => (r.ref[i] - first.ref[i]) / kit.p);
    if (c.some(x => Math.abs(x - Math.round(x)) * kit.p > 0.3)) return {why: `piece ${k + 1} is off the lattice`};
    discs.push({...r.pose, c: c.map(Math.round) as Cell});
  }
  return new Form(discs);
}
