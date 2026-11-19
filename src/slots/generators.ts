/**
 * Generators: prompt brief + slit type → panel layout, assembly order and declared joints.
 *
 * Each slit type is a different joining rule, so it reaches different forms:
 *   cross   two panels cross through their middles, slit halfway from opposite edges (half-lap)
 *   radial  k ≥ 3 panels share one axis; staggered slits leave panel i a bridge in the i-th of k bands
 *   edge    panels cross near their ends, so they close into rings and stack into cribs
 *   tab     a tab on one panel's edge passes through a closed slot in another's face
 *
 * Generators only place panels and say which pairs join and how. The carver cuts the slits from the insertion
 * paths, and the engine checks the result, so a generator mistake shows up as a failed check, not a bad design.
 */
import {add as add3, clamp, dot as dot3, rad, scale as scale3, sub as sub3, type Rng, type V2, type V3} from './math.js';
import {arch, circle, flatFrame, makePanel, profile, rect, regular, roundedRect, truncate, uprightFrame, windowCut, withTabs, type Frame, type Panel, type Role, type SlitType} from './panel.js';
import type {JointSpec, Step} from './carve.js';
import type {Brief, Plan, Typology} from './prompt.js';
import {rayHit} from './poly2d.js';
import {exitDistance, panelDepth, pathBlocker} from './collide.js';
import {apply, chain, chainPanels, compose, DEFAULT_KIT, frameOf, ringClear, rotationBetween, fitRange, makeModule, moduleProblem, restingPose, ringPlacement, ringSolutions, rotate, screwOf, type KitParams, type Module, type Xf} from './kit.js';
import {massProps} from './stability.js';
import {panelVertices} from './panel.js';

export interface Layout {
  title: string;
  panels: Panel[];
  order: Step[];
  joints: JointSpec[];
  params: [string, string][];
  target: {height: number; width: number};
  /** Set when the design closes a loop of slit joints that rigid pieces cannot close by straight slides. */
  loop?: string;
}

export interface GenCtx {kit: KitParams; clearance: number}
export type Gen = (b: Brief, t: number, r: Rng, ctx: GenCtx) => Layout;

const DOWN: V3 = [0, 0, -1];
const f0 = (x: number) => `${Math.round(x)}`;

class Builder {
  panels: Panel[] = [];
  order: Step[] = [];
  joints: JointSpec[] = [];
  params: [string, string][] = [];
  constructor(public t: number, public slit: SlitType) {}
  add(name: string, role: Role, outline: V2[], frame: Frame, design: V2[][] = [], motion: V3 | null = DOWN) {
    const id = this.panels.length;
    this.panels.push(makePanel(id, name, role, outline, frame, this.t, design));
    this.order.push({panel: id, motion});
    return id;
  }
  lap(a: number, b: number, split: V3, slit = this.slit) { this.joints.push({a, b, mode: 'lap', split, slit}); }
  through(a: number, b: number, slit = this.slit) { this.joints.push({a, b, mode: 'through', slit}); }
  moving(a: number, b: number, slit = this.slit) { this.joints.push({a, b, mode: 'moving', slit}); }
  param(k: string, v: string | number) { this.params.push([k, typeof v === 'number' ? f0(v) : v]); }
  done(title: string, target: {height: number; width: number}, loop?: string): Layout {
    return {title, panels: this.panels, order: this.order, joints: this.joints, params: this.params, target, loop};
  }
}

/* ---------- shared geometry ---------- */

export function topOutline(plan: Plan, W: number, D: number): V2[] {
  if (plan === 'round') return circle(W / 2, 72);
  if (plan === 'square') return roundedRect(W, W, W * 0.04);
  if (plan === 'rect') return roundedRect(W, D, Math.min(W, D) * 0.06);
  if (plan === 'hex') return regular(6, W / 2, 0);
  return regular(3, W * 0.62, Math.PI / 2);
}

/** Distance from the origin to an outline along direction θ. */
export function extent(outline: V2[], theta: number) {
  const segs = outline.map((a, i) => [a, outline[(i + 1) % outline.length]] as [V2, V2]);
  return rayHit([0, 0], [Math.cos(theta), Math.sin(theta)], segs, 0);
}

const inradius = (outline: V2[]) => Math.min(...Array.from({length: 72}, (_, i) => extent(outline, (i / 72) * Math.PI * 2)));

/** Half-width of a symmetric outline at height y (ray from the centre line). */
function halfWidthAt(outline: V2[], y: number) {
  const segs = outline.map((a, i) => [a, outline[(i + 1) % outline.length]] as [V2, V2]);
  return rayHit([0, y], [1, 0], segs, 0);
}

/** Slit half-width for two panels of thickness t crossing at dihedral angle θ: (t + t|cos θ|) / (2 sin θ). */
export const slitHalf = (t: number, theta: number) => (t + t * Math.abs(Math.cos(theta))) / (2 * Math.sin(theta));

function pickPlan(b: Brief, r: Rng, options: Plan[]): Plan {
  if (b.plan) return b.plan;
  if (b.depth < b.width * 0.78) return 'rect';
  return r.pick(options);
}

/** Windows stacked up an upright panel, either on the centre line or as a mirrored pair. */
function windows(outline: V2[], H: number, rows: number, kind: 'rect' | 'diamond' | 'round', clearHalf: number, t: number, paired: boolean, y0 = 0.08, y1 = 0.86): V2[][] {
  const out: V2[][] = [];
  for (let j = 0; j < rows; j++) {
    const y = H * (y0 + ((j + 0.5) / rows) * (y1 - y0)), band = (H * (y1 - y0)) / rows;
    const hw = Math.min(halfWidthAt(outline, y - band * 0.3), halfWidthAt(outline, y + band * 0.3));
    if (!isFinite(hw)) continue;
    if (paired) {
      const room = hw - clearHalf - 3 * t;
      if (room < 4 * t) continue;
      const w = room * 0.62, h = Math.min(band * 0.6, w * 1.8), cx = clearHalf + 1.5 * t + room / 2;
      out.push(windowCut(kind, -cx, y, w, h), windowCut(kind, cx, y, w, h));
    } else {
      const w = Math.min(hw - 3 * t, clearHalf - 3 * t) * 1.6;
      if (w < 4 * t) continue;
      out.push(windowCut(kind, 0, y, w, Math.min(band * 0.6, w * 1.6)));
    }
  }
  return out;
}

