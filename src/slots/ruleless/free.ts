/**
 * Rule-free forms: kit pieces anywhere, not only on the lattice.
 *
 * The lattice atlas puts every piece a whole joint-pitch from its neighbours, so pieces meet only slit into slit.
 * Here a piece is the same Pose (plane square to an axis, slit mouths along axes, half discs as in lattice.ts) but
 * its point is in tenths of a millimetre. Planes stay square to the axes, which is what the kit's slits make when
 * they grip anything, and it keeps forms comparable: the lattice's symmetry keys (turns and mirrors about the
 * vertical, and slides) work unchanged, and a lattice form is a free form with every point a multiple of the pitch.
 *
 * What the kit's rules forbid but the pieces allow is then a matter of position: a slit pushed onto a plain edge
 * (a clip), a piece resting on another (stacking), slits that meet off the pitch.
 */
import {posePanel, canonicalKey, fromKey, pieceId, type Cell, type Form, type Kit, type Pose} from '../atlas/lattice.js';
import type {Panel} from '../panel.js';

/** Grid step of a free form, mm. */
export const STEP = 0.1;

/** The kit with positions in grid steps instead of lattice pitches (same pieces, own panel cache). */
export function fineKit(kit: Kit): Kit {
  return {...kit, p: STEP, base: new Map(), overlapMemo: new Map(), slideMemo: new Map(), nudgeMemo: new Map()};
}

/** Pitch of the lattice in grid steps (416 for 80 mm discs). */
export const pitchSteps = (kit: Kit) => Math.round(kit.p / STEP);

export type FreeForm = Pose[];

/** A lattice form as a free form. */
export function fromLattice(kit: Kit, form: Form): FreeForm {
  const P = pitchSteps(kit);
  return form.discs.map(p => ({...p, c: [p.c[0] * P, p.c[1] * P, p.c[2] * P] as Cell}));
}

/** Panels in piece order (panel id = index), positions in mm. */
export function freePanels(fine: Kit, form: FreeForm): Panel[] {
  return form.map((p, i) => posePanel(fine, p, i));
}

/** The same key however the form is turned or mirrored about the vertical, or slid. */
export const freeKey = (form: FreeForm) => canonicalKey(form);
export const fromFreeKey = (key: string): FreeForm => fromKey(key).discs;

/** Is every piece a real kit piece? */
export const allPieces = (form: FreeForm) => form.every(p => pieceId(p));

/** Positions in mm of a point given in grid steps. */
export const mm = (c: Cell): [number, number, number] => [c[0] * STEP, c[1] * STEP, c[2] * STEP];
