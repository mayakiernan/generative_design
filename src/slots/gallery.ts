/**
 * Gallery: grow many designs from one kit and keep those that pass every engine check (no interference, each
 * piece intact, an assembly order found independently, no part that gravity pulls out, and standing, apart from
 * the few kept to show what needs propping).
 *
 * A design grows one of two ways:
 *  - free: a tree grown piece by piece toward a form (sculpture, tower, spread, compact), or at random up from a
 *    floor inside a circle on it;
 *  - covered: when a cover is wanted (the table form, or any recipe that asks for a top), a braced stacked grid of
 *    discs with the cover resting on it. A tree of slit joints folds under a load on top (hinges.ts), so a cover
 *    only ever sits on a braced grid; the form steers the grid's shape instead.
 */
import {evaluate, type Design} from './engine.js';
import type {Layout} from './generators.js';
import {coverPiece, finishPieces, grow, pieceProblem, pruneLoose, standUp, type Grown, type Intent, type KitId, type Piece, type Steer} from './kits.js';
import {rng, type Rng, type V2, type V3} from './math.js';
import {COVER_SCALES, coverDesign, coverReport, fittedCover, type Stance} from './covers.js';
import {hingeModes} from './hinges.js';
import {gridMaxSheet, growStacked, type Stacked} from './grids.js';
import {panelVertices, type Panel} from './panel.js';
import {rotate} from './kit.js';
import {convexHull, enclosingCircle} from './poly2d.js';
import {marksFor} from './engrave.js';
import type {Mark} from './svg.js';

/** The cover a design should carry: the kit's disc scaled up, or an outline cut to fit its top; at least minMm across. */
export interface CoverSpec {shape: 'round' | 'fitted'; minMm: number}

export interface GalleryOptions extends Steer {
  kit: KitId; intent: Intent; count: number; size: number; t: number; clearance: number; seed: number; designs: number; attempts: number;
  /** Random form: diameter of the circle on the floor the design must fit inside, mm. Default 4 piece sizes. */
  footprint?: number;
  /** Also keep designs whose only failed check is Stands, in their intended pose, up to a third of the set. */
  keepFallers?: boolean;
  /** A cover on top. The table form always has one (round, unless given); with one, any form grows as a braced grid. */
  cover?: CoverSpec;
}

export interface GalleryItem {
  id: string;
  seed: number;
  design: Design;
  parts: {id: string; name: string; count: number}[];
  steps: {text: string}[];
  marks: Mark[];
  /** Covered designs: how the cover serves as a surface, and its size across (width ≥ depth), mm. */
  top?: {height: number; tiltDeg: number; safeFrac: number; loadKg: number; supports: number; coverScale: number; shape: CoverSpec['shape']; width: number; depth: number};
  /** Random form: the smallest circle round the plan, against the limit (diameters, mm). */
  footprint?: {needed: number; limit: number};
  /** Stands on the floor by itself (tips past 4°). False: it passes every other check but needs propping. */
  stands: boolean;
}

const TITLE: Record<Intent, string> = {any: 'Slot sculpture', tower: 'Slot tower', spread: 'Low spread', compact: 'Compact cluster', table: 'Slot table', random: 'Random design'};
/**
 * With a cover, the form only steers how many layers the grid has: towers stack up, spreads stay low. Under 14
 * pieces only a few grids exist at all, so every form draws from all of them.
 */
const LAYERS: Record<Intent, number[]> = {any: [2, 3, 3, 4], table: [2, 3, 3, 4], random: [2, 3, 3, 4], compact: [3], tower: [3, 4, 4], spread: [2]};

/** Tables must stand well clear of tipping: a nudge of tan(8°) ≈ 14% of the weight. */
export const TABLE_MIN_TIP = 8;

/**
 * What makes a stance read as a table: it stands at least 1.5 piece sizes tall with the cover on, spreads no more
 * than twice the cover's width, and the cover's centre sits well inside the feet (a fifth of the cover's half width).
 */
export function tableStance(st: Stance, size: number): string | null {
  if (st.height < 1.5 * size) return 'too low for a table';
  if (st.plan > 2 * st.coverWidth) return 'spreads too wide for its cover';
  if (st.centreMargin < 0.1 * st.coverWidth) return 'cover sits off to one side of the feet';
  return null;
}

/** Diameter of the smallest circle round a design's plan (seen from above). */
export function planDiameter(panels: Pick<Panel, 'pieces' | 'frame' | 't'>[]): number {
  return 2 * enclosingCircle(convexHull(panels.flatMap(panelVertices).map(v => [v[0], v[1]] as V2))).r;
}

/** A grown design before checking: the pieces, and for a grid its build steps and cover. */
export interface Built {
  g: Grown;
  stacked?: Stacked;
  cover?: {piece: Piece; scale: number; supports: number[]};
}