/* ---------- table ---------- */

const tableCross: Gen = (b, t, r) => {
  const B = new Builder(t, 'cross'), hb = b.height - t;
  const plan = pickPlan(b, r, ['round', 'square', 'hex']);
  const top = topOutline(plan, b.width, b.depth);
  const grid = (plan === 'rect' && b.width / b.depth > 1.3) || b.width > 1000;
  const f = r.range(0.42, 0.58);
  let title: string;
  if (!grid) {
    const th0 = plan === 'square' ? r.pick([0, Math.PI / 4]) : plan === 'hex' ? r.pick([0, Math.PI / 6]) : plan === 'tri' ? Math.PI / 2 : r.pick([0, Math.PI / 4]);
    const kTop = r.range(0.6, 0.85), kBot = r.range(Math.max(kTop, 0.78), 0.95), arches = r.next() < 0.75;
    const ah = hb * r.range(0.15, 0.38), ac = r.range(0.48, 0.58), aw = r.range(0.14, 0.22);
    for (let i = 0; i < 2; i++) {
      const th = th0 + (i * Math.PI) / 2, ext = Math.min(extent(top, th), extent(top, th + Math.PI));
      const bot = ext * kBot;
      B.add(`Leg ${i + 1}`, 'leg', profile([[bot, 0], [ext * kTop, hb]]), uprightFrame([0, 0, 0], th), arches ? [arch(-bot * ac, bot * aw, ah), arch(bot * ac, bot * aw, ah)] : []);
    }
    B.lap(0, 1, [0, 0, hb * f]);
    title = 'Cross-base table';
    B.param('Base', 'two panels crossed at the centre');
  } else {
    const hx = (b.width / 2) * r.range(0.76, 0.88), hy = (b.depth / 2) * r.range(0.7, 0.86);
    const sx = hx * r.range(0.5, 0.72), sy = hy * r.range(0.42, 0.62), ah = hb * r.range(0.22, 0.45), arches = r.next() < 0.85;
    const longArch = arches && sx > 6 * t ? [arch(0, (sx - 3 * t) * r.range(0.55, 0.85), ah)] : [];
    const shortArch = arches && sy > 6 * t ? [arch(0, (sy - 3 * t) * r.range(0.55, 0.85), ah * 0.9)] : [];
    B.add('Long leg 1', 'leg', rect(-hx, 0, hx, hb), uprightFrame([0, -sy, 0], 0), longArch);
    B.add('Long leg 2', 'leg', rect(-hx, 0, hx, hb), uprightFrame([0, sy, 0], 0), longArch);
    B.add('Short leg 1', 'leg', rect(-hy, 0, hy, hb), uprightFrame([-sx, 0, 0], Math.PI / 2), shortArch);
    B.add('Short leg 2', 'leg', rect(-hy, 0, hy, hb), uprightFrame([sx, 0, 0], Math.PI / 2), shortArch);
    for (const s of [2, 3]) for (const l of [0, 1]) B.lap(l, s, [0, 0, hb * f]);
    title = 'Egg-crate table';
    B.param('Base', '# grid, four crossings');
  }
  B.add('Top', 'top', top, flatFrame([0, 0, b.height - t / 2]));
  if (b.count && b.count !== 4) B.param('Asked', `${b.count} legs: crossed panels always stand on 4 arms. Edge slit or Tab & slot can make ${b.count}.`);
  B.param('Top', `${plan}, ${f0(b.width)}${plan === 'rect' ? ` × ${f0(b.depth)}` : ''} mm, rests on the base`);
  B.param('Split height', `${Math.round(f * 100)}% of the leg`);
  return B.done(title, {height: b.height, width: b.width});
};

const tableRadial: Gen = (b, t, r) => {
  const B = new Builder(t, 'radial'), hb = b.height - t;
  const plan = b.plan ?? r.pick(['round', 'hex', 'square'] as Plan[]);
  const top = topOutline(plan, b.width, b.depth);
  const k = clamp(b.count ?? r.pick([3, 3, 4]), 3, 6);
  const th0 = plan === 'square' && k === 4 ? 0 : r.pick([0, Math.PI / (2 * k)]);
  const shape = r.pick(['hourglass', 'hourglass', 'taper', 'straight'] as const);
  const foot = r.range(0.66, 0.9), waist = r.range(0.2, 0.36), crown = r.range(0.45, 0.78);
  const minHalf = slitHalf(t, Math.PI / k) + 3.5 * t;
  const arches = r.next() < 0.6, ah = hb * r.range(0.08, 0.2);
  for (let i = 0; i < k; i++) {
    const th = th0 + (i * Math.PI) / k, ext = Math.min(extent(top, th), extent(top, th + Math.PI));
    const wf = ext * foot, wc = Math.max(ext * crown, minHalf), ww = Math.max(ext * waist, minHalf);
    const st: [number, number][] = shape === 'hourglass' ? [[wf, 0], [wf * 0.97, hb * 0.05], [ww, hb * 0.5], [wc, hb]] : shape === 'taper' ? [[wf, 0], [wc, hb]] : [[wc, 0], [wc, hb]];
    const out = profile(st), base = st[0][0];
    const design = arches && base > minHalf + 8 * t ? [arch(-base * 0.62, base * 0.2, ah), arch(base * 0.62, base * 0.2, ah)] : [];
    B.add(`Fin ${i + 1}`, 'fin', out, uprightFrame([0, 0, 0], th), design);
    for (let j = 0; j < i; j++) B.lap(j, i, [0, 0, (hb * i) / k]);
  }
  B.add('Top', 'top', top, flatFrame([0, 0, b.height - t / 2]));
  B.param('Fins', `${k} through one axis, ${2 * k} arms`);
  if (b.count && b.count !== k) B.param('Asked', `${b.count}: radial fins come in 3–6.`);
  if (b.count) B.param('Note', `each fin passes through the axis, so ${k} fins make ${2 * k} arms. Tab & slot blades make exactly ${b.count}.`);
  B.param('Bridges', `each fin keeps one ${f0(hb / k)} mm band of the axis`);
  B.param('Profile', shape);
  return B.done('Star-pedestal table', {height: b.height, width: b.width});
};

