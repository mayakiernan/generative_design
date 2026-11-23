/**
 * Saved rule-free runs (npm run atlas:free → atlas-runs/<stamp>-free/free-atlas.json) as the page reads them, and a
 * free form as a gallery item for the Kit gallery's design sheet (3D build, checks, steps, laser files).
 *
 * The engine's own checks that assume the kit's rules (its single-piece build planner, its hold and rest tests) are
 * replaced by the statics judge's verdicts, so the sheet says what the atlas judged.
 */
import {evaluate, type Check, type Design} from '../engine.js';
import {marksFor} from '../engrave.js';
import type {GalleryItem} from '../gallery.js';
import type {Piece} from '../kits.js';
import {add, type V3} from '../math.js';
import {makePanel, panelVertices, type Panel} from '../panel.js';
import {DIRS, pieceId, type Kit} from '../atlas/lattice.js';
import {placementOrder} from '../atlas/assembly.js';
import type {TableRules} from '../atlas/judge.js';
import {fineKit, freePanels, fromFreeKey} from './free.js';
import {FREE_FAIL, FREE_FAIL_TEXT, type FreeFailName} from './judge.js';
import type {FreeEntry} from './explore.js';

export interface FreeRun {
  params: {mode: 'free'; size: number; sheet: number; clearance: number; pitch: number; rules: TableRules; iterations: number; seed: number; statics: {mu: number; muFloor: number}; from: string};
  seeding: {kitLegal: number; verdicts: Record<string, number>};
  search: {evaluations: number; seconds: number; moves: Record<string, {tried: number; legal: number}>; numericalTroubles: number};
  cells: {cell: string; seen: number; minPieces: number; legal?: FreeEntry; near?: FreeEntry}[];
  byFails: {fails: number; failing: FreeFailName[]; count: number; example?: FreeEntry}[];
}

const way = (d: number) => (d === 5 ? 'down' : d === 4 ? 'up' : `sideways along ${['+x', '−x', '+y', '−y'][d]}`);

