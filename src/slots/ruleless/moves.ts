/**
 * Changes to a free form. Each places a kit piece where the pieces themselves allow, not where the kit's rules
 * say, and keeps it only if it runs into nothing and touches something:
 *  - lap:   slit into slit, as the kit intends (one pitch from a slit mouth);
 *  - clip:  a slit pushed onto a plain edge of another piece: along any axis in that piece's plane, at any offset
 *           across it, seated where the slit's bottom meets the edge (a lap is the case where the edge is a slit's
 *           bottom);
 *  - drop:  a piece in any square orientation, set down from above until it first touches (stacking, leaning on
 *           a rim, or a slit landing over an edge);
 *  - nudge: a piece slid a few millimetres along an axis (off-pitch joints, part-seated slits);
 *  - remove: a piece taken off.
 * Several slits sliding on at once is not a separate move: one new piece may make several contacts, and the build
 * search decides whether a group can slide in together.
 */
import {pathBlocker} from '../collide.js';
import type {Rng} from '../math.js';
import {DIRS, axisOf, inPlane, mouths, opposite, pieceId, pieceOf, posePanel, posesOnto, type Axis, type Cell, type Kit, type Pose} from '../atlas/lattice.js';
import type {Panel} from '../panel.js';
import {along, findContacts, hullOf} from './contacts.js';
import {fineKit, pitchSteps, STEP} from './free.js';
import {piecesOverlap} from './judge.js';

export type MoveKind = 'lap' | 'clip' | 'drop' | 'nudge' | 'remove';
export const MOVE_WEIGHTS: Record<MoveKind, number> = {lap: 0.3, clip: 0.3, drop: 0.15, nudge: 0.1, remove: 0.15};

/** Offsets across a piece for a clip's line, mm (from the piece's centre line). */
const CLIP_OFFSETS = [0, 8, 16, 24, 30, 35, 38].flatMap(x => (x ? [x, -x] : [0]));

interface Ctx {kit: Kit; fine: Kit; panels: Panel[]}
const ctxOf = (kit: Kit, form: Pose[]): Ctx => { const fine = fineKit(kit); return {kit, fine, panels: form.map((p, i) => posePanel(fine, p, i))}; };

/** Does a new pose run into any piece of the form? */
function clashes(c: Ctx, form: Pose[], pose: Pose, skip = -1): boolean {
  const P = posePanel(c.fine, pose, form.length);
  return form.some((q, i) => i !== skip && piecesOverlap(c.kit, pose, q, P, c.panels[i]));
}

/** Does the new pose touch the form (or the floor, if it reaches the form's lowest level)? */
function touches(c: Ctx, form: Pose[], pose: Pose): boolean {
  const P = posePanel(c.fine, pose, form.length), reach = (2 * c.kit.R + 2 * c.kit.t) / STEP;
  const near = form.map((q, i) => i).filter(i => form[i].c.every((x, k) => Math.abs(x - pose.c[k]) <= reach));
  const sub = [...near.map(i => c.panels[i]), P], cs = findContacts(sub), me = sub.length - 1;
  return cs.some(ct => ct.b >= 0 && (ct.a === me || ct.b === me));
}

/** Every valid mouth mask for a full disc in plane a that includes `must` (a direction bitmask). */
function masksWith(a: Axis, must: number): number[] {
  const out: number[] = [];
  for (let m = 1; m < 64; m++) if ((m & must) === must && pieceOf(a, m)) out.push(m);
  return out;
}

/* ---------- lap ---------- */

export function lap(kit: Kit, form: Pose[], r: Rng, c = ctxOf(kit, form)): Pose[] | null {
  const P = pitchSteps(kit);
  const slits = form.flatMap((p, i) => mouths(p.m).map(d => [i, d] as [number, number]));
  for (let tries = 0; tries < 8 && slits.length; tries++) {
    const [i, d] = r.pick(slits), A = form[i];
    const opts = posesOnto({...A, c: [0, 0, 0]}, d).map(p => ({...p, c: p.c.map((x, k) => A.c[k] + x * P) as Cell}));
    const ok = opts.filter(p => !clashes(c, form, p));
    if (ok.length) return [...form, r.pick(ok)];
  }
  return null;
}

/* ---------- clip ---------- */

/** All clip poses of a piece shape onto piece i of the form along in-plane direction d (into the piece). */
export function clipPoses(kit: Kit, form: Pose[], i: number, d: number, offset: number, c: Ctx): Pose[] {
  const T = form[i], Pp = c.panels[i], a = axisOf(d), w = (3 - T.a - a) as Axis;
  if (a === T.a) return [];
  // The line: through the piece's mid-plane, offset across it along w, running along d.
  const p0: [number, number, number] = [0, 0, 0];
  p0[T.a] = Pp.frame.o[T.a];
  p0[w] = T.c[w] * STEP + offset;
  p0[a] = 0;
  const l = DIRS[d] as [number, number, number], {mat} = along(Pp, hullOf(Pp), p0, l);
  if (!mat.length) return [];
  // Entry: where the line first meets material, going along d.
  const enter = mat[0][0], piece = kit.pieces.get('C1')!, depth = piece.len, bottom = kit.R - depth - kit.clearance / 2;
  let grip = 0;
  for (const [s0, s1] of mat) grip += Math.max(0, Math.min(s1, enter + depth) - Math.max(s0, enter));
  if (grip < kit.t) return [];
  // The clip's centre: its slit bottom at the entry point, its mouth facing d. Round away from the piece.
  const centre = p0.slice() as number[];
  centre[a] = (enter - bottom) * DIRS[d][a];
  const cell = centre.map((x, k) => (k === a ? (DIRS[d][a] > 0 ? Math.floor(x / STEP + 1e-9) : Math.ceil(x / STEP - 1e-9)) : Math.round(x / STEP))) as Cell;
  const qa = w as Axis, out: Pose[] = [];
  for (const m of masksWith(qa, 1 << d)) out.push({c: cell, a: qa, m});
  out.push({c: cell, a: qa, m: 1 << d, k: 'H1'});
  return out;
}