const tableEdge: Gen = (b, t, r) => {
  const B = new Builder(t, 'edge'), hb = b.height - t;
  const plan = pickPlan(b, r, ['round', 'square', 'hex']);
  const top = topOutline(plan, b.width, b.depth);
  const n = plan === 'square' || plan === 'rect' ? 4 : plan === 'hex' ? r.pick([3, 6]) : plan === 'tri' ? 3 : clamp(b.count ?? r.pick([3, 4, 5, 6]), 3, 8);
  let verts: V2[];
  if (plan === 'rect') {
    const ax = (b.width / 2) * r.range(0.48, 0.66), ay = (b.depth / 2) * r.range(0.42, 0.62);
    verts = [[ax, -ay], [ax, ay], [-ax, ay], [-ax, -ay]];
  } else {
    const R = inradius(top) * r.range(0.46, 0.66), ph = plan === 'square' ? Math.PI / 4 : plan === 'tri' ? -Math.PI / 2 : plan === 'hex' && n === 6 ? 0 : r.range(0, (2 * Math.PI) / n);
    verts = Array.from({length: n}, (_, i) => [R * Math.cos(ph + (2 * Math.PI * i) / n), R * Math.sin(ph + (2 * Math.PI * i) / n)] as V2);
  }
  const eK = r.range(2.5, 5), f = r.range(0.42, 0.58), arches = r.next() < 0.8, aw = r.range(0.45, 0.78), ah = hb * r.range(0.2, 0.45);
  for (let i = 0; i < n; i++) {
    const a = verts[i], c = verts[(i + 1) % n], dx = c[0] - a[0], dy = c[1] - a[1], s = Math.hypot(dx, dy), th = Math.atan2(dy, dx);
    const mid: V2 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    // Overhang past each corner, kept inside the top.
    let e = eK * t;
    for (const sgn of [-1, 1]) {
      const end: V2 = [mid[0] + (sgn * (s / 2 + e) * dx) / s, mid[1] + (sgn * (s / 2 + e) * dy) / s];
      const lim = extent(top, Math.atan2(end[1], end[0])) * 0.97, at = Math.hypot(end[0], end[1]);
      if (at > lim) e = Math.max(1.5 * t, e - (at - lim));
    }
    const half = s / 2 + e, design = arches && s / 2 > 7 * t ? [arch(0, (s / 2 - 3 * t) * aw, ah)] : [];
    B.add(`Wall ${i + 1}`, 'wall', rect(-half, 0, half, hb), uprightFrame([mid[0], mid[1], 0], th), design);
    if (i > 0) B.lap(i - 1, i, [0, 0, hb * f]);
  }
  B.lap(0, n - 1, [0, 0, hb * f]);
  B.add('Top', 'top', top, flatFrame([0, 0, b.height - t / 2]));
  B.param('Ring', `${n} walls locked at the corners`);
  B.param('Key piece', `Wall ${n} is slit from below at both ends and goes in last`);
  B.param('Corner angle', `${f0(360 / n)}° between walls${n !== 4 ? ', so the slits widen' : ''}`);
  return B.done('Ring-base table', {height: b.height, width: b.width});
};

const tableTab: Gen = (b, t, r) => {
  const B = new Builder(t, 'tab'), hb = b.height - t;
  const plan = pickPlan(b, r, ['round', 'square', 'hex', 'tri']);
  const top = topOutline(plan, b.width, b.depth);
  let title: string;
  if (plan === 'rect' && b.width / b.depth > 1.3) {
    const sx = (b.width / 2) * r.range(0.55, 0.74), hy = (b.depth / 2) * r.range(0.72, 0.88), tw = clamp(hy * 0.3, 2.5 * t, 80);
    const design = [arch(0, hy * r.range(0.45, 0.68), hb * r.range(0.25, 0.5))];
    for (const s of [-1, 1]) B.add(`Leg ${s < 0 ? 1 : 2}`, 'leg', withTabs(rect(-hy, 0, hy, hb), 2, [{at: 0.2, width: tw, height: t}, {at: 0.8, width: tw, height: t}]), uprightFrame([s * sx, 0, 0], Math.PI / 2), design);
    title = 'Trestle table';
    B.param('Legs', 'two trestles');
  } else {
    const k = clamp(b.count ?? (plan === 'tri' ? 3 : r.pick([3, 4])), 3, 6);
    const th0 = plan === 'square' ? r.pick([0, Math.PI / 4]) : plan === 'tri' ? Math.PI / 2 : r.range(0, (2 * Math.PI) / k);
    const r0 = Math.max(3 * t, b.width * r.range(0.04, 0.12)), kt = r.range(0.68, 0.84), flare = r.range(1, 1.22), win = b.windows !== false && r.next() < 0.6;
    for (let i = 0; i < k; i++) {
      const th = th0 + (2 * Math.PI * i) / k, ext = extent(top, th), r1 = ext * kt, r1b = Math.min(ext * 0.95, r1 * flare);
      const tw = clamp((r1 - r0) * 0.2, 2.5 * t, 70);
      const outline = withTabs([[r0, 0], [r1b, 0], [r1, hb], [r0, hb]], 2, [{at: 0.22, width: tw, height: t}, {at: 0.78, width: tw, height: t}]);
      const span = r1 - r0, design = win && span > 10 * t ? [windowCut('round', r0 + span * 0.5, hb * 0.55, span * 0.4, Math.min(hb * 0.4, span * 0.6))] : [];
      B.add(`Blade ${i + 1}`, 'leg', outline, uprightFrame([0, 0, 0], th), design);
    }
    title = 'Bladed table';
    B.param('Legs', `${k} radial blades, joined only through the top`);
  }
  const top_ = B.add('Top', 'top', top, flatFrame([0, 0, b.height - t / 2]));
  for (let i = 0; i < top_; i++) B.moving(i, top_);
  B.param('Top', `${plan}, locked by ${top_ * 2} through-tabs`);
  return B.done(title, {height: b.height, width: b.width});
};

/* ---------- tower ---------- */

