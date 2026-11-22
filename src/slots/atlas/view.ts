/**
 * Atlas forms as engine designs, for the build scene (ui/shared.tsx Scene) and the cut-sheet tools: the form's
 * discs and its cut-to-fit top, set on the floor and centred, checked by the engine, with build steps taken from the
 * group build sequence the judge found (a group is built on the bench and slid in as one, as grids' layers are).
 */
import {evaluate, type Design} from '../engine.js';
import {add, type V3} from '../math.js';
import {makePanel, panelVertices, type Panel} from '../panel.js';
import {placementOrder, type BuildStep} from './assembly.js';
import type {Verdict} from './judge.js';
import {DIRS, fromKey, type Kit} from './lattice.js';

/** What the atlas stores for a form: enough to rebuild it exactly. */
export interface AtlasForm {key: string; steps: BuildStep[]; top: Verdict['top']}

const way = (d: number) => (d === 5 ? 'down' : d === 4 ? 'up' : `sideways along ${['+x', '−x', '+y', '−y'][d]}`);

export function atlasDesign(kit: Kit, form: AtlasForm, title = 'Atlas form'): Design {
  const f = fromKey(form.key), raw: Panel[] = f.panels(kit);
  if (form.top) raw.push(makePanel(raw.length, 'Top', 'top', form.top.outline, form.top.frame, kit.t));
  const vs = raw.flatMap(panelVertices), lo = [0, 1, 2].map(k => Math.min(...vs.map(v => v[k]))), hi = [0, 1, 2].map(k => Math.max(...vs.map(v => v[k])));
  const shift: V3 = [-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]];
  const panels = raw.map(p => ({...p, frame: {...p.frame, o: add(p.frame.o, shift)}}));
  // Each disc moves with its step: alone, or with its group once the group is built on the bench.
  const travelOf = new Map<number, V3>();
  for (const s of form.steps) if (s.travel >= 0) for (const k of s.group) travelOf.set(k, DIRS[s.travel] as V3);
  const order = placementOrder(form.steps).map(k => ({panel: k, motion: travelOf.get(k) ?? null}));
  if (form.top) order.push({panel: raw.length - 1, motion: [0, 0, -1]});
  const d = evaluate({title, panels, order, joints: [], params: [], target: {height: 1, width: 1}}, 'kit', kit.clearance);

  // The engine's planner only lifts single pieces or everything above a height; the judge's group sequence is the
  // one that was checked, so it replaces the planner's verdict and steps.
  const groups = form.steps.filter(s => s.group.length > 1).length;
  d.checks = d.checks.map(c => (c.label === 'Assembly' ? {label: 'Assembly', level: form.steps.length ? 'ok' : 'error', detail: form.steps.length ? `group build sequence: ${form.steps.length} steps${groups ? `, ${groups} built on the bench and slid in as one` : ''}` : 'no build sequence found'} : c));
  d.ok = d.checks.every(c => c.level !== 'error');
  const travel = kit.size * 1.2, names = (ks: number[]) => ks.map(k => k + 1).join(', ');
  const benchText = (steps: BuildStep[]): string => steps.map(s => (s.travel < 0 ? `hold ${names(s.group)}` : s.bench.length ? `(${benchText(s.bench)}) ${way(s.travel)}` : `${names(s.group)} ${way(s.travel)}`)).join(', then ');
  d.steps = form.steps.map(s => s.travel < 0
    ? {panel: s.group[0], travel: [0, 0, -1] as V3, distance: travel, how: `Hold piece ${s.group[0] + 1}.`}
    : s.group.length > 1
      ? {panel: s.group[0], group: s.group, travel: DIRS[s.travel] as V3, distance: travel, how: `Build pieces ${names(s.group)} on the bench (${benchText(s.bench)}), then slide them in together, ${way(s.travel)}.`}
      : {panel: s.group[0], travel: DIRS[s.travel] as V3, distance: travel, how: `Slide piece ${s.group[0] + 1} in, ${way(s.travel)}.`});
  if (form.top) d.steps.push({panel: raw.length - 1, travel: [0, 0, -1], distance: travel, how: 'Lay the top on, cut to fit.'});
  return d;
}