export function clip(kit: Kit, form: Pose[], r: Rng, c = ctxOf(kit, form)): Pose[] | null {
  for (let tries = 0; tries < 10; tries++) {
    const i = r.int(0, form.length - 1), d = r.pick(inPlane(form[i].a)), off = r.pick(CLIP_OFFSETS);
    const opts = clipPoses(kit, form, i, d, off, c).filter(p => pieceId(p) && !clashes(c, form, p));
    const pick = opts.length ? r.pick(opts) : null;
    if (pick && touches(c, form, pick)) return [...form, pick];
  }
  return null;
}

/* ---------- drop ---------- */

/** A random kit piece in a random square orientation (at the origin). */
function randomShape(r: Rng): Pose {
  const a = r.int(0, 2) as Axis, u = r.next();
  if (u < 0.12) return {c: [0, 0, 0], a, m: 1 << r.pick(inPlane(a)), k: 'H1'};
  if (u < 0.24) {
    const d = r.pick(inPlane(a)), s = r.pick(inPlane(a).filter(x => axisOf(x) !== axisOf(d)));
    return {c: [0, 0, 0], a, m: (1 << d) | (1 << opposite(d)), k: 'H', s};
  }
  return {c: [0, 0, 0], a, m: r.pick(masksWith(a, 0))};
}

export function drop(kit: Kit, form: Pose[], r: Rng, c = ctxOf(kit, form)): Pose[] | null {
  const floor = Math.min(...c.panels.map(P => lowest(P))), roof = Math.max(...c.panels.map(P => highest(P)));
  for (let tries = 0; tries < 6; tries++) {
    const shape = randomShape(r), anchor = r.pick(form), offs = [0, kit.R / 2, -kit.R / 2, kit.R, -kit.R];
    const x = anchor.c[0] * STEP + r.pick(offs), y = anchor.c[1] * STEP + r.pick(offs);
    const start: Cell = [Math.round(x / STEP), Math.round(y / STEP), Math.round((roof + kit.R + 5) / STEP)];
    const Q = posePanel(c.fine, {...shape, c: start}, form.length), qLow = lowest(Q);
    const maxDrop = qLow - floor;
    if (maxDrop <= 0) continue;
    let landed = maxDrop;
    if (pathBlocker(Q, [0, 0, -maxDrop], c.panels) !== null) {
      let ok = 0, bad = maxDrop;
      for (let k = 0; k < 16 && bad - ok > 0.02; k++) { const mid = (ok + bad) / 2; if (pathBlocker(Q, [0, 0, -mid], c.panels) === null) ok = mid; else bad = mid; }
      landed = ok;
    }
    // Round the landing up to the grid so it never sinks in.
    const pose: Pose = {...shape, c: [start[0], start[1], Math.ceil((start[2] * STEP - landed) / STEP - 1e-9)]};
    if (clashes(c, form, pose)) continue;
    if (landed >= maxDrop - 0.05 || touches(c, form, pose)) return [...form, pose];
  }
  return null;
}

const lowest = (P: Panel) => Math.min(...P.pieces.flat().map(q => P.frame.o[2] + P.frame.u[2] * q[0] + P.frame.v[2] * q[1])) - Math.abs(P.frame.n[2]) * P.t / 2;
const highest = (P: Panel) => Math.max(...P.pieces.flat().map(q => P.frame.o[2] + P.frame.u[2] * q[0] + P.frame.v[2] * q[1])) + Math.abs(P.frame.n[2]) * P.t / 2;

/* ---------- nudge, remove ---------- */

const NUDGES = [1, 2, 5, 10, 20];

export function nudge(kit: Kit, form: Pose[], r: Rng, c = ctxOf(kit, form)): Pose[] | null {
  for (let tries = 0; tries < 8; tries++) {
    const i = r.int(0, form.length - 1), d = r.int(0, 5), by = Math.round(r.pick(NUDGES) / STEP);
    const pose: Pose = {...form[i], c: form[i].c.map((x, k) => x + DIRS[d][k] * by) as Cell};
    if (clashes(c, form, pose, i)) continue;
    return form.map((p, k) => (k === i ? pose : p));
  }
  return null;
}

export function remove(form: Pose[], r: Rng): Pose[] | null {
  if (form.length <= 1) return null;
  const i = r.int(0, form.length - 1);
  return form.filter((_, k) => k !== i);
}

/** One random change; null if none of a few tries worked. */
export function mutate(kit: Kit, form: Pose[], r: Rng, maxPieces: number, weights = MOVE_WEIGHTS): {form: Pose[]; move: MoveKind} | null {
  const c = ctxOf(kit, form);
  const kinds = (Object.keys(weights) as MoveKind[]).filter(k => weights[k] > 0 && !(form.length >= maxPieces && k !== 'remove' && k !== 'nudge'));
  for (let tries = 0; tries < 4; tries++) {
    const sum = kinds.reduce((s, k) => s + weights[k], 0);
    let u = r.next() * sum, kind = kinds[kinds.length - 1];
    for (const k of kinds) if ((u -= weights[k]) <= 0) { kind = k; break; }
    const out = kind === 'lap' ? lap(kit, form, r, c) : kind === 'clip' ? clip(kit, form, r, c) : kind === 'drop' ? drop(kit, form, r, c) : kind === 'nudge' ? nudge(kit, form, r, c) : remove(form, r);
    if (out) return {form: out, move: kind};
  }
  return null;
}