function towerOutline(kind: 'taper' | 'stepped' | 'spire' | 'wave', H: number, bot: number, topW: number, minHalf: number, r: Rng): V2[] {
  const tw = Math.max(topW, minHalf);
  if (kind === 'stepped') {
    const steps = r.int(3, 4), st: [number, number][] = [];
    for (let s = 0; s < steps; s++) {
      const w = Math.max(bot - ((bot - tw) * s) / (steps - 1), minHalf);
      st.push([w, (H * s) / steps], [w, (H * (s + 1)) / steps]);
    }
    return profile(st);
  }
  if (kind === 'spire') return profile([[bot, 0], [Math.max(tw, minHalf * 1.2), H * 0.78], [minHalf, H]]);
  if (kind === 'wave') {
    const amp = r.range(0.12, 0.28), cyc = r.range(1, 2.5), ph = r.range(0, Math.PI * 2), st: [number, number][] = [];
    for (let i = 0; i <= 24; i++) {
      const y = (H * i) / 24, base = bot + ((tw - bot) * i) / 24;
      st.push([Math.max(minHalf, base * (1 + amp * Math.sin(ph + (2 * Math.PI * cyc * i) / 24))), y]);
    }
    st[0][0] = Math.max(st[0][0], bot * 0.9);
    return profile(st);
  }
  return profile([[bot, 0], [tw, H]]);
}

const towerCross: Gen = (b, t, r) => {
  const B = new Builder(t, 'cross'), H = b.height, bot = b.width / 2;
  const taper = b.taper ?? r.range(0.1, 0.5), grid = (b.count ?? 0) >= 4 || r.next() < 0.3;
  const kind = r.pick(['taper', 'stepped', 'spire'] as const), f = r.range(0.4, 0.6);
  const winKind = r.pick(['rect', 'diamond', 'round'] as const), win = b.windows ?? r.next() < 0.75;
  const rows = clamp(b.levels ?? Math.round(H / (bot * 1.5)), 2, 8);
  if (!grid) {
    const sh = slitHalf(t, Math.PI / 2), out = towerOutline(kind, H, bot, bot * (1 - taper), sh + 3 * t, r);
    const design = win ? windows(out, H, rows, winKind, sh + 0.5, t, true) : [];
    B.add('Panel 1', 'fin', out, uprightFrame([0, 0, 0], 0), design);
    B.add('Panel 2', 'fin', out, uprightFrame([0, 0, 0], Math.PI / 2), design);
    B.lap(0, 1, [0, 0, H * f]);
    B.param('Section', 'plus: two panels crossed on the axis');
  } else {
    const s = bot * r.range(0.32, 0.48), out = towerOutline(kind === 'spire' ? 'taper' : kind, H, bot, Math.max(bot * (1 - taper), s + 4 * t), s + 4 * t, r);
    const design = win ? windows(out, H, rows, winKind, s - 1.5 * t, t, false) : [];
    B.add('Panel 1', 'fin', out, uprightFrame([0, -s, 0], 0), design);
    B.add('Panel 2', 'fin', out, uprightFrame([0, s, 0], 0), design);
    B.add('Panel 3', 'fin', out, uprightFrame([-s, 0, 0], Math.PI / 2), design);
    B.add('Panel 4', 'fin', out, uprightFrame([s, 0, 0], Math.PI / 2), design);
    for (const q of [2, 3]) for (const p of [0, 1]) B.lap(p, q, [0, 0, H * f]);
    B.param('Section', '# grid: four panels, four crossings');
  }
  if (b.count && b.count !== 2 && b.count !== 4) B.param('Asked', `${b.count} panels: cross slits pair panels, so a cross column has 2 or 4. Radial slit takes any count.`);
  B.param('Silhouette', kind);
  B.param('Split height', `${Math.round(f * 100)}% of the height`);
  return B.done(grid ? 'Egg-crate tower' : 'Cross tower', {height: H, width: b.width});
};

const towerRadial: Gen = (b, t, r) => {
  const B = new Builder(t, 'radial'), H = b.height, bot = b.width / 2;
  const k = clamp(b.count ?? r.int(3, 6), 3, 8), taper = b.taper ?? r.range(0.15, 0.55);
  const kind = r.pick(['taper', 'wave', 'spire', 'stepped'] as const), minHalf = slitHalf(t, Math.PI / k) + 3 * t;
  const out = towerOutline(kind, H, bot, bot * (1 - taper), minHalf, r);
  const win = b.windows ?? r.next() < 0.5, rows = clamp(b.levels ?? Math.round(H / (bot * 1.4)), 2, 8);
  const design = win ? windows(out, H, rows, r.pick(['round', 'diamond'] as const), slitHalf(t, Math.PI / k) + 0.5, t, true) : [];
  const th0 = r.range(0, Math.PI / k);
  for (let i = 0; i < k; i++) {
    B.add(`Fin ${i + 1}`, 'fin', out, uprightFrame([0, 0, 0], th0 + (i * Math.PI) / k), design);
    for (let j = 0; j < i; j++) B.lap(j, i, [0, 0, (H * i) / k]);
  }
  B.param('Fins', `${k} through one axis, ${2 * k} arms`);
  B.param('Bridges', `fin i keeps band i of ${k} (${f0(H / k)} mm each)`);
  B.param('Silhouette', kind);
  return B.done('Star tower', {height: H, width: b.width});
};

const towerEdge: Gen = (b, t, r) => {
  const B = new Builder(t, 'edge'), H = b.height, W = b.width;
  const twist = clamp(b.twist, 0, 60), tau = rad(90 - twist);
  const a = (W / 2) * r.range(0.52, 0.7);
  let hp = W * r.range(0.3, 0.45);
  const L = Math.max(3, Math.round((2 * H) / hp - 1));
  hp = (2 * H) / (L + 1);
  const xOut = (a * (1 + Math.abs(Math.cos(tau)))) / Math.sin(tau), xIn = (a * (1 - Math.abs(Math.cos(tau)))) / Math.sin(tau);
  const half = xOut + r.range(2.5, 4.5) * t;
  const arches = r.next() < 0.8 && xIn > 6 * t, design = arches ? [arch(0, (xIn - 3 * t) * r.range(0.45, 0.8), hp * r.range(0.22, 0.42))] : [];
  const ids: number[][] = [];
  for (let j = 0; j < L; j++) {
    const al = j * tau, nx = -Math.sin(al), ny = Math.cos(al), z = (j * hp) / 2;
    ids.push([-1, 1].map(k => B.add(`L${j + 1}${k < 0 ? 'a' : 'b'}`, 'beam', rect(-half, 0, half, hp), uprightFrame([k * a * nx, k * a * ny, z], al), design)));
    if (j > 0) for (const bId of ids[j]) for (const aId of ids[j - 1]) B.lap(aId, bId, [0, 0, ((j - 1) * hp) / 2 + (3 * hp) / 4]);
  }
  B.param('Levels', `${L}, each a parallel pair`);
  B.param('Turn per level', `${f0(90 - twist)}°${twist ? ` (twist ${f0(twist)}°)` : ''}`);
  B.param('Corner slits', `${f0(hp / 4)} mm deep from top and bottom`);
  return B.done(twist ? 'Twisted crib tower' : 'Log-cabin tower', {height: H, width: W});
};

