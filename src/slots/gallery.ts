/**
 * Gallery: grow many designs from one kit and keep those that pass every engine check (no interference, each
 * piece intact, an assembly order found independently, stands, no part that gravity pulls out).
 */
import {evaluate, type Design} from './engine';
import type {Layout} from './generators';
import {childFrame, coverPiece, finishPieces, grow, growBoxed, growSymmetric, pieceProblem, pruneLoose, slitSymmetry, standUp, type Intent, type KitId, type Piece, type Steer} from './kits';
import {rng, type Rng, type V2, type V3} from './math';
import {coverDesign, coverReport, type Stance} from './covers';
import {hingeModes} from './hinges';
import {growStacked, type Stacked} from './grids';
import {panelVertices, type Panel} from './panel';
import {frameOf, IDENTITY, rotate} from './kit';
import type {Grown} from './kits';
import {convexHull, convexOverlap, enclosingCircle, pointInPolygon} from './poly2d';
import type {Mark} from './svg';

export interface GalleryOptions extends Steer {
  kit: KitId; intent: Intent; count: number; size: number; t: number; clearance: number; seed: number; designs: number; attempts: number;
  /** Random form only: diameter of the circle the design's plan must fit inside, mm. Default 4 piece sizes. */
  footprint?: number;
}

export interface GalleryItem {
  id: string;
  seed: number;
  design: Design;
  parts: {id: string; name: string; count: number}[];
  steps: {text: string}[];
  marks: Mark[];
  score: number;
  /** Table form only: how the cover serves as a surface. */
  top?: {height: number; tiltDeg: number; safeFrac: number; loadKg: number; supports: number; coverScale: number};
  /** Random form only: the smallest circle round the plan, against the limit (diameters, mm). */
  footprint?: {needed: number; limit: number};
}

const INTENT_TITLE: Record<Intent, string> = {any: 'Slot sculpture', tower: 'Slot tower', spread: 'Low spread', compact: 'Compact cluster', table: 'Slot table', random: 'Random design'};

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

function score(d: Design, intent: Intent) {
  const {width, depth, height} = d.size, foot = Math.max(width, depth);
  const shape = intent === 'tower' ? height / foot : intent === 'spread' ? foot / height : intent === 'compact' ? -Math.hypot(width, depth, height) / Math.cbrt(d.panels.length) / 100 : 0;
  return shape + Math.min(d.support.tipDeg, 30) / 30;
}

/** Diameter of the smallest circle round a design's plan (seen from above). */
export function planDiameter(panels: Pick<Panel, 'pieces' | 'frame' | 't'>[]): number {
  return 2 * enclosingCircle(convexHull(panels.flatMap(panelVertices).map(v => [v[0], v[1]] as V2))).r;
}

/** Rough box an engraved label occupies: about 0.62 em per character, one em tall. */
export function labelBox(at: V2, text: string, size: number): V2[] {
  const hw = 0.31 * size * text.length + 0.12 * size, hh = 0.5 * size;
  return [[at[0] - hw, at[1] - hh], [at[0] + hw, at[1] - hh], [at[0] + hw, at[1] + hh], [at[0] - hw, at[1] + hh]];
}

const segDist = (q: V2, a: V2, b: V2) => {
  const ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1, u = Math.max(0, Math.min(1, ((q[0] - a[0]) * ex + (q[1] - a[1]) * ey) / l2));
  return Math.hypot(a[0] + ex * u - q[0], a[1] + ey * u - q[1]);
};

/**
 * Engraving that never crosses a cut: the piece number goes at the point of the piece farthest from every edge
 * and slit (grid search), shrinking until its box fits; each slit's letter goes just past the slit's end or
 * beside it, whichever box clears the outline, every cut and the labels already placed.
 */
