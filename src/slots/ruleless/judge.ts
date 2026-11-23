/**
 * Is a free form a table? The lattice atlas's table (atlas/judge.ts), judged by physics instead of the kit's
 * joining rules. Every check runs and is recorded:
 *  - overlap: two pieces run into each other (exact, on the real panels);
 *  - apart:   the pieces (with the top) are not one connected whole;
 *  - sags:    no set of contact forces holds every piece up under its own weight, the top's and a load on the
 *             top's centre as heavy as the whole table (statics.ts);
 *  - folds:   (checked only when nothing else fails) the same load over any one support of the top, instead of
 *             at its centre, finds no balance (the lattice atlas's "folds under weight on top");
 *  - racks:   loaded so, it cannot take a sideways push on the top of tan 8° of the total weight: the frame racks
 *             on its hinges or the top slides off (a piece that only swings on a hinge is not pushed);
 *  - falls:   as one rigid whole, top on, it tips or slides when tilted 8° (the gallery's tip limit, now with
 *             floor friction);
 *  - build:   no group build sequence found (assembly.ts);
 *  - surface, short, many: as in the lattice atlas (a top cut to fit, seated level on three or more supports;
 *             its height; the piece budget).
 * The kit's joining rules are not checked. What a form does that they forbid is counted instead: clips (a slit on
 * a plain edge) and pieces resting on pieces.
 */
import {apothem, findCoverSpot, fittedCover, minWidth} from '../covers.js';
import {panelDepth} from '../collide.js';
import {planDiameter, TABLE_MIN_TIP} from '../gallery.js';
import type {V2} from '../math.js';
import {makePanel, panelVertices, type Frame, type Panel} from '../panel.js';
import {signedArea} from '../poly2d.js';
import {Form, pieceId, symmetryOrder, type Kit, type PieceId, type Pose} from '../atlas/lattice.js';
import {defaultRules, type TableRules} from '../atlas/judge.js';
import {findContacts, joinedParts, type Contact, type ContactKind} from './contacts.js';
import {findFreeAssembly, type BuildStep} from './assembly.js';
import {fineKit, freePanels, STEP} from './free.js';
import {holds, rigidStance, STATICS_DEFAULTS, topPush, type Load, type StaticsOptions} from './statics.js';

export const FREE_FAIL = {build: 1, falls: 2, sags: 4, racks: 8, apart: 16, overlap: 32, surface: 64, short: 128, many: 256, folds: 512} as const;
export type FreeFailName = keyof typeof FREE_FAIL;
export const FREE_FAIL_NAMES = Object.keys(FREE_FAIL) as FreeFailName[];
export const FREE_FAIL_TEXT: Record<FreeFailName, string> = {
  build: 'no build sequence found', falls: 'tips or slides too easily', sags: 'no forces hold it up under load', racks: 'racks or slides when the top is pushed',
  apart: 'not one piece', overlap: 'pieces run into each other', surface: 'no flat surface on top', short: 'too low', many: 'too many pieces', folds: 'gives under weight over a support',
};
export const freeFailList = (fails: number) => FREE_FAIL_NAMES.filter(k => fails & FREE_FAIL[k]);

export interface FreeMetrics {
  pieces: number;
  laps: number;
  clips: number;
  /** Pieces resting on pieces (the top resting on the form not counted). */
  rests: number;
  /** Contacts the kit's rules forbid: clips plus rests. */
  breaks: number;
  /** Independent loops of piece-to-piece contacts. */
  loops: number;
  height: number;
  /** As one rigid whole: the largest tilt it takes before tipping or sliding, degrees (−1: it cannot stand). */
  stanceDeg: number;
  /** Largest sideways push on the top (share of the loaded weight) the frame takes in its weakest direction (−1: it does not hold; null: no top). */
  rackPush: number | null;
  surface: number;
  surfaceWidth: number;
  supports: number;
  spread: number;
  mix: Record<PieceId, number>;
  symmetry: number;
}

export interface FreeVerdict {
  fails: number;
  metrics: FreeMetrics;
  build: {found: boolean; exhausted: boolean; nodes: number; steps: BuildStep[]};
  top: {outline: V2[]; frame: Frame} | null;
  contacts: Contact[];
}

export interface FreeJudgeOptions {statics?: StaticsOptions; skipBuild?: boolean; skipOverlap?: boolean}