const towerTab: Gen = (b, t, r) => {
  const B = new Builder(t, 'tab'), H = b.height;
  let L = clamp(b.levels ?? r.int(2, 4), 1, 8);
  while (L > 1 && (H - (L + 1) * t) / L < 6 * t) L--;
  const n = clamp(b.count ?? r.pick([3, 4, 5, 6]), 3, 8), hw = (H - (L + 1) * t) / L;
  // Walls of storey j+1 must not stand on the tabs of storey j: their tabs would fight for the same slots in
  // the plate between. So consecutive storeys are always offset by a turn that is not a multiple of 360°/n.
  const step = 360 / n, asked = b.twist % step;
  const twist = b.twist && Math.min(asked, step - asked) > 8 ? b.twist : (b.twist || 0) + step / 2;
  const taper = b.taper ?? r.range(0, 0.35);
  const R0 = (b.width / 2) * r.range(0.62, 0.8), wk = r.range(0.55, 0.78), ph = r.range(0, (2 * Math.PI) / n), win = b.windows ?? r.next() < 0.6;
  const rad_ = (j: number) => R0 * (1 - (taper * (j - 1)) / Math.max(1, L - 1));
  const corner = (j: number) => Math.hypot(rad_(j), rad_(j) * Math.tan(Math.PI / n) * wk);
  const margin = r.range(2.5, 4) * t, plan = b.plan ?? 'round';
  const plate = (p: number) => {
    const rr = Math.max(...[p, p + 1].filter(j => j >= 1 && j <= L).map(corner)) + margin;
    const outline = plan === 'round' ? circle(rr, 64) : plan === 'square' ? regular(4, rr * Math.SQRT2, Math.PI / 4) : plan === 'hex' ? regular(6, rr / Math.cos(Math.PI / 6), 0) : plan === 'tri' ? regular(3, rr * 2, Math.PI / 2) : circle(rr, 64);
    return B.add(p === 0 ? 'Base plate' : p === L ? 'Roof plate' : `Plate ${p}`, 'plate', outline, flatFrame([0, 0, p * (t + hw) + t / 2]));
  };
  const psiOf = (j: number, i: number) => ph + (2 * Math.PI * i) / n + rad(twist) * (j - 1);
  const halfW = (j: number) => rad_(j) * Math.tan(Math.PI / n) * wk;
  /**
   * Walls of the storeys above and below can cross this wall in plan. Both put tabs into the plate between, so
   * tabs must sit away from those crossings. Along wall (j, 0), the line of wall (k, l) is met at
   * s = (r_k − r_j cos Δψ) / sin Δψ, Δψ = ψ_kl − ψ_j0. Pick the symmetric tab offset ±p farthest from all of them.
   */
  const tabOffset = (j: number, k: number, tw: number) => {
    const wj = halfW(j), cross: number[] = [];
    if (k >= 1 && k <= L) for (let l = 0; l < n; l++) {
      const d = psiOf(k, l) - psiOf(j, 0), sn = Math.sin(d);
      if (Math.abs(sn) > 1e-6) cross.push((rad_(k) - rad_(j) * Math.cos(d)) / sn);
    }
    let best = wj * 0.5, bestGap = -Infinity;
    for (let p = tw / 2 + 1.5 * t; p <= wj - tw / 2 - 1.5 * t; p += wj / 60) {
      const gap = cross.length ? Math.min(...cross.flatMap(s => [Math.abs(p - s), Math.abs(-p - s)])) : wj;
      if (gap > bestGap + 1e-9) { bestGap = gap; best = p; }
    }
    return best;
  };
  let below = plate(0);
  for (let j = 1; j <= L; j++) {
    const rj = rad_(j), wj = halfW(j), tw = clamp(wj * 0.3, 2.5 * t, 50), zb = (j - 1) * (t + hw) + t;
    const pt = tabOffset(j, j + 1, tw), pb = tabOffset(j, j - 1, tw);
    // Top edge runs from +wj to −wj, bottom edge from −wj to +wj; `at` is the fraction along each.
    let outline = withTabs(rect(-wj, 0, wj, hw), 2, [{at: (wj - pt) / (2 * wj), width: tw, height: t}, {at: (wj + pt) / (2 * wj), width: tw, height: t}]);
    outline = withTabs(outline, 0, [{at: (wj - pb) / (2 * wj), width: tw, height: t}, {at: (wj + pb) / (2 * wj), width: tw, height: t}]);
    const design = win && wj > 6 * t && hw > 8 * t ? [windowCut(r.pick(['round', 'rect', 'diamond'] as const), 0, hw * 0.5, wj * 0.7, hw * 0.55)] : [];
    const walls: number[] = [];
    for (let i = 0; i < n; i++) {
      const psi = psiOf(j, i);
      const w = B.add(`Wall ${j}.${i + 1}`, 'wall', outline, uprightFrame([rj * Math.cos(psi), rj * Math.sin(psi), zb], psi + Math.PI / 2), design);
      B.through(below, w);
      walls.push(w);
    }
    const above = plate(j);
    for (const w of walls) B.moving(w, above);
    below = above;
  }
  B.param('Levels', `${L} storeys of ${n} walls`);
  B.param('Wall height', `${f0(hw)} mm between plates`);
  if (twist) B.param('Twist', `${f0(twist)}° per storey`);
  return B.done('Stacked-platform tower', {height: H, width: b.width});
};

/* ---------- sphere ---------- */

function flatDisc(R: number, hf: number) {
  return truncate(circle(R, 64, 0, R - hf), [0, -1], 0);
}