/** The material a design is cut from. */
export interface Stock {kit: KitId; size: number; t: number; clearance: number}

/** A braced stacked grid with a cover resting level on it, or why not. */
function growCovered(pieces: Piece[], o: GalleryOptions, spec: CoverSpec, r: Rng): Built | {why: string} {
  const stacked = growStacked(pieces, o.count, o.t, r, {weights: o.weights}, o.count < 14 ? LAYERS.table : LAYERS[o.intent]);
  if (!stacked) return {why: 'no grid of that size from these pieces'};
  return coverGrid(stacked, o, spec);
}

/** Rest a cover of the given kind level on a grid, or say why it will not rest. */
export function coverGrid(stacked: Stacked, o: Stock, spec: CoverSpec): Built | {why: string} {
  let makeCover: (scale: number) => Piece, scales: number[];
  if (spec.shape === 'fitted') {
    const fitted = fittedCover(stacked.panels, o.t, o.clearance, 0.25 * o.size, spec.minMm);
    if (!fitted) return {why: 'no top to fit a cover to'};
    makeCover = scale => ({...fitted, outline: fitted.outline.map(q => [q[0] * scale, q[1] * scale] as V2)});
    scales = [1, 1.1, 1.25];
  } else {
    makeCover = scale => ({...coverPiece(o.kit, o.size * scale, o.t, o.clearance), name: scale === 1 ? 'Cover' : `Cover, ${scale}× piece size`});
    const least = spec.minMm / o.size;
    scales = COVER_SCALES.filter(s => s >= least);
    if (!scales.length) scales = [Math.ceil(least * 4) / 4];
  }
  const placed = coverDesign(stacked, makeCover, o.t, {minTip: TABLE_MIN_TIP, accept: st => tableStance(st, o.size), scales});
  if ('why' in placed) return placed;
  return {g: placed.g, stacked, cover: {piece: placed.cover, scale: placed.scale, supports: placed.spot.supports}};
}

/**
 * A free-grown tree, stood up and pruned of what gravity would pull out. A random design starts from a piece on
 * edge (up is one of its in-plane axes, picked at random) and grows up from the floor that piece stands on, inside
 * a circle on that floor. With `mayFall`, one that will not stand in its intended pose is kept in that pose.
 */
function growFree(pieces: Piece[], o: GalleryOptions, r: Rng, mayFall: boolean): Built | {why: string} {
  const random = o.intent === 'random';
  let up: V3 | undefined = random ? r.pick<V3>([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]) : undefined;
  // Grow a fifth over the target: pieces gravity would pull out are pruned once it stands.
  let g = grow(pieces, Math.ceil(o.count * 1.2), o.intent, o.t, r, {weights: o.weights, branching: o.branching}, up && {up, radius: (o.footprint ?? 4 * o.size) / 2});
  if (!g) return {why: random ? 'could not place enough pieces inside the circle' : 'could not place enough pieces'};
  // Stand it up, prune, and stand it up again: pruning moves the centre of mass.
  for (let pass = 0; pass < 3; pass++) {
    const st = standUp(g, o.intent, up, mayFall);
    if (!st) return {why: o.intent === 'tower' ? 'would not stand upright' : 'would not stand'};
    if (up) up = rotate({R: st.R, t: [0, 0, 0]}, up);
    const before = g.types.length;
    g = pruneLoose(g, o.count, o.clearance);
    if (g.types.length === before || st.fell) break;
  }
  return {g};
}

/** Same pieces at the same heights and distances from the middle (to a millimetre): a repeat, even turned. */
function signature(g: Grown): string {
  const mx = g.panels.reduce((a, p) => a + p.frame.o[0], 0) / g.panels.length, my = g.panels.reduce((a, p) => a + p.frame.o[1], 0) / g.panels.length;
  return g.panels.map((p, k) => `${g.types[k]}:${Math.round(Math.hypot(p.frame.o[0] - mx, p.frame.o[1] - my))}:${Math.round(p.frame.o[2])}`).sort().join('|');
}