const overlapMemo = new Map<string, boolean>();
const shape = (p: Pose) => `${p.a},${p.m},${p.k ?? ''},${p.s ?? ''}`;
/** Do two placed pieces run into each other? Memoised on their relative placement. */
export function piecesOverlap(kit: Kit, A: Pose, B: Pose, PA: Panel, PB: Panel): boolean {
  const reach = (2 * kit.R + 2 * kit.t) / STEP;
  if (A.c.some((x, k) => Math.abs(B.c[k] - x) > reach)) return false;
  const key = `${kit.size},${kit.t},${kit.clearance}|${B.c.map((x, k) => x - A.c[k]).join(',')}|${shape(A)}|${shape(B)}`;
  let hit = overlapMemo.get(key);
  if (hit === undefined) {
    hit = panelDepth(PA, PB) > 0;
    if (overlapMemo.size > 2_000_000) overlapMemo.clear();
    overlapMemo.set(key, hit);
  }
  return hit;
}

export function judgeFree(kit: Kit, form: Pose[], rules: TableRules = defaultRules(kit), o: FreeJudgeOptions = {}): FreeVerdict {
  const fine = fineKit(kit), panels = freePanels(fine, form), n = panels.length;
  const vs = panels.flatMap(panelVertices), z0 = Math.min(...vs.map(v => v[2])), zTop = Math.max(...vs.map(v => v[2]));
  let fails = 0;

  if (!o.skipOverlap) {
    outer: for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (piecesOverlap(kit, form[i], form[j], panels[i], panels[j])) { fails |= FREE_FAIL.overlap; break outer; }
  }

  // A top cut to fit the highest points and seated level on them, as in the lattice atlas.
  const fitted = fittedCover(panels, kit.t, kit.clearance, rules.topMargin);
  const spot = fitted && findCoverSpot(panels, kit.t, fitted, 0.15 * apothem(fitted.outline));
  const top = fitted && spot ? makePanel(n, 'Top', 'top', fitted.outline, spot.frame, kit.t) : null;
  if (!top) fails |= FREE_FAIL.surface;
  const all = top ? [...panels, top] : panels;

  const contacts = findContacts(all);
  if (joinedParts(all.length, contacts).length > 1) fails |= FREE_FAIL.apart;

  const so = o.statics ?? STATICS_DEFAULTS, need = Math.tan((TABLE_MIN_TIP * Math.PI) / 180);
  let rackPush: number | null = null;
  if (top) {
    const tp = topPush(all, contacts, n, so, [{on: n, at: top.frame.o, weight: 1}], need);
    if (!tp.holds) fails |= FREE_FAIL.sags;
    else if (tp.push < need) fails |= FREE_FAIL.racks;
    rackPush = tp.push;
  } else if (!holds(all, contacts, so)) fails |= FREE_FAIL.sags;
  const st = rigidStance(all, contacts, so, need);
  if (st.push < need) fails |= FREE_FAIL.falls;
  if (top && !fails) {
    // Weight over each support in turn: where the top bears on that piece.
    for (const c of contacts) {
      if (c.b !== n && c.a !== n) continue;
      const pts = c.pushes.map(p => p.x), at = [0, 1, 2].map(k => pts.reduce((sum, x) => sum + x[k], 0) / pts.length) as [number, number, number];
      if (!holds(all, contacts, so, [{on: n, at, weight: 1}])) { fails |= FREE_FAIL.folds; break; }
    }
  }

  const pieceContacts = contacts.filter(c => c.b >= 0 && c.a < n && c.b < n);
  const build = o.skipBuild ? {ok: true, steps: [], exhausted: false, nodes: 0} : findFreeAssembly(kit, form, panels, pieceContacts, rules.budget);
  if (!build.ok) fails |= FREE_FAIL.build;

  const height = (top ? Math.max(...panelVertices(top).map(v => v[2])) : zTop) - z0;
  if (height < rules.height - 1e-6) fails |= FREE_FAIL.short;
  if (n > rules.maxDiscs) fails |= FREE_FAIL.many;

  const count = (k: ContactKind) => pieceContacts.filter(c => c.kind === k).length;
  const laps = count('lap'), clips = count('clip'), rests = count('rest');
  const parts = joinedParts(n, pieceContacts).length;
  const mix: Record<PieceId, number> = {C1: 0, C2L: 0, C2I: 0, C3T: 0, H: 0, H1: 0};
  for (const p of form) mix[pieceId(p)!]++;
  const outline = fitted?.outline ?? [];
  return {
    fails,
    metrics: {
      pieces: n, laps, clips, rests, breaks: clips + rests, loops: pieceContacts.length - n + parts, height,
      stanceDeg: st.push >= 0 ? (Math.atan(st.push) * 180) / Math.PI : -1, rackPush,
      surface: top ? signedArea(outline) : 0, surfaceWidth: top ? minWidth(outline) : 0, supports: spot?.supports.length ?? 0,
      spread: planDiameter(panels), mix, symmetry: symmetryOrder(new Form(form)),
    },
    build: {found: build.ok, exhausted: build.exhausted, nodes: build.nodes, steps: build.steps},
    top: top && spot ? {outline, frame: spot.frame} : null,
    contacts,
  };
}