const sphereCross: Gen = (b, t, r) => {
  const B = new Builder(t, 'cross'), R = b.width / 2, hf = R * r.range(0.11, 0.19), zc = R - hf;
  const a = R * r.range(0.3, 0.6), bl = t * r.range(1.4, 2.2), psi = r.pick([0, Math.PI / 4, Math.PI / 6]);
  const u: V3 = [Math.cos(psi), Math.sin(psi), 0];
  B.add('Meridian A', 'disc', flatDisc(R, hf), uprightFrame([0, 0, 0], psi));
  B.add('Meridian B', 'disc', flatDisc(R, hf), uprightFrame([0, 0, 0], psi + Math.PI / 2));
  B.add('Equator', 'disc', circle(R, 64), flatFrame([0, 0, zc], psi), [], [-u[0], -u[1], 0]);
  B.lap(0, 1, [0, 0, zc - t / 2 - bl]);
  B.lap(0, 2, [a * u[0], a * u[1], zc]);
  B.through(1, 2);
  B.param('Discs', 'three, mutually perpendicular');
  if (b.count && b.count !== 3) B.param('Asked', `${b.count} discs: three perpendicular discs is the most cross slits allow. Radial slit takes 3–8 meridians.`);
  B.param('Relief', 'the equator slides in sideways; Meridian B gets slots from both edges and keeps a centre bridge');
  B.param('Flat base', `${f0(hf)} mm sliced off so it stands`);
  return B.done('Three-disc sphere', {height: 2 * R - hf, width: 2 * R});
};

const sphereRadial: Gen = (b, t, r) => {
  const B = new Builder(t, 'radial'), R = b.width / 2, hf = R * r.range(0.1, 0.18), k = clamp(b.count ?? r.int(3, 6), 3, 8), top = 2 * R - hf;
  for (let i = 0; i < k; i++) {
    B.add(`Meridian ${i + 1}`, 'disc', flatDisc(R, hf), uprightFrame([0, 0, 0], (i * Math.PI) / k));
    for (let j = 0; j < i; j++) B.lap(j, i, [0, 0, (top * i) / k]);
  }
  B.param('Meridians', `${k} discs through the vertical axis`);
  B.param('Bridges', `disc i keeps band i of ${k} along the axis`);
  B.param('Flat base', `${f0(hf)} mm sliced off so it stands`);
  return B.done('Meridian sphere', {height: top, width: 2 * R});
};


/* ---------- pinwheel kit (identical modules) ---------- */

const SHAPE_NAME: Record<number, string> = {3: 'triangle', 4: 'square', 5: 'pentagon', 6: 'hexagon', 8: 'octagon', 10: 'decagon'};
const shapeName = (n: number) => SHAPE_NAME[n] ?? `${n}-gon`;
const deg0 = (r: number) => `${Math.round((r * 180) / Math.PI)}°`;
const planeAngle = (phi: number) => deg0(((phi % Math.PI) + Math.PI) % Math.PI);

/**
 * Default slit settings per shape, chosen by searching slit position, angle and length for kits whose rings close
 * with no piece running into another. Straight slits set off-centre along the edge (still a pinwheel) do best;
 * twisting them more than ~10° makes most rings collide.
 */
export function kitDefaults(sides: number): KitParams {
  const base = {...DEFAULT_KIT, sides, slitAngle: 0};
  if (sides === 3) return {...base, slitAt: 0.4, slitLength: 0.12};
  if (sides === 4) return {...base, slitAt: 0.4, slitLength: 0.2};
  return {...base, slitAt: 0.3, slitLength: 0.24};
}

/** Re-pose a set of panels rigidly (rotation R about the origin, then translation). */
function movePanels(panels: Panel[], X: Xf) {
  for (const p of panels) p.frame = frameOf(compose(X, {R: [p.frame.u[0], p.frame.v[0], p.frame.n[0], p.frame.u[1], p.frame.v[1], p.frame.n[1], p.frame.u[2], p.frame.v[2], p.frame.n[2]], t: p.frame.o}));
}

function addChain(B: Builder, m: Module, X: Xf[], travel: (V3 | null)[], W: Xf) {
  X.forEach((x, i) => {
    const tr = travel[i];
    B.add(`Piece ${i + 1}`, 'module', m.outline, frameOf(compose(W, x)), m.cuts, tr ? rotate(W, tr) : DOWN);
  });
}

/** Lift so the lowest point sits on z = 0 and centre over the origin. */
function settle(panels: Panel[]) {
  const v = panels.flatMap(panelVertices);
  const z0 = Math.min(...v.map(p => p[2])), cx = (Math.min(...v.map(p => p[0])) + Math.max(...v.map(p => p[0]))) / 2, cy = (Math.min(...v.map(p => p[1])) + Math.max(...v.map(p => p[1]))) / 2;
  for (const p of panels) p.frame = {...p.frame, o: [p.frame.o[0] - cx, p.frame.o[1] - cy, p.frame.o[2] - z0]};
}

function kitModule(ctx: GenCtx, side: number, t: number) {
  const m = makeModule(ctx.kit, side, t, ctx.clearance), problem = moduleProblem(m);
  if (problem) throw new Error(`This kit can't be cut: ${problem}.`);
  return m;
}

