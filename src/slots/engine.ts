/**
 * Engine: layout → carved, checked design; brief → best of several seeded candidates.
 *
 * Checks, in order: carve declared joints · residual interference (SAT) · each panel still one piece with a
 * usable ligament · an assembly sequence found independently by the planner · ground support and tip angle ·
 * how each part is held · parts that only rest on others stay on.
 */
import {carve} from './carve.js';
import {collisions, panelBox, type Hit} from './collide.js';
import {kitDefaults, MATRIX, SLIT_INFO, type Layout} from './generators.js';
import {fitRange, makeModule, moduleProblem, ringClear, ringSolutions, type KitParams} from './kit.js';
import {integrity} from './integrity.js';
import {deg, dot, rng, type V2, type V3} from './math.js';
import {panelArea, type Frame, type Role, type SlitType} from './panel.js';
import {describeTravel, planAssembly} from './plan.js';
import {defaultThickness, type Brief} from './prompt.js';
import {groundSupport, partHold, restingSupport, type Hold} from './stability.js';

export interface Options {slit: SlitType; thickness: number | null; clearance: number; seed: number; candidates: number; kit?: KitParams | null}

/** What a pinwheel kit admits: the plane angles its slits fit, and every flat ring it closes. */
export interface KitReport {kit: KitParams; fitDeg: [number, number]; rings: {pieces: number; slits: [number, number]; anglesDeg: [number, number]; clear: boolean}[]; problem: string | null}

export interface PanelOut {
  id: number; name: string; role: Role; frame: Frame; t: number;
  pieces: V2[][]; loops: V2[][]; cuts: {poly: V2[]; kind: string}[];
  area: number; parts: number; ligament: number; ligamentAt: V2; hold: Hold; travel: V3;
}

export interface JointOut {a: number; b: number; slit: SlitType; mode: string; angleDeg: number; slitWidth: number}
export interface Check {label: string; level: 'ok' | 'warn' | 'error'; detail: string}

export interface Design {
  ok: boolean;
  score: number;
  title: string;
  slit: SlitType;
  thickness: number;
  clearance: number;
  panels: PanelOut[];
  joints: JointOut[];
  /** Build order. `group`: pieces built as a unit off to one side and moved into place together in this step. */
  steps: {panel: number; travel: V3; distance: number; how: string; group?: number[]}[];
  hits: Hit[];
  support: {hull: V2[]; com: V3; mass: number; margin: number; tipDeg: number};
  checks: Check[];
  params: [string, string][];
  size: {width: number; depth: number; height: number};
  target: {height: number; width: number};
  notes: string[];
}

export interface Result {
  brief: Brief;
  slit: SlitType;
  design: Design | null;
  unsupported: string | null;
  tried: {seed: number; ok: boolean; score: number; why: string}[];
  kit: KitReport | null;
}