/** Checks on the cover (the last panel): level, braced joints under it, and how much of it is usable. */
function coverChecks(d: Design, g: Grown, cover: NonNullable<Built['cover']>, shape: CoverSpec['shape']): NonNullable<GalleryItem['top']> {
  const k = g.panels.length - 1, rep = coverReport(d, g.panels, k);
  // Past a tonne the rating is a numerical artefact of a load point sitting almost on a support edge.
  if (rep.loadKg > 1000) rep.loadKg = Infinity;
  d.checks.push({label: 'Level cover', level: rep.tiltDeg <= 2 ? 'ok' : 'error', detail: `the cover sits ${Math.round(rep.height)} mm up, ${rep.tiltDeg < 0.05 ? 'level' : `tilted ${rep.tiltDeg.toFixed(1)}°`}`});
  // Joints are hinges about their slit lines: the cover's load and the design's own weight must not fold it.
  const coverZ = Math.min(...panelVertices(g.panels[k]).map(v => v[2]));
  const loads = g.panels.flatMap((p, i) => i === k ? [] : panelVertices(p).filter(v => v[2] > coverZ - 0.1).map(at => ({piece: i, at})));
  const hinge = hingeModes(g.panels, new Set([k]), loads), names = (xs: number[]) => xs.map(i => i + 1).join(', ');
  d.checks.push(hinge.foldsUnderLoad || hinge.sags
    ? {label: 'Braced joints', level: 'error', detail: `pieces ${names(hinge.swinging)} can swing on their slit lines, so ${hinge.foldsUnderLoad ? 'weight on the cover folds the design' : 'the design sags under its own weight'}`}
    : hinge.swinging.length
      ? {label: 'Braced joints', level: 'ok', detail: `the frame is braced; only pieces ${names(hinge.swinging)} can turn a little on their own slit lines, which lowers nothing, and nothing rests on them`}
      : {label: 'Braced joints', level: 'ok', detail: 'every slit joint is braced: no piece can swing on its slit line'});
  d.checks.push({label: 'Usable surface', level: rep.safeFrac >= 0.3 ? 'ok' : rep.safeFrac >= 0.12 ? 'warn' : 'error',
    detail: `${Math.round(rep.safeFrac * 100)}% of the cover lies over what holds it up; a load there cannot tip the cover off${isFinite(rep.loadKg) ? `, and the whole design tips only past ${rep.loadKg.toFixed(1)} kg` : ', nor tip the design'}`});
  d.ok = d.checks.every(c => c.level !== 'error');
  const xs = cover.piece.outline.map(q => q[0]), ys = cover.piece.outline.map(q => q[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  return {height: rep.height, tiltDeg: rep.tiltDeg, safeFrac: rep.safeFrac, loadKg: rep.loadKg, supports: cover.supports.length, coverScale: cover.scale, shape, width: Math.max(w, h), depth: Math.min(w, h)};
}

/** Numbered build steps, also set on the design for the animation. Each piece's straight slide was checked as it grew. */
function buildSteps(d: Design, built: Built, ids: Map<string, Piece>, size: number): string[] {
  const {g, stacked, cover} = built, travel = size * 1.2;
  const L = (k: number) => String.fromCharCode(97 + k), kind = (k: number) => ids.get(g.types[k])!.name.toLowerCase();
  const coverText = cover && `Lay the cover (piece ${g.panels.length}${cover.piece.id === 'CF' ? ', cut to fit' : cover.scale === 1 ? '' : `, ${cover.scale}× the piece size`}) on top, resting on pieces ${cover.supports.map(i => i + 1).join(', ')}.`;
  const coverStep = {panel: g.panels.length - 1, travel: [0, 0, -1] as V3, distance: travel, how: coverText ?? ''};
  if (stacked) {
    // Upper layers are built raised on the bench and lowered as one unit (a group step moves them together).
    d.steps = [...stacked.steps.map(st => st.unit
      ? {panel: st.pieces[0], group: st.pieces, travel: st.travel, distance: size * 0.9, how: st.text}
      : {panel: st.pieces[0], travel: st.travel, distance: travel, how: st.text}), ...(cover ? [coverStep] : [])];
    return d.steps.map(s => s.how);
  }
  const text = [`Hold piece 1 (${kind(0)}).`, ...g.joints.map(j => `Piece ${j.child + 1} (${kind(j.child)}): slit ${L(j.childSlit)} onto slit ${L(j.parentSlit)} of piece ${j.parent + 1}.`)];
  d.steps = g.types.map((_, k) => ({panel: k, travel: (g.travel[k] ?? [0, 0, -1]) as V3, distance: travel, how: text[k]}));
  return text;
}

/**
 * Check a grown design with the full engine and turn it into a gallery item: interference, assembly, stability,
 * parts held, then the cover's checks, the build steps and the engraving. The item says whether it passed
 * (`design.ok`) and whether it stands; the caller decides what to keep.
 */
export function finishItem(built: Built, o: Stock & {title: string; id: string; seed: number; spec?: CoverSpec; footprint?: {needed: number; limit: number}}): GalleryItem | {why: string} {
  const {g} = built;
  const layout: Layout = {title: o.title, panels: g.panels, order: g.types.map((_, k) => ({panel: k, motion: g.travel[k]})), joints: [], params: [], target: {height: 1, width: 1}};
  let d: Design;
  try { d = evaluate(layout, 'kit', o.clearance); } catch { return {why: 'check failed to run'}; }
  if (o.footprint) d.checks.push({label: 'Footprint', level: 'ok', detail: `fits inside a ${Math.round(o.footprint.limit)} mm circle on the floor; the smallest circle round it is ${Math.ceil(o.footprint.needed)} mm across`});
  const top = built.cover && coverChecks(d, g, built.cover, o.spec?.shape ?? 'round');
  const stands = !!built.cover || (d.support.tipDeg > 4 && !d.checks.some(c => c.level === 'error' && c.label === 'Stands'));
  const byId = new Map(finishPieces(o.kit, o.size, o.t, o.clearance).map(p => [p.id, p]));
  const ids = built.cover ? byId.set(built.cover.piece.id, built.cover.piece) : byId;
  const steps = buildSteps(d, built, ids, o.size);
  d.title = `${o.title} · ${g.types.length - (built.cover ? 1 : 0)} pieces`;
  const counts = new Map<string, number>();
  for (const id of g.types) counts.set(id, (counts.get(id) ?? 0) + 1);
  return {
    id: o.id, seed: o.seed, design: d, top, stands, footprint: o.footprint,
    steps: steps.map(text => ({text})),
    parts: [...counts.entries()].map(([id, count]) => ({id, name: ids.get(id)!.name, count})),
    marks: marksFor(g.types, ids, o.size),
  };
}

export function* gallery(o: GalleryOptions): Generator<GalleryItem | {tried: number; failed: Record<string, number>}> {
  const spec = o.cover ?? (o.intent === 'table' ? {shape: 'round', minMm: 0} as CoverSpec : undefined);
  if (spec && o.kit !== 'circle') throw new Error('A cover needs the Circular kit: only discs stack into a braced grid that can carry one.');
  const pieces = finishPieces(o.kit, o.size, o.t, o.clearance);
  for (const p of pieces) {
    const problem = pieceProblem(p);
    if (problem) throw new Error(problem);
  }
  if (spec) { const why = gridSheetProblem(pieces, o.size, o.t); if (why) throw new Error(why); }
  const random = o.intent === 'random', limit = o.footprint ?? 4 * o.size;
  const title = spec && o.intent !== 'table' ? `${TITLE[o.intent]} with a top` : TITLE[o.intent];
  const failed: Record<string, number> = {};
  const note = (why: string) => { failed[why] = (failed[why] ?? 0) + 1; };
  const fallerCap = o.keepFallers && !spec ? Math.ceil(o.designs / 3) : 0;
  const seen = new Set<string>();
  let found = 0, tried = 0, fallers = 0;
  for (let a = 0; a < o.attempts && found < o.designs; a++) {
    tried++;
    const seed = o.seed * 100003 + a + Object.keys(TITLE).indexOf(o.intent) * 7919, r = rng(seed);
    const built = spec ? growCovered(pieces, o, spec, r) : growFree(pieces, o, r, fallers < fallerCap);
    if ('why' in built) { note(built.why); continue; }
    const g = built.g, footprint = random ? planDiameter(g.panels) : 0;
    // Standing on another face (when its floor face tips too soon), or a cover, can reach past the circle.
    if (random && footprint > limit + 0.5) { note('spreads past the footprint circle'); continue; }
    if (!spec && g.types.length < Math.max(3, Math.ceil(o.count * 0.75))) { note('too many loose pieces'); continue; }
    const sig = signature(g);
    if (seen.has(sig)) { note('repeat of a design already shown'); continue; }
    seen.add(sig);
    const item = finishItem(built, {...o, title, id: `${o.kit}-${o.intent}-${seed}`, seed, spec, footprint: random ? {needed: footprint, limit} : undefined});
    if ('why' in item) { note(item.why); continue; }
    // A design whose only failed check is Stands is kept (it needs propping) while there is room for one more.
    const errors = item.design.checks.filter(c => c.level === 'error');
    if (!(item.design.ok || (!item.stands && errors.every(c => c.label === 'Stands')))) { for (const c of errors) note(c.label.toLowerCase()); continue; }
    if (!item.stands) {
      if (fallers >= fallerCap) { note('would not stand'); continue; }
      fallers++;
    }
    found++;
    yield item;
  }
  yield {tried, failed};
}

/** Why this sheet is too thick for a grid of these discs, or null (see gridMaxSheet). */
export function gridSheetProblem(pieces: Piece[], size: number, t: number): string | null {
  const most = gridMaxSheet(pieces);
  return t > most + 1e-6 ? `A ${t} mm sheet is too thick for a grid of ${size} mm discs: the bridge discs would run into the layer above. Use discs of at least ${Math.ceil(25 * t)} mm, or a sheet of at most ${(Math.floor(most * 10) / 10).toFixed(1)} mm.` : null;
}