const tableKit: Gen = (b, t, r, ctx) => {
  const k = ctx.kit, range = fitRange(t, k.slitWidth * t, ctx.clearance), unit = kitModule(ctx, 100, t);
  const all = ringSolutions(unit, range);
  if (!all.length) throw new Error(`These ${shapeName(k.sides)}s close no flat ring at the angles their slits allow (${deg0(range[0])}–${deg0(range[1])}). Change the slit angle or width.`);
  const sols = all.filter(sol => ringClear(unit, sol, t));
  if (!sols.length) throw new Error(`The rings these ${shapeName(k.sides)}s close all have pieces running into each other. Change the slit angle, length or width.`);
  const aspect = b.width / Math.max(1, b.height - t);
  const measured = sols.map(sol => {
    const {X} = chain(unit, sol.a, sol.b, sol.phiA, sol.phiB, 2 * sol.N), W = ringPlacement(unit, sol);
    const pts = X.flatMap(x => { const F = compose(W, x); return unit.outline.map(q => apply(F, [q[0], q[1], 0])); });
    const zs = pts.map(p => p[2]), h = Math.max(...zs) - Math.min(...zs), dia = 2 * Math.max(...pts.map(p => Math.hypot(p[0], p[1])));
    return {sol, h, dia, fit: Math.abs(Math.log(dia / h / aspect))};
  }).sort((x, y) => x.fit - y.fit);
  const pick = measured[Math.min(measured.length - 1, r.int(0, 2))];
  const side = clamp((100 * (b.height - t)) / pick.h, 20, 600), m = kitModule(ctx, side, t), {sol} = pick;
  const B = new Builder(t, 'kit');
  const {X, travel} = chain(m, sol.a, sol.b, sol.phiA, sol.phiB, 2 * sol.N);
  if (!ringClear(m, sol, t)) throw new Error('At table size the ring’s pieces collide; try a thinner sheet.');
  addChain(B, m, X, travel, ringPlacement(m, sol));
  settle(B.panels);
  const v = B.panels.flatMap(panelVertices), top = Math.max(...v.map(p => p[2]));
  const reach = Math.max(...v.filter(p => p[2] > top - 0.05).map(p => Math.hypot(p[0], p[1])));
  B.add('Top', 'top', circle(Math.max(b.width / 2, reach * 1.12), 72), flatFrame([0, 0, top + t / 2]));
  B.param('Kit', `${2 * sol.N} identical ${shapeName(k.sides)}s, ${f0(side)} mm sides`);
  B.param('Ring', `closes because its two joint axes meet at 180°/${sol.N} = ${(180 / sol.N).toFixed(1)}° and cross`);
  B.param('Joint angles', `${planeAngle(sol.phiA)} and ${planeAngle(sol.phiB)} between pieces`);
  B.param('Slits used', `${sol.a + 1} and ${sol.b + 1} of ${k.sides} on every piece`);
  B.param('Top', 'plain disc resting on the ring');
  B.param('Size', `ring ${f0((pick.dia * side) / 100)} mm across; the table height sets the piece size`);
  return B.done('Kit ring table', {height: b.height, width: b.width}, 'The last piece closes the ring. Its two slits lie on different lines, so rigid pieces cannot slide it in; the sheet has to flex a little.');
};

/**
 * Helix candidates for a kit, best first: a deterministic grid over the slit pair and both joint angles, kept
 * only where the screw is tower-like (about 3–30 pieces a turn, rising 6–80 % of a side per piece), ranked by
 * closeness to ~6 pieces a turn and a rise of 0.3 side. Cached per kit, with verdicts, so variants are cheap.
 */
const helixCache = new Map<string, {list: {bb: number; phiA: number; phiB: number}[]; verdict: Map<number, boolean>}>();

function helixList(m: Module, n: number, range: [number, number], key: string) {
  const hit = helixCache.get(key);
  if (hit) return hit;
  const phis: number[] = [];
  for (let x = range[0]; x <= range[1] + 1e-9; x += rad(4)) phis.push(x, x + Math.PI);
  const scored: {bb: number; phiA: number; phiB: number; score: number}[] = [];
  for (let bb = 1; bb < n; bb++) for (const phiA of phis) for (const phiB of phis) {
    const sc = screwOf(m, 0, bb, phiA, phiB), rise = Math.abs(sc.delta), w = sc.axis;
    if (!w || !(sc.gamma > rad(10) && sc.gamma < rad(72) && rise > 0.06 * m.side && rise < 0.8 * m.side)) continue;
    // A turn clears the one below only if a full turn rises more than one piece's height along the axis.
    const along = m.outline.map(q => q[0] * w[0] + q[1] * w[1]);
    const height = Math.max(...along) - Math.min(...along), perTurn = (2 * Math.PI) / sc.gamma;
    if (perTurn * rise < height) continue;
    // Distance from the piece's centre to the screw axis: the helix radius. Thin helices topple.
    const {A, B} = sc, w0 = sub3(A.p, B.p), bbAB = dot3(A.c, B.c), dd = dot3(A.c, w0), ee = dot3(B.c, w0), den = 1 - bbAB * bbAB;
    const onA = add3(A.p, scale3(A.c, (bbAB * ee - dd) / den)), onB = add3(B.p, scale3(B.c, (ee - bbAB * dd) / den));
    const mid = scale3(add3(onA, onB), 0.5), off = sub3([0, 0, 0], mid), radial = Math.hypot(...sub3(off, scale3(w, dot3(off, w))));
    if (radial < 0.45 * m.side) continue;
    scored.push({bb, phiA, phiB, score: Math.abs(Math.log(perTurn / 6)) + Math.abs(Math.log(rise / (0.3 * m.side))) + Math.abs(Math.log(radial / m.side))});
  }
  const entry = {list: scored.sort((x, y) => x.score - y.score), verdict: new Map<number, boolean>()};
  helixCache.set(key, entry);
  if (helixCache.size > 40) helixCache.delete(helixCache.keys().next().value!);
  return entry;
}

const towerKit: Gen = (b, t, r, ctx) => {
  const k = ctx.kit, range = fitRange(t, k.slitWidth * t, ctx.clearance);
  const side = clamp(b.width * 0.5, 25, 400), m = kitModule(ctx, side, t), n = k.sides;
  const cache = helixList(m, n, range, JSON.stringify([k, t, side, ctx.clearance, Math.round(b.height)]));
  if (!cache.list.length) throw new Error(`These ${shapeName(n)}s make no tower-shaped helix at the angles their slits allow (${deg0(range[0])}–${deg0(range[1])}).`);
  const want = r.int(0, 3), why = new Map<string, number>();
  let found = 0, budget = 400, last: Layout | null = null;
  for (let idx = 0; idx < cache.list.length && budget > 0; idx++) {
    const seen = cache.verdict.get(idx);
    if (seen === false) continue;
    if (seen === undefined) budget--;
    const out = buildHelix(m, cache.list[idx], b, t, side, n);
    cache.verdict.set(idx, typeof out !== 'string');
    if (typeof out === 'string') { why.set(out, (why.get(out) ?? 0) + 1); continue; }
    last = out;
    if (found++ === want) return out;
  }
  if (last) return last;
  const top = [...why.entries()].sort((x, y) => y[1] - x[1]).map(([w, c]) => `${c} ${w}`).join(', ');
  throw new Error(`No helix of these ${shapeName(n)}s passed (${top || 'all candidates already ruled out'}). Try another shape, slit angle or a wider tower.`);
};