export function evaluate(layout: Layout, slit: SlitType, clearance: number): Design {
  const {panels, order, joints} = layout;
  const t = panels[0].t;
  const maxDim = Math.max(...panels.flatMap(p => { const b = panelBox(p); return [b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]]; }));
  const notes = carve(panels, order, joints, clearance, 3 * maxDim + 500);
  const checks: Check[] = [];

  const hits = collisions(panels);
  checks.push(hits.length
    ? {label: 'Interference', level: 'error', detail: `${hits.length} pair(s) overlap, deepest ${hits.reduce((m, h) => Math.max(m, h.depth), 0).toFixed(2)} mm`}
    : {label: 'Interference', level: 'ok', detail: `none: ${panels.length * (panels.length - 1) / 2} panel pairs checked by SAT`});

  const ints = panels.map(integrity);
  const split = panels.filter((_, i) => ints[i].parts > 1);
  checks.push(split.length ? {label: 'Panels intact', level: 'error', detail: `${split.map(p => p.name).join(', ')} cut through`} : {label: 'Panels intact', level: 'ok', detail: 'every panel stays one piece'});
  const ligs = ints.map(i => i.ligament.width), minLig = Math.min(...ligs), li = ligs.indexOf(minLig);
  checks.push({label: 'Thinnest bridge', level: minLig < 0.6 * t ? 'error' : minLig < 1.5 * t ? 'warn' : 'ok', detail: `${minLig.toFixed(1)} mm in ${panels[li].name} (${(minLig / t).toFixed(1)}× sheet)`});

  const intended = new Map(order.map(s => [s.panel, s.motion]));
  const plan = planAssembly(panels, intended, order.map(s => s.panel));
  checks.push(plan.ok
    ? {label: 'Assembly', level: 'ok', detail: `found independently: ${plan.steps.length} steps, each a straight collision-free path`}
    : layout.loop
      ? {label: 'Assembly', level: 'warn', detail: `${plan.steps.length ? `${plan.steps.length} pieces go in on straight slides; ` : ''}${layout.loop}`}
      : {label: 'Assembly', level: 'error', detail: `stuck with ${plan.stuck.map(i => panels[i].name).join(', ')} still in place`});

  const sup = groundSupport(panels);
  checks.push({label: 'Stands', level: sup.margin <= 0 ? 'error' : sup.tipDeg < 6 ? 'warn' : 'ok',
    detail: sup.margin <= 0 ? 'centre of mass is not over the footprint; it falls over' : `tips at ${sup.tipDeg.toFixed(1)}°; a side push of ${Math.round(Math.tan((sup.tipDeg * Math.PI) / 180) * 100)}% of its weight`});

  const z0 = Math.min(...panels.map(p => panelBox(p).lo[2]));
  const nudge = 1.5 + clearance;
  const holds = panels.map(p => partHold(p, panels.filter(q => q !== p), z0, nudge));
  const loose = panels.filter((_, i) => holds[i].hold === 'loose');
  const counts = (h: Hold) => holds.filter(x => x.hold === h).length;
  checks.push({label: 'Parts held', level: loose.length ? 'error' : 'ok',
    detail: loose.length ? `${loose.map(p => p.name).join(', ')} can drop out` : `${counts('locked')} locked, ${counts('seated')} seated by gravity, ${counts('friction')} friction-held`});

  // Kit pieces come with their slits cut; they are joined even though no joint was declared for carving.
  const jointed = new Set([...joints.flatMap(j => [j.a, j.b]), ...panels.filter(p => p.role === 'module').map(p => p.id)]);
  for (const p of panels) {
    if (jointed.has(p.id) || panelBox(p).lo[2] <= z0 + 0.05) continue;
    const rs = restingSupport(p, panels.filter(q => q !== p));
    checks.push({label: `${p.name} rests`, level: rs.margin <= 0 ? 'error' : 'ok',
      detail: rs.margin <= 0 ? 'its centre is not over what holds it up' : `on ${rs.contacts} contact points, centre ${Math.round(rs.margin)} mm inside their outline`});
  }

  // Parts the planner could not take out go first, in the generator's order, on their intended paths.
  const stuck = order.filter(st => plan.stuck.includes(st.panel)).map(st => ({panel: st.panel, travel: st.motion ?? ([0, 0, -1] as V3), distance: maxDim * 0.4}));
  const steps = [...stuck, ...plan.steps];
  const travel = new Map(steps.map(s => [s.panel, s.travel]));
  const out: PanelOut[] = panels.map((p, i) => ({
    id: p.id, name: p.name, role: p.role, frame: p.frame, t: p.t, pieces: p.pieces, loops: ints[i].loops,
    cuts: p.cuts.map(c => ({poly: c.poly, kind: c.kind})), area: panelArea(p), parts: ints[i].parts,
    ligament: ints[i].ligament.width, ligamentAt: ints[i].ligament.at, hold: holds[i].hold, travel: travel.get(p.id) ?? [0, 0, -1],
  }));

  const jOut: JointOut[] = joints.map(j => {
    const A = panels[j.a], B = panels[j.b], c = Math.abs(dot(A.frame.n, B.frame.n)), s = Math.sqrt(Math.max(0, 1 - c * c));
    return {a: j.a, b: j.b, slit: j.slit, mode: j.mode, angleDeg: deg(Math.acos(Math.min(1, c))), slitWidth: s > 1e-6 ? (B.t + A.t * c) / s + clearance : NaN};
  });

  const lo = [0, 1, 2].map(k => Math.min(...panels.map(p => panelBox(p).lo[k]))), hi = [0, 1, 2].map(k => Math.max(...panels.map(p => panelBox(p).hi[k])));
  const size = {width: hi[0] - lo[0], depth: hi[1] - lo[1], height: hi[2] - lo[2]};
  const ok = checks.every(c => c.level !== 'error');
  const fit = Math.abs(size.height - layout.target.height) / layout.target.height;
  const score = (ok ? 100 : 0) + Math.min(sup.tipDeg, 25) * 1.6 + Math.min(minLig / t, 4) * 5 + (counts('locked') + counts('seated')) / panels.length * 15 - fit * 30 - checks.filter(c => c.level === 'warn').length * 5;

  return {
    ok, score, title: layout.title, slit, thickness: t, clearance, panels: out, joints: jOut,
    steps: steps.map((s, i) => ({...s, how: describeTravel(s.travel) + (layout.loop && !plan.ok && i === stuck.length - 1 ? ', flexing it to close the loop' : '')})), hits,
    support: {hull: sup.hull, com: sup.com, mass: sup.mass, margin: sup.margin, tipDeg: sup.tipDeg},
    checks, params: layout.params, size, target: layout.target, notes,
  };
}

