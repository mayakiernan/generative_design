/**
 * Is a lattice form a table? Every check is run and recorded, so a form that fails says everything it fails,
 * not just the first thing.
 *
 * A table has a flat surface to put things on and stands on its own:
 *  - build:   a group build sequence exists (assembly.ts; "none found" is not proof there is none);
 *  - falls:   standing as built (z up), or failing that on one of its other steadiest faces (see `rest`), it tips
 *             past the table limit (8°), counting the top's weight;
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
import {apothem, coverReport, faceCover, findCoverSpot, fittedCover, minWidth} from '../covers.js';
import type {Design} from '../engine.js';
import {planDiameter, TABLE_MIN_TIP} from '../gallery.js';
import {hingeModes} from '../hinges.js';
import type {V2, V3} from '../math.js';
import {makePanel, panelVertices, turnPanel, turnVec, type Frame, type Panel} from '../panel.js';
import {convexHull, signedArea} from '../poly2d.js';
import {groundSupport, insideMargin, massProps} from '../stability.js';
import {findAssembly, type BuildStep} from './assembly.js';
import {hullFaces, rotationBetween} from '../kit.js';
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
  /**
   * Whether it needs a top (default true). Without one (a sculpture), no surface is fitted or required, no load is
   * put on it, and standing is judged on the pieces alone.
   */
  top?: boolean;
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
  /** The cut-to-fit top and where it rests (lattice coordinates × p, turned by `rest`, before setting on the floor). */
  top: {outline: V2[]; frame: Frame} | null;
  /** How the form rests, when not as built: a row-major 3×3 rotation of its lattice coordinates (z up after it). */
  rest?: number[];
}

/** Failures that depend on how the form rests; build and piece count do not. */
const POSE_FAILS = FAIL.falls | FAIL.loose | FAIL.sags | FAIL.folds | FAIL.surface | FAIL.short;
/** How many other resting faces to try when the form fails as built. */
const OTHER_POSES = 4;

interface PoseResult {fails: number; panels: Panel[]; top: Panel | null; spot: ReturnType<typeof findCoverSpot>; fitted: ReturnType<typeof fittedCover>; sup: ReturnType<typeof groundSupport>; height: number}

/** The checks that depend on how the form rests, with the panels already turned to rest that way (z up). */
function judgePose(kit: Kit, form: Form, panels: Panel[], rules: TableRules, down: V3, rest: number[] | null): PoseResult {
  const n = panels.length, vs = panels.flatMap(panelVertices), z0 = Math.min(...vs.map(v => v[2])), zTop = Math.max(...vs.map(v => v[2]));
  let fails = 0;
  // Surface: a top cut to fit the highest points, seated level on them.
  // A top cut to the highest points; failing that, a large one (at least a disc across) on the highest near-level
  // face three pieces touch, as a form resting tilted offers. None at all when the rules want no top.
  const wantTop = rules.top !== false;
  let fitted = wantTop ? fittedCover(panels, kit.t, kit.clearance, rules.topMargin) : null;
  let spot = fitted && findCoverSpot(panels, kit.t, fitted, 0.15 * apothem(fitted.outline));
  if (wantTop && !spot) {
    const large = faceCover(panels, kit.t, kit.clearance, rules.topMargin, kit.size);
    const at = large && findCoverSpot(panels, kit.t, large, 0.15 * apothem(large.outline));
    if (at) { fitted = large; spot = at; }
  }
  const top = fitted && spot ? makePanel(n, 'Top', 'top', fitted.outline, spot.frame, kit.t) : null;
  if (wantTop && !top) fails |= FAIL.surface;
  const all = top ? [...panels, top] : panels;

  // Joints are hinges: own weight must not drive a mode; nor may weight resting where the top bears (or, with no
  // top, on the highest points).
  const coverZ = top ? Math.min(...panelVertices(top).map(v => v[2])) : zTop;
  const loads = wantTop ? panels.flatMap((p, i) => panelVertices(p).filter(v => v[2] > coverZ - (top ? 0.1 : 0.05)).map(at => ({piece: i, at}))) : [];
  const hinge = hingeModes(all, top ? new Set([n]) : new Set(), loads);
  if (hinge.sags) fails |= FAIL.sags;
  if (hinge.foldsUnderLoad) fails |= FAIL.folds;

  const sup = groundSupport(all);
  if (!(sup.margin > 0) || sup.tipDeg < rules.minTip) fails |= FAIL.falls;

  const grounded = rest ? panels.map(p => Math.min(...panelVertices(p).map(v => v[2])) <= z0 + 0.05) : undefined;
  if (looseDiscs(kit, form, rest ? form.panels(kit) : panels, down, grounded).length) fails |= FAIL.loose;

  const height = (top ? Math.max(...panelVertices(top).map(v => v[2])) : zTop) - z0;
  if (height < rules.height - 1e-6) fails |= FAIL.short;
  return {fails, panels, top, spot, fitted, sup, height};
}

