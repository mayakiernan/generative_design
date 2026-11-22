/**
 * Is a lattice form a table? Every check is run and recorded, so a form that fails says everything it fails,
 * not just the first thing.
 *
 * A table has a flat surface to put things on and stands on its own:
 *  - build:   a group build sequence exists (assembly.ts; "none found" is not proof there is none);
 *  - falls:   standing as built (z up), it tips past the table limit (8°), counting the top's weight;
 *  - loose:   gravity can pull a part out (the engine's hold test);
 *  - sags:    a hinge mode lowers its centre of mass (hinges.ts: slit joints are hinges);
 *  - folds:   a hinge mode moves a point the load on top rests on;
 *  - surface: no level face on top touched by three or more supports off a line. The top may be any shape: it is
 *             cut to fit (fittedCover), the plan hull of the highest points grown by a margin, and must seat on
 *             them as the gallery's covers do (findCoverSpot);
 *  - short:   the surface (or, with none, the highest point) is below the height asked for;
 *  - many:    more discs than allowed.
 * Recorded, not judged: surface area and least width, the share of the top over its supports, the load that tips
 * the whole design, plan spread, how far the top's centre sits inside the feet, piece mix and symmetry.
 */
import {apothem, coverReport, findCoverSpot, fittedCover, minWidth} from '../covers.js';
import type {Design} from '../engine.js';
import {planDiameter, TABLE_MIN_TIP} from '../gallery.js';
import {hingeModes} from '../hinges.js';
import type {V2} from '../math.js';
import {makePanel, panelVertices, type Frame, type Panel} from '../panel.js';
import {signedArea} from '../poly2d.js';
import {groundSupport, insideMargin} from '../stability.js';
import {findAssembly, type BuildStep} from './assembly.js';
import {looseDiscs, pieceMix, symmetryOrder, type Form, type Kit, type PieceId} from './lattice.js';

export const FAIL = {build: 1, falls: 2, loose: 4, sags: 8, folds: 16, surface: 32, short: 64, many: 128} as const;
export type FailName = keyof typeof FAIL;
export const FAIL_NAMES = Object.keys(FAIL) as FailName[];
export const FAIL_TEXT: Record<FailName, string> = {
  build: 'no build sequence found', falls: 'tips too easily', loose: 'a part can drop out', sags: 'sags under its own weight',
  folds: 'folds under weight on top', surface: 'no flat surface on top', short: 'too low', many: 'too many discs',
};
export const failList = (fails: number) => FAIL_NAMES.filter(k => fails & FAIL[k]);

export interface TableRules {
  /** Least height of the surface above the floor, mm. */
  height: number;
  maxDiscs: number;
  /** Least tip angle, degrees. */
  minTip: number;
  /** How far the cut-to-fit top reaches past its supports, mm. */
  topMargin: number;
  /** Node budget of the build search. */
  budget: number;
}

export const defaultRules = (kit: Kit): TableRules => ({height: 1.5 * kit.size, maxDiscs: 30, minTip: TABLE_MIN_TIP, topMargin: 0.25 * kit.size, budget: 4000});

export interface Metrics {
  discs: number;
  joints: number;
  /** Independent loops of joints: joints − discs + 1 (0 for a tree). */
  loops: number;
  /** Surface height above the floor, or the highest point when there is no surface, mm. */
  height: number;
  tipDeg: number;
  /** Top outline area, mm² (0 with no surface). */
  surface: number;
  surfaceWidth: number;
  supports: number;
  /** Share of the top over its supports. */
  safeFrac: number;
  /** Least load on the safe area that tips the whole design, kg (null: none does). */
  tipLoadKg: number | null;
  /** Diameter of the smallest circle round the plan, mm. */
  spread: number;
  /** How far the top's centre sits inside the floor contacts, mm. */
  centreMargin: number;
  mix: Record<PieceId, number>;
  symmetry: number;
}

export interface Verdict {
  fails: number;
  build: {found: boolean; exhausted: boolean; nodes: number; steps: BuildStep[]};
  metrics: Metrics;
  /** The cut-to-fit top and where it rests (lattice coordinates × p, before setting on the floor). */
  top: {outline: V2[]; frame: Frame} | null;
}

export function judge(kit: Kit, form: Form, rules: TableRules = defaultRules(kit)): Verdict {
  const panels = form.panels(kit), n = panels.length, joints = form.joints();
  const vs = panels.flatMap(panelVertices), z0 = Math.min(...vs.map(v => v[2])), zTop = Math.max(...vs.map(v => v[2]));
  let fails = 0;

  const build = n <= 30 ? findAssembly(kit, form, rules.budget) : {ok: false, steps: [], exhausted: true, nodes: 0};
  if (!build.ok) fails |= FAIL.build;

  // Surface: a top cut to fit the highest points, seated level on them.
  const fitted = fittedCover(panels, kit.t, kit.clearance, rules.topMargin);
  const spot = fitted && findCoverSpot(panels, kit.t, fitted, 0.15 * apothem(fitted.outline));
  const top = fitted && spot ? makePanel(n, 'Top', 'top', fitted.outline, spot.frame, kit.t) : null;
  if (!top) fails |= FAIL.surface;
  const all = top ? [...panels, top] : panels;

  // Joints are hinges: own weight must not drive a mode; nor may weight resting where the top bears (or, with no
  // top, on the highest points).
  const coverZ = top ? Math.min(...panelVertices(top).map(v => v[2])) : zTop;
  const loads = panels.flatMap((p, i) => panelVertices(p).filter(v => v[2] > coverZ - (top ? 0.1 : 0.05)).map(at => ({piece: i, at})));
  const hinge = hingeModes(all, top ? new Set([n]) : new Set(), loads);
  if (hinge.sags) fails |= FAIL.sags;
  if (hinge.foldsUnderLoad) fails |= FAIL.folds;

  const sup = groundSupport(all);
  if (!(sup.margin > 0) || sup.tipDeg < rules.minTip) fails |= FAIL.falls;

  if (looseDiscs(kit, form, panels).length) fails |= FAIL.loose;

  const height = (top ? Math.max(...panelVertices(top).map(v => v[2])) : zTop) - z0;
  if (height < rules.height - 1e-6) fails |= FAIL.short;
  if (n > rules.maxDiscs) fails |= FAIL.many;

  let safeFrac = 0, tipLoadKg: number | null = null, centreMargin = 0;
  if (top) {
    const rep = coverReport({support: sup} as unknown as Design, all, n);
    safeFrac = rep.safeFrac;
    tipLoadKg = Number.isFinite(rep.loadKg) && rep.loadKg <= 1000 ? rep.loadKg : null;
    centreMargin = insideMargin(sup.hull, [top.frame.o[0], top.frame.o[1]]).margin;
  }
  const outline = fitted?.outline ?? [];
  return {
    fails,
    build: {found: build.ok, exhausted: build.exhausted, nodes: build.nodes, steps: build.steps},
    metrics: {
      discs: n, joints: joints.length, loops: joints.length - n + 1, height, tipDeg: sup.tipDeg,
      surface: top ? signedArea(outline) : 0, surfaceWidth: top ? minWidth(outline) : 0, supports: spot?.supports.length ?? 0,
      safeFrac, tipLoadKg, spread: planDiameter(panels), centreMargin, mix: pieceMix(form), symmetry: symmetryOrder(form),
    },
    top: top && spot ? {outline, frame: spot.frame} : null,
  };
}
