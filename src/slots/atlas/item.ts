/**
 * Saved atlas runs (npm run atlas → atlas-runs/<stamp>/atlas.json) as the page reads them, and an atlas form as a
 * gallery item, so the Kit gallery's design sheet (3D build, checks, steps, laser files) can show it. The table
 * checks the atlas judged are added to the engine's own, so a near miss shows exactly what it fails.
 */
import {marksFor} from '../engrave.js';
import type {GalleryItem} from '../gallery.js';
import type {Piece} from '../kits.js';
import type {BuildStep} from './assembly.js';
import type {Features} from './explore.js';
import {FAIL, type FailName, type Metrics, type TableRules, type Verdict} from './judge.js';
import {fromKey, pieceId, type Kit} from './lattice.js';
import {atlasDesign} from './view.js';

export interface AtlasEntry {
  key: string; discs: number; fails: number; failing: FailName[];
  /** Its joined structure is an egg-crate grid layout. */
  grid: boolean;
  /** Structural novelty and fingerprint distance from the nearest egg crate (runs made before novelty lack them). */
  novelty?: number;
  crate?: number;
  features: Omit<Features, 'crate'> & {crate?: string};
  metrics: Metrics; steps: BuildStep[]; top: Verdict['top'];
}

export interface AtlasCell {cell: string; seen: number; minDiscs: number; legal?: AtlasEntry; near?: AtlasEntry}

export interface AtlasRun {
  params: {rank?: 'novel' | 'useful' | 'both'; size: number; sheet: number; clearance: number; pitch: number; rules: TableRules; iterations: number; seed: number; judgeTo: number; countTo: number; gridDraws: number; treeDraws: number};
  levels: {n: number; forms: number; findSeconds: number; judged: boolean; legal: number; byFails: Record<string, number>}[];
  coverage: {cells: number; reached: number};
  search: {evaluations: number; seconds: number; grids: number; trees: number};
  cells: AtlasCell[];
  byFails: {fails: number; failing: FailName[]; count: number; example: AtlasEntry}[];
}

export function atlasItem(kit: Kit, e: AtlasEntry, rules: TableRules, title: string): GalleryItem {
  const d = atlasDesign(kit, e, title), f = fromKey(e.key);
  const types: string[] = f.discs.map(p => pieceId(p)!), pieces = new Map<string, Piece>(kit.pieces);
  if (e.top) {
    pieces.set('CF', {id: 'CF', name: 'Top, cut to fit', outline: e.top.outline, slits: [], len: 0, cuts: [], w: kit.t + kit.clearance});
    types.push('CF');
  }
  const fails = (k: FailName) => (e.fails & FAIL[k]) !== 0, m = e.metrics;
  d.checks.push(
    {label: 'Table stance', level: fails('falls') ? 'error' : 'ok', detail: `${m.tipDeg > 0 ? `tips at ${m.tipDeg.toFixed(1)}°` : 'falls over'} with the top on; a table must tip only past ${rules.minTip}°`},
    {label: 'Braced joints', level: fails('sags') || fails('folds') ? 'error' : 'ok', detail: fails('sags') ? 'a slit joint can swing, so it sags under its own weight' : fails('folds') ? 'a slit joint can swing under weight on top' : 'no slit joint can swing under its own weight or weight on top (taking the floor as non-slip)'},
    {label: 'Flat surface', level: fails('surface') ? 'error' : 'ok', detail: fails('surface') ? 'no level face on top touched by three supports off a line' : `a level top cut to fit, on ${m.supports} supports, ${Math.round(m.safeFrac * 100)}% of it over them`},
    {label: 'Height', level: fails('short') ? 'error' : 'ok', detail: `${e.top ? 'surface' : 'highest point'} ${Math.round(m.height)} mm up; a table needs ${rules.height} mm`},
  );
  d.ok = d.checks.every(c => c.level !== 'error');
  const counts = new Map<string, number>();
  for (const id of types) counts.set(id, (counts.get(id) ?? 0) + 1);
  let top: GalleryItem['top'];
  if (e.top) {
    const xs = e.top.outline.map(q => q[0]), ys = e.top.outline.map(q => q[1]), w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
    top = {height: m.height, tiltDeg: (Math.acos(Math.min(1, Math.abs(e.top.frame.n[2]))) * 180) / Math.PI, safeFrac: m.safeFrac, loadKg: m.tipLoadKg ?? Infinity, supports: m.supports, coverScale: 1, shape: 'fitted', width: Math.max(w, h), depth: Math.min(w, h)};
  }
  return {
    id: e.key, seed: 0, design: d, stands: !fails('falls'), top,
    parts: [...counts.entries()].map(([id, count]) => ({id, name: pieces.get(id)!.name, count})),
    steps: d.steps.map(s => ({text: s.how})),
    marks: marksFor(types, pieces, kit.size),
  };
}