const popcount = (x: number) => { let k = 0; while (x) { k += x & 1; x >>>= 1; } return k; };

/**
 * Other ways the form can rest: faces of the convex hull of its discs with the centre of mass over them, touched by
 * three or more discs not all on one line (two rolling rims are not a stand). Widest margin first.
 */
function restingFaces(panels: Panel[]): {down: V3; R: number[]}[] {
  const pts = panels.flatMap(panelVertices), {com} = massProps(panels), out: {down: V3; R: number[]; margin: number}[] = [];
  for (const f of hullFaces(pts)) {
    if (f.n[2] < -0.999) continue; // as built: already tried
    const R = rotationBetween(f.n, [0, 0, -1]), turn = (v: V3) => turnVec(R, v);
    const plane = (v: V3) => f.n[0] * v[0] + f.n[1] * v[1] + f.n[2] * v[2];
    const touching = panels.filter(p => panelVertices(p).some(v => plane(v) >= f.c - 0.05));
    if (touching.length < 3) continue;
    const contacts = touching.flatMap(p => panelVertices(p).filter(v => plane(v) >= f.c - 0.05)).map(v => { const q = turn(v); return [q[0], q[1]] as V2; });
    const hull = convexHull(contacts);
    if (hull.length < 3 || signedArea(hull) < 1) continue;
    const c = turn(com), margin = insideMargin(hull, [c[0], c[1]]).margin;
    if (margin > 0) out.push({down: f.n, R, margin});
  }
  return out.sort((a, b) => b.margin - a.margin).slice(0, OTHER_POSES);
}

/**
 * Judge the form as built (z up); if it fails only for how it rests, also on its other steadiest faces, and keep
 * the pose with fewest failures (as built on a tie). A turned pose is recorded in `rest`. `prefer`: a pose known to
 * work (from an earlier judgement), tried before searching the others.
 */
export function judge(kit: Kit, form: Form, rules: TableRules = defaultRules(kit), prefer?: number[]): Verdict {
  const built = form.panels(kit), n = built.length, joints = form.joints();
  let fails = 0;
  const build = n <= 30 ? findAssembly(kit, form, rules.budget) : {ok: false, steps: [], exhausted: true, nodes: 0};
  if (!build.ok) fails |= FAIL.build;
  if (n > rules.maxDiscs) fails |= FAIL.many;

  let best = judgePose(kit, form, built, rules, [0, 0, -1], null), rest: number[] | null = null;
  if (prefer && build.ok && best.fails & POSE_FAILS) {
    // The pose's down direction in the form's own frame: the rotation takes it to −z, so it is minus its third row.
    const tried = judgePose(kit, form, built.map(p => turnPanel(p, prefer)), rules, [-prefer[6], -prefer[7], -prefer[8]], prefer);
    if (popcount(tried.fails) < popcount(best.fails)) { best = tried; rest = prefer; }
  }
  // Other poses only for a buildable form that fails for how it rests and is big enough, along its longest diagonal,
  // to reach the table height some way up (small forms never can, and they are most of what the search judges).
  const vs = built.flatMap(panelVertices), span = Math.hypot(...[0, 1, 2].map(k => Math.max(...vs.map(v => v[k])) - Math.min(...vs.map(v => v[k]))));
  if (build.ok && best.fails & POSE_FAILS && span >= rules.height) {
    for (const face of restingFaces(built)) {
      const tried = judgePose(kit, form, built.map(p => turnPanel(p, face.R)), rules, face.down, face.R);
      if (popcount(tried.fails) < popcount(best.fails)) { best = tried; rest = face.R; }
      if (!tried.fails) break;
    }
  }
  fails |= best.fails;
  const {panels, top, spot, fitted, sup, height} = best, all = top ? [...panels, top] : panels;

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
    ...(rest ? {rest} : {}),
  };
}