export function freeItem(kit: Kit, e: FreeEntry, rules: TableRules, title: string): GalleryItem {
  const form = fromFreeKey(e.key), fine = fineKit(kit), raw: Panel[] = freePanels(fine, form), n = raw.length;
  if (e.top) raw.push(makePanel(n, 'Top', 'top', e.top.outline, e.top.frame, kit.t));
  const vs = raw.flatMap(panelVertices), lo = [0, 1, 2].map(k => Math.min(...vs.map(v => v[k]))), hi = [0, 1, 2].map(k => Math.max(...vs.map(v => v[k])));
  const shift: V3 = [-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]];
  const panels = raw.map(p => ({...p, frame: {...p.frame, o: add(p.frame.o, shift)}}));
  const travelOf = new Map<number, V3>();
  for (const s of e.steps) if (s.travel >= 0) for (const k of s.group) travelOf.set(k, DIRS[s.travel] as V3);
  const order = placementOrder(e.steps).map(k => ({panel: k, motion: travelOf.get(k) ?? null}));
  if (e.top) order.push({panel: n, motion: [0, 0, -1]});
  const d: Design = evaluate({title, panels, order, joints: [], params: [], target: {height: 1, width: 1}}, 'kit', kit.clearance);

  const fails = (k: FreeFailName) => (e.fails & FREE_FAIL[k]) !== 0, m = e.metrics;
  const keep = new Set(['Interference', 'Panels intact', 'Thinnest bridge']);
  const groups = e.steps.filter(s => s.group.length > 1).length;
  const checks: Check[] = d.checks.filter(c => keep.has(c.label));
  checks.push(
    {label: 'Assembly', level: fails('build') ? 'error' : 'ok', detail: fails('build') ? FREE_FAIL_TEXT.build : `group build sequence: ${e.steps.length} steps${groups ? `, ${groups} built on the bench and slid in as one` : ''}`},
    {label: 'Holds under load', level: fails('sags') ? 'error' : 'ok', detail: fails('sags') ? 'no set of contact forces holds every piece up with a load on the top as heavy as the table' : 'contact forces exist that hold every piece up with a load on the top as heavy as the table'},
    {label: 'Top pushed sideways', level: fails('racks') ? 'error' : 'ok', detail: m.rackPush === null ? 'no top to push' : m.rackPush < 0 ? 'does not hold at all' : `takes a push on the top of ${Math.round(Math.min(m.rackPush, 1) * 100)}%${m.rackPush >= 1 ? '+' : ''} of its loaded weight before it racks or the top slides (needs ${Math.round(Math.tan((rules.minTip * Math.PI) / 180) * 100)}%)`},
    {label: 'Weight over a support', level: fails('folds') ? 'error' : 'ok', detail: fails('folds') ? FREE_FAIL_TEXT.folds : 'holds the load over each support in turn'},
    {label: 'Table stance', level: fails('falls') ? 'error' : 'ok', detail: m.stanceDeg < 0 ? 'cannot stand' : `as one piece, tips or slides once tilted ${m.stanceDeg.toFixed(1)}° (needs ${rules.minTip}°)`},
    {label: 'Flat surface', level: fails('surface') ? 'error' : 'ok', detail: fails('surface') ? FREE_FAIL_TEXT.surface : `a level top cut to fit, on ${m.supports} supports`},
    {label: 'Height', level: fails('short') ? 'error' : 'ok', detail: `${e.top ? 'surface' : 'highest point'} ${Math.round(m.height)} mm up; a table needs ${rules.height} mm`},
    {label: 'Kit rules broken', level: m.breaks ? 'warn' : 'ok', detail: m.breaks ? `${m.clips} slit${m.clips === 1 ? '' : 's'} clipped onto a plain edge, ${m.rests} piece${m.rests === 1 ? '' : 's'} resting on another` : 'joins only slit into slit'},
  );
  if (e.triage) checks.push({label: 'Robustness', level: e.triage.label === 'robust' ? 'ok' : 'warn', detail: e.triage.label === 'robust' ? 'still stands with less friction (0.3) and with slits cut to a press fit' : e.triage.label === 'needs friction' ? 'fails with friction 0.3: it leans on grip' : e.triage.label === 'needs slack' ? 'runs into something with slits cut to a press fit' : 'joins two notched half discs notch to notch, a joint too shallow to hold'});
  d.checks = checks;
  d.ok = checks.every(c => c.level !== 'error');
  const travel = kit.size * 1.2, names = (ks: number[]) => ks.map(k => k + 1).join(', ');
  d.steps = e.steps.map(s => s.travel < 0
    ? {panel: s.group[0], travel: [0, 0, -1] as V3, distance: travel, how: `Hold piece ${s.group[0] + 1}.`}
    : s.group.length > 1
      ? {panel: s.group[0], group: s.group, travel: DIRS[s.travel] as V3, distance: travel, how: `Build pieces ${names(s.group)} on the bench, then slide them in together, ${way(s.travel)}.`}
      : {panel: s.group[0], travel: DIRS[s.travel] as V3, distance: travel, how: `Slide piece ${s.group[0] + 1} in, ${way(s.travel)}.`});
  if (e.top) d.steps.push({panel: n, travel: [0, 0, -1], distance: travel, how: 'Lay the top on, cut to fit.'});

  const types: string[] = form.map(p => pieceId(p)!), pieces = new Map<string, Piece>(kit.pieces);
  if (e.top) {
    pieces.set('CF', {id: 'CF', name: 'Top, cut to fit', outline: e.top.outline, slits: [], len: 0, cuts: [], w: kit.t + kit.clearance});
    types.push('CF');
  }
  const counts = new Map<string, number>();
  for (const id of types) counts.set(id, (counts.get(id) ?? 0) + 1);
  let top: GalleryItem['top'];
  if (e.top) {
    const xs = e.top.outline.map(q => q[0]), ys = e.top.outline.map(q => q[1]), w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    top = {height: m.height, tiltDeg: 0, safeFrac: 1, loadKg: Infinity, supports: m.supports, coverScale: 1, shape: 'fitted', width: Math.max(w, h), depth: Math.min(w, h)};
  }
  return {
    id: e.key, seed: 0, design: d, stands: !fails('falls'), top,
    parts: [...counts.entries()].map(([id, count]) => ({id, name: pieces.get(id)!.name, count})),
    steps: d.steps.map(s => ({text: s.how})),
    marks: marksFor(types, pieces, kit.size),
  };
}