function marksFor(types: string[], pieces: Map<string, Piece>, size: number): Mark[] {
  const marks: Mark[] = [];
  const cache = new Map<string, Omit<Mark, 'panel'>[]>();
  types.forEach((id, k) => {
    if (!cache.has(id)) {
      const p = pieces.get(id)!, placed: V2[][] = [], local: Omit<Mark, 'panel'>[] = [];
      const fits = (box: V2[]) => box.every(q => pointInPolygon(p.outline, q)) && !p.cuts.some(c => convexOverlap(box, c, 0)) && !placed.some(b => convexOverlap(box, b, 0));
      const segs = [p.outline, ...p.cuts].flatMap(poly => poly.map((a, i) => [a, poly[(i + 1) % poly.length]] as [V2, V2]));
      const xs = p.outline.map(q => q[0]), ys = p.outline.map(q => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      let best: V2 = [(x0 + x1) / 2, (y0 + y1) / 2], clear = -1;
      for (let i = 1; i < 40; i++) for (let j = 1; j < 40; j++) {
        const q: V2 = [x0 + ((x1 - x0) * i) / 40, y0 + ((y1 - y0) * j) / 40];
        if (!pointInPolygon(p.outline, q) || p.cuts.some(c => pointInPolygon(c, q))) continue;
        const dmin = Math.min(...segs.map(([a, b]) => segDist(q, a, b)));
        if (dmin > clear) { clear = dmin; best = q; }
      }
      const num = String(k + 1);
      for (let sz = Math.max(5, size * 0.09); sz >= 2.5; sz *= 0.85) {
        const box = labelBox(best, num.length > 1 ? num : '00', sz);
        if (fits(box)) { local.push({at: best, text: '#', size: sz}); placed.push(box); break; }
      }
      p.slits.forEach(({e, d}, si) => {
        const q: V2 = [-d[1], d[0]], text = String.fromCharCode(97 + si);
        for (let sz = Math.max(3.5, size * 0.05); sz >= 2; sz *= 0.85) {
          const candidates: V2[] = [2, 4, 7].map(gap => [e[0] + d[0] * (p.len + gap + sz * 0.6), e[1] + d[1] * (p.len + gap + sz * 0.6)] as V2)
            .concat([1, -1].map(side => [e[0] + d[0] * p.len * 0.55 + q[0] * side * (p.w / 2 + sz * 0.9), e[1] + d[1] * p.len * 0.55 + q[1] * side * (p.w / 2 + sz * 0.9)] as V2));
          const at = candidates.find(c => fits(labelBox(c, text, sz)));
          if (at) { local.push({at, text, size: sz}); placed.push(labelBox(at, text, sz)); return; }
        }
      });
      cache.set(id, local);
    }
    for (const m of cache.get(id)!) marks.push({...m, panel: k, text: m.text === '#' ? String(k + 1) : m.text});
  });
  return marks;
}

export function* gallery(o: GalleryOptions): Generator<GalleryItem | {tried: number; failed: Record<string, number>}> {
  const table = o.intent === 'table';
  const pieces = finishPieces(o.kit, o.size, o.t, o.clearance);
  for (const p of pieces) {
    const problem = pieceProblem(p);
    if (problem) throw new Error(problem);
  }
  const cover = coverPiece(o.kit, o.size, o.t, o.clearance);
  const symmetric = pieces.some(p => slitSymmetry(p).length > 0);
  // Joined pieces sit one lattice step apart (centre to centre); grid boxes are sized in these steps so a box
  // never cuts a row off halfway.
  const reach = Math.max(...pieces.flatMap(p => p.outline.map(q => Math.hypot(q[0], q[1]))));
  const grower = pieces.find(p => p.slits.length >= 2) ?? pieces[0];
  const pitch = Math.hypot(...frameOf(childFrame(IDENTITY, grower, 0, grower, 0, Math.PI / 2)).o), step = pitch > 0.5 * reach ? pitch : reach;
  const byId = new Map([...pieces, cover].map(p => [p.id, p]));
  const failed: Record<string, number> = {};
  const note = (why: string) => { failed[why] = (failed[why] ?? 0) + 1; };
  let found = 0, tried = 0;
  const seen = new Set<string>();
  for (let a = 0; a < o.attempts && found < o.designs; a++) {
    tried++;
    const seed = o.seed * 100003 + a + ['any', 'tower', 'spread', 'compact', 'table', 'random'].indexOf(o.intent) * 7919, r = rng(seed);
    let g: Grown | null;
    let supports: number[] = [];
    let tableCover: Piece | null = null, coverScale = 1;
    let stacked: Stacked | null = null;
    // Random designs: no target shape, but the plan must fit inside a circle of this diameter.
    const random = o.intent === 'random', limit = o.footprint ?? 4 * o.size;
    let footprint = 0;
    if (table) {
      // Tables need height, a level top, a footprint under the cover and joints that cannot fold. Circle kit:
      // stacked grids, layer on layer, as you would build one by hand. Other kits: grow a tree in a box taller
      // than it is wide, or copy one arm round a flat centre piece.
      const mode = o.kit === 'circle' ? 'stacked' : symmetric && a % 2 ? 'symmetric' : 'grid';
      const m = r.pick(o.count > 18 ? [1, 2, 2] : [1, 1, 2]), h = r.pick([2, 3]);
      g = mode === 'stacked' ? (stacked = growStacked(pieces, o.count, o.t, r, {weights: o.weights}))
        : mode === 'symmetric' ? growSymmetric(pieces, o.count, o.t, r, {weights: o.weights})
        : growBoxed(pieces, o.count, o.t, r, step * m + reach + 0.5, step * h + reach + 0.5, {weights: o.weights});
      if (!g) { note(mode === 'stacked' ? 'no grid of that size from these pieces' : mode === 'symmetric' ? 'arms ran into each other' : 'could not fill the box'); continue; }
      const makeCover = (scale: number): Piece => ({...coverPiece(o.kit, o.size * scale, o.t, o.clearance), name: scale === 1 ? 'Cover' : `Cover, ${scale}× piece size`});
      const gate = {minTip: TABLE_MIN_TIP, accept: (st: Stance) => tableStance(st, o.size), upright: mode === 'stacked'};
      if (mode === 'grid') {
        const first = coverDesign(g, makeCover, o.t, gate);
        if ('why' in first) { note(first.why); continue; }
        g = pruneLoose({types: first.g.types.slice(0, -1), X: first.g.X.slice(0, -1), joints: first.g.joints, travel: first.g.travel.slice(0, -1), panels: first.g.panels.slice(0, -1)}, o.count, o.clearance);
      }
      const placed = coverDesign(g, makeCover, o.t, gate);
      if ('why' in placed) { note(placed.why); continue; }
      g = placed.g; supports = placed.spot.supports; tableCover = placed.cover; coverScale = placed.scale;
      // A symmetric design has 1 + k·(arm length) pieces, so only the free-grown ones are held to the count.
      if (mode === 'grid' && g.types.length - 1 < Math.max(4, Math.ceil(o.count * 0.75))) { note('too many loose pieces'); continue; }
    } else {
      // A random design starts from a piece standing on edge (up is one of its in-plane axes, picked at random),
      // grows up from the floor that piece stands on and inside a circle on that floor, then stands on that floor.
      let up: V3 | undefined = random ? r.pick<V3>([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]) : undefined;
      // Grow a fifth over the target: pieces gravity would pull out are pruned once it stands.
      g = grow(pieces, Math.ceil(o.count * 1.2), o.intent, o.t, r, {weights: o.weights, branching: o.branching}, up && {up, radius: limit / 2});
      if (!g) { note(random ? 'could not place enough pieces inside the circle' : 'could not place enough pieces'); continue; }
      // Stand it up, prune what gravity would pull out, and stand it up again: pruning moves the centre of mass.
      let stood = true;
      for (let pass = 0; pass < 3 && stood; pass++) {
        const st = standUp(g, o.intent, up);
        if (!st) { stood = false; break; }
        if (up) up = rotate({R: st.R, t: [0, 0, 0]}, up);
        const before = g.types.length;
        g = pruneLoose(g, o.count, o.clearance);
        if (g.types.length === before) break;
      }
      if (!stood) { note(o.intent === 'tower' ? 'would not stand upright' : 'would not stand'); continue; }
      // Standing on another face (when the floor face tips too soon) can leave a wider plan.
      if (random && (footprint = planDiameter(g.panels)) > limit + 0.5) { note('spreads past the footprint circle'); continue; }
    }
    if (!table && g.types.length < Math.max(3, Math.ceil(o.count * 0.75))) { note('too many loose pieces'); continue; }
    // Skip a design already shown, even turned about its vertical axis: same pieces at the same heights and
    // distances from the middle (rounded to a millimetre).
    const mx = g.panels.reduce((a, p) => a + p.frame.o[0], 0) / g.panels.length, my = g.panels.reduce((a, p) => a + p.frame.o[1], 0) / g.panels.length;
    const sig = g.panels.map((p, k) => `${g!.types[k]}:${Math.round(Math.hypot(p.frame.o[0] - mx, p.frame.o[1] - my))}:${Math.round(p.frame.o[2])}`).sort().join('|');
    if (seen.has(sig)) { note('repeat of a design already shown'); continue; }
    seen.add(sig);
    const grown = g, ids = tableCover ? new Map(byId).set(tableCover.id, tableCover) : byId;
    const steps: Layout['order'] = grown.types.map((_, k) => ({panel: k, motion: grown.travel[k]}));
    const layout: Layout = {title: INTENT_TITLE[o.intent], panels: grown.panels, order: steps, joints: [], params: [], target: {height: 1, width: 1}};
    let d: Design;
    try { d = evaluate(layout, 'kit', o.clearance); } catch { note('check failed to run'); continue; }
    let top: GalleryItem['top'];
    if (random) d.checks.push({label: 'Footprint', level: 'ok', detail: `fits inside a ${Math.round(limit)} mm circle on the floor; the smallest circle round it is ${Math.ceil(footprint)} mm across`});
    if (table) {
      const k = grown.panels.length - 1, rep = coverReport(d, grown.panels, k);
      // Past a tonne the rating is a numerical artefact of a load point sitting almost on a support edge.
      if (rep.loadKg > 1000) rep.loadKg = Infinity;
      top = {height: rep.height, tiltDeg: rep.tiltDeg, safeFrac: rep.safeFrac, loadKg: rep.loadKg, supports: supports.length, coverScale};
      d.checks.push({label: 'Level cover', level: rep.tiltDeg <= 2 ? 'ok' : 'error', detail: `the cover sits ${Math.round(rep.height)} mm up, ${rep.tiltDeg < 0.05 ? 'level' : `tilted ${rep.tiltDeg.toFixed(1)}°`}`});
      // Joints are hinges about their slit lines (src/slots/hinges.ts): the cover's load and the design's own
      // weight must not be able to fold it.
      const coverZ = Math.min(...panelVertices(grown.panels[k]).map(v => v[2]));
      const loads = grown.panels.flatMap((p, i) => i === k ? [] : panelVertices(p).filter(v => v[2] > coverZ - 0.1).map(at => ({piece: i, at})));
      const hinge = hingeModes(grown.panels, new Set([k]), loads), names = (xs: number[]) => xs.map(i => i + 1).join(', ');
      d.checks.push(hinge.foldsUnderLoad || hinge.sags
        ? {label: 'Braced joints', level: 'error', detail: `pieces ${names(hinge.swinging)} can swing on their slit lines, so ${hinge.foldsUnderLoad ? 'weight on the cover folds the design' : 'the design sags under its own weight'}`}
        : hinge.swinging.length
          ? {label: 'Braced joints', level: 'ok', detail: `the frame is braced; only pieces ${names(hinge.swinging)} can turn a little on their own slit lines, which lowers nothing, and nothing rests on them`}
          : {label: 'Braced joints', level: 'ok', detail: 'every slit joint is braced: no piece can swing on its slit line'});
      d.checks.push({label: 'Usable surface', level: rep.safeFrac >= 0.3 ? 'ok' : rep.safeFrac >= 0.12 ? 'warn' : 'error',
        detail: `${Math.round(rep.safeFrac * 100)}% of the cover lies over what holds it up; a load there cannot tip the cover off${isFinite(rep.loadKg) ? `, and the whole design tips only past ${rep.loadKg.toFixed(1)} kg` : ', nor tip the design'}`});
      d.ok = d.checks.every(c => c.level !== 'error');
    }
    if (!d.ok) { for (const c of d.checks.filter(c => c.level === 'error')) note(c.label.toLowerCase()); continue; }
    // Build in growth order: each piece's straight slide was checked against everything placed before it.
    const L = (k: number) => String.fromCharCode(97 + k), kind = (k: number) => ids.get(grown.types[k])!.name.toLowerCase();
    const coverText = `${stacked ? 'Lay' : 'Stand it up and lay'} the cover (piece ${grown.panels.length}${coverScale === 1 ? '' : `, ${coverScale}× the piece size`}) on top, resting on pieces ${supports.map(i => i + 1).join(', ')}.`;
    const scale = o.size;
    let text: string[];
    if (stacked) {
      // Upper layers are built raised on the bench and lowered as one unit (a group step moves them together).
      const lift = scale * 0.9;
      text = [...stacked.steps.map(st => st.text), coverText];
      d.steps = [...stacked.steps.map(st => st.unit
        ? {panel: st.pieces[0], group: st.pieces, travel: st.travel, distance: lift, how: st.text}
        : {panel: st.pieces[0], travel: st.travel, distance: scale * 1.2, how: st.text}),
        {panel: grown.panels.length - 1, travel: [0, 0, -1] as V3, distance: scale * 1.2, how: coverText}];
    } else {
      text = [`Hold piece 1 (${kind(0)}).`, ...grown.joints.map(j => `Piece ${j.child + 1} (${kind(j.child)}): slit ${L(j.childSlit)} onto slit ${L(j.parentSlit)} of piece ${j.parent + 1}.`)];
      if (table) text.push(coverText);
      d.steps = grown.types.map((_, k) => ({panel: k, travel: (grown.travel[k] ?? [0, 0, -1]) as V3, distance: scale * 1.2, how: text[k]}));
    }
    d.title = `${INTENT_TITLE[o.intent]} · ${grown.types.length} pieces`;
    const counts = new Map<string, number>();
    for (const id of grown.types) counts.set(id, (counts.get(id) ?? 0) + 1);
    found++;
    yield {
      id: `${o.kit}-${o.intent}-${seed}`, seed, design: d, top, footprint: random ? {needed: footprint, limit} : undefined,
      score: table ? top!.safeFrac + Math.min(d.support.tipDeg, 30) / 30 : score(d, o.intent), steps: text.map(t => ({text: t})),
      parts: [...counts.entries()].map(([id, count]) => ({id, name: ids.get(id)!.name, count})),
      marks: marksFor(grown.types, ids, o.size),
    };
  }
  yield {tried, failed};
}