/** Generate `candidates` seeded variants and keep the best that passes every check. */
export function kitReport(kit: KitParams, t: number, clearance: number): KitReport {
  const unit = makeModule(kit, 100, t, clearance), problem = moduleProblem(unit), range = fitRange(t, kit.slitWidth * t, clearance);
  const toDeg = (r: number) => (r * 180) / Math.PI, plane = (phi: number) => toDeg(((phi % Math.PI) + Math.PI) % Math.PI);
  const rings = problem ? [] : ringSolutions(unit, range).map(r => ({pieces: 2 * r.N, slits: [r.a + 1, r.b + 1] as [number, number], anglesDeg: [plane(r.phiA), plane(r.phiB)] as [number, number], clear: ringClear(unit, r, t)}));
  return {kit, fitDeg: [toDeg(range[0]), toDeg(range[1])], rings, problem};
}

export function generate(brief: Brief, o: Options): Result {
  const cell = MATRIX[brief.typology][o.slit];
  // Kit pieces are a sheet-goods kit: default to thin stock.
  const t = o.thickness ?? brief.thickness ?? (o.slit === 'kit' ? Math.min(6, defaultThickness(brief)) : defaultThickness(brief));
  const kit = o.kit ?? kitDefaults(brief.kitSides ?? (brief.typology === 'tower' ? 6 : 10));
  const report = o.slit === 'kit' ? kitReport(kit, t, o.clearance) : null;
  if (brief.unsupported) return {brief, slit: o.slit, design: null, unsupported: brief.unsupported, tried: [], kit: report};
  if (!cell.gen) return {brief, slit: o.slit, design: null, unsupported: `${SLIT_INFO[o.slit].name} × ${brief.typology}: ${cell.what}`, tried: [], kit: report};
  let best: Design | null = null;
  const tried: Result['tried'] = [];
  for (let i = 0; i < o.candidates; i++) {
    const seed = o.seed * 7919 + i;
    try {
      const d = evaluate(cell.gen(brief, t, rng(seed), {kit, clearance: o.clearance}), o.slit, o.clearance);
      tried.push({seed, ok: d.ok, score: d.score, why: d.ok ? '' : d.checks.filter(c => c.level === 'error').map(c => c.label).join(', ')});
      if (!best || d.score > best.score) best = d;
    } catch (e) {
      tried.push({seed, ok: false, score: 0, why: e instanceof Error ? e.message : 'failed'});
    }
  }
  return {brief, slit: o.slit, design: best, unsupported: null, tried, kit: report};
}