/** A verified helix layout, or the reason this candidate fails. */
function buildHelix(m: Module, c: {bb: number; phiA: number; phiB: number}, b: Brief, t: number, side: number, n: number): Layout | string {
  const {bb, phiA, phiB} = c, sc = screwOf(m, 0, bb, phiA, phiB), rise = Math.abs(sc.delta);
  const count = clamp(Math.round((b.height - side * 0.6) / rise) + 1, 6, 48);
  const {X, travel} = chain(m, 0, bb, phiA, phiB, count);
  // Cheapest test first: does it stand within 30° of upright, on its own hull?
  const B = new Builder(t, 'kit');
  addChain(B, m, X, travel, {R: rotationBetween(sc.axis!, [0, 0, 1]), t: [0, 0, 0]});
  const pts = B.panels.flatMap(panelVertices), {com} = massProps(B.panels), rest = restingPose(pts, com, {axis: [0, 0, 1], maxTiltDeg: 30});
  if (rest.tipDeg <= 3) return 'will not stand upright';
  // Pieces two or more apart must not meet, and each piece must slide onto the chain so far without hitting it.
  const local = chainPanels(m, X, t);
  for (let j = 1; j < local.length; j++) {
    for (let i = 0; i < j - 1; i++) if (panelDepth(local[i], local[j]) > 0) return 'turns clash';
    const back: V3 = [-travel[j]![0], -travel[j]![1], -travel[j]![2]], before = local.slice(0, j);
    if (pathBlocker(local[j], scale3(back, exitDistance(local[j], before, back)), before) !== null) return 'slide blocked';
  }
  movePanels(B.panels, {R: rest.R, t: [0, 0, 0]});
  for (const s of B.order) if (s.motion) s.motion = rotate({R: rest.R, t: [0, 0, 0]}, s.motion);
  settle(B.panels);
  // End pieces hang on one joint each. Reject the helix if gravity could slide one out (unless the floor stops it).
  const lastOut = B.order[count - 1].motion!, firstOut = B.order[1].motion!;
  const onFloor = (p: Panel) => Math.min(...panelVertices(p).map(v => v[2])) < 0.05;
  if ((-lastOut[2] < -0.2 && !onFloor(B.panels[count - 1])) || (firstOut[2] < -0.2 && !onFloor(B.panels[0]))) return 'end piece would slide out';
  B.param('Kit', `${count} identical ${shapeName(n)}s, ${f0(side)} mm sides`);
  B.param('Screw', `every two pieces turn ${((2 * sc.gamma * 180) / Math.PI).toFixed(1)}° and rise ${f0(2 * rise)} mm: two half-turns make a screw`);
  B.param('Per turn', `${((2 * Math.PI) / sc.gamma).toFixed(1)} pieces`);
  B.param('Joint angles', `${planeAngle(phiA)} and ${planeAngle(phiB)} between pieces`);
  B.param('Slits used', `1 and ${bb + 1} of ${n} on every piece`);
  return B.done('Kit helix tower', {height: b.height, width: b.width});
}

/* ---------- registry ---------- */

export const SLIT_INFO: Record<SlitType, {name: string; joins: string; makes: string; rule: string}> = {
  cross: {
    name: 'Cross slit',
    joins: 'Two panels cross through their middles, each slit halfway from opposite edges (half-lap).',
    makes: 'X and # bases, plus-section and egg-crate towers, the three-disc sphere.',
    rule: 'Insert along the crossing line. Any angle works: the slit widens to (t₂ + t₁|cos θ|) / sin θ.',
  },
  radial: {
    name: 'Radial slit',
    joins: 'Three or more panels share one axis. Each keeps one band of the axis and is slit above and below it.',
    makes: 'Star pedestals, finned towers, meridian spheres.',
    rule: 'Panel i keeps band i of k; panels drop in in order. Two panels is just a cross.',
  },
  edge: {
    name: 'Edge slit',
    joins: 'Short slits near the ends of panels lock them at their corners.',
    makes: 'Closed rings of walls and log-cabin cribs, which can twist level by level.',
    rule: 'A ring needs one key piece slit from below at both ends; it goes in last.',
  },
  kit: {
    name: 'Pinwheel kit',
    joins: 'Identical polygons with one slit per edge, set in a pinwheel. Any slit interlocks with any other, at any angle the slit width allows.',
    makes: 'Rings that close only at special angles (a table base) and helices (a tower).',
    rule: 'Each joint is a half-turn. Two half-turns make a screw, which closes into a ring of 2N pieces only when the two axes meet at 180°/N.',
  },
  tab: {
    name: 'Tab & slot',
    joins: 'A tab on one panel’s edge passes through a closed slot cut in another panel’s face.',
    makes: 'Tops locked onto legs, stacked platforms with walls between.',
    rule: 'Joins panels that meet edge-to-face without crossing. The slotted panel goes on last.',
  },
};

export interface Cell {gen: Gen | null; what: string}

export const MATRIX: Record<Typology, Record<SlitType, Cell>> = {
  table: {
    cross: {gen: tableCross, what: 'Crossed legs (X, or a # grid for long tops); top rests on them'},
    radial: {gen: tableRadial, what: 'Star pedestal of 3–6 fins; top rests on it'},
    edge: {gen: tableEdge, what: 'Ring of walls locked at the corners; top rests on it'},
    tab: {gen: tableTab, what: 'Blades or trestles tabbed through the top, which locks them'},
    kit: {gen: tableKit, what: 'Closed ring of identical pieces as the base; a plain top rests on it'},
  },
  tower: {
    cross: {gen: towerCross, what: 'Plus-section or # egg-crate column'},
    radial: {gen: towerRadial, what: 'Star column of 3–8 fins'},
    edge: {gen: towerEdge, what: 'Log-cabin crib of stacked pairs; can twist'},
    tab: {gen: towerTab, what: 'Plates and walls stacked storey by storey; can twist and taper'},
    kit: {gen: towerKit, what: 'Helix of identical pieces: one repeated pair of joints is a screw motion'},
  },
  sphere: {
    cross: {gen: sphereCross, what: 'Three perpendicular discs, as in the reference'},
    radial: {gen: sphereRadial, what: '3–8 meridian discs on one axis'},
    edge: {gen: null, what: 'Not possible: edge slits join panels at their ends, but a sphere’s discs cross through their centres'},
    tab: {gen: null, what: 'Not possible: tabs join panels that meet edge-to-face, but a sphere’s discs cross each other'},
    kit: {gen: null, what: 'Not yet: a closed cage of identical pieces needs polyhedral symmetry; this prototype makes kit rings and helices'},
  },
};
