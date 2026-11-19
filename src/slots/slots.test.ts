import {test} from 'node:test';
import assert from 'node:assert/strict';
import {carve, type JointSpec, type Step} from './carve';
import {collisions, panelDepth} from './collide';
import {generate} from './engine';
import {MATRIX} from './generators';
import {integrity} from './integrity';
import {rad, type V3} from './math';
import {circle, flatFrame, makePanel, rect, truncate, uprightFrame, withTabs, type Panel, type SlitType} from './panel';
import {planAssembly} from './plan';
import {parsePrompt, type Typology} from './prompt';
import {groundSupport, partHold} from './stability';

const t = 6, c = 0.2, DOWN: V3 = [0, 0, -1];
const upright = (id: number, deg: number, w = 200, h = 100) => makePanel(id, `P${id}`, 'leg', rect(-w / 2, 0, w / 2, h), uprightFrame([0, 0, 0], rad(deg)), t);
const fixedThen = (...motions: (V3 | null)[]): Step[] => motions.map((m, i) => ({panel: i, motion: m}));

test('two uncut crossing panels interpenetrate by one sheet thickness', () => {
  assert.ok(Math.abs(panelDepth(upright(0, 0), upright(1, 90)) - t) < 1e-9);
  assert.equal(planAssembly([upright(0, 0), upright(1, 90)]).ok, false);
});

for (const deg of [90, 60, 35]) {
  test(`half-lap at ${deg}°: slit width (t₂ + t₁|cos θ|)/sin θ + clearance, no interference, assembles`, () => {
    const A = upright(0, 0), B = upright(1, deg), th = rad(deg);
    carve([A, B], fixedThen(null, DOWN), [{a: 0, b: 1, mode: 'lap', slit: 'cross', split: [0, 0, 50]}], c, 1000);
    const xs = A.cuts[0].poly.map(p => p[0]), width = Math.max(...xs) - Math.min(...xs);
    assert.ok(Math.abs(width - ((t + t * Math.abs(Math.cos(th))) / Math.sin(th) + c)) < 2e-3, `width ${width}`);
    // A is slit from the top down to the split, B from the bottom up to it.
    assert.ok(Math.abs(Math.min(...A.cuts[0].poly.map(p => p[1])) - 50) < 1e-6);
    assert.ok(Math.abs(Math.max(...B.cuts[0].poly.map(p => p[1])) - (50 + c / 2)) < 1e-3);
    assert.deepEqual(collisions([A, B]), []);
    const plan = planAssembly([A, B], new Map([[1, DOWN]]), [0, 1]);
    assert.ok(plan.ok);
    assert.deepEqual(plan.steps[1].travel.map(x => Math.round(x) + 0), [0, 0, -1]);
    for (const p of [A, B]) assert.equal(integrity(p).parts, 1);
  });
}

/** The reference sphere: Meridian B drops onto A, the equator slides in sideways. */
function sphere(flat: number, ligament: number) {
  const R = 100, zc = R - flat, a = 45;
  const disc = flat ? truncate(circle(R, 64, 0, zc), [0, -1], 0) : circle(R, 64, 0, zc);
  const A = makePanel(0, 'A', 'disc', disc, uprightFrame([0, 0, 0], 0), t);
  const B = makePanel(1, 'B', 'disc', disc, uprightFrame([0, 0, 0], Math.PI / 2), t);
  const E = makePanel(2, 'E', 'disc', circle(R, 64), flatFrame([0, 0, zc]), t);
  const joints: JointSpec[] = [
    {a: 0, b: 1, mode: 'lap', slit: 'cross', split: [0, 0, zc - t / 2 - c - ligament]},
    {a: 0, b: 2, mode: 'lap', slit: 'cross', split: [a, 0, zc]},
    {a: 1, b: 2, mode: 'through', slit: 'cross'},
  ];
  carve([A, B, E], fixedThen(null, DOWN, [-1, 0, 0]), joints, c, 2000);
  return {A, B, E, zc, R, a};
}

test('three-disc sphere reproduces the reference slits and assembles', () => {
  const {A, B, E, zc, R, a} = sphere(15, 1.5 * t);
  assert.deepEqual(collisions([A, B, E]), []);
  for (const p of [A, B, E]) assert.equal(integrity(p).parts, 1, p.name);
  // Equator: one slot from one edge to past the centre.
  const eb = E.cuts.flatMap(k => k.poly);
  assert.ok(Math.min(...eb.map(p => p[0])) < -R && Math.abs(Math.max(...eb.map(p => p[0])) - a - c / 2) < 1e-2);
  // Meridian B: horizontal slots from both edges at the equator, leaving a centre bridge one sheet wide.
  const ch = B.cuts.filter(k => k.kind === 'channel').map(k => k.poly);
  const inner = ch.map(p => Math.min(...p.map(q => Math.abs(q[0]))));
  assert.ok(ch.some(p => p.every(q => q[0] > 0)) && ch.some(p => p.every(q => q[0] < 0)), 'slots from both edges');
  assert.ok(Math.abs(Math.min(...inner) - t / 2) < 0.05, `bridge half-width ${Math.min(...inner)}`);
  for (const p of ch) for (const q of p) assert.ok(Math.abs(q[1] - zc) <= t / 2 + c, 'slot sits on the equator');
  // Meridian A: slit from the top down past the centre, plus a short slit from the far edge to x = a.
  assert.equal(A.cuts.length, 2);
  const plan = planAssembly([A, B, E]);
  assert.ok(plan.ok);
  assert.ok(Math.abs(plan.steps[2].travel[0]) > 0.99, 'equator goes in sideways');
  assert.equal(partHold(E, [A, B], 0, 1.7).hold, 'friction');
});

test('sphere whose bottom slit runs into the equator slots is caught as split', () => {
  const {B} = sphere(15, -t);
  assert.ok(integrity(B).parts > 1);
});

test('sphere on a point tips; with a flat base it stands', () => {
  assert.equal(groundSupport(Object.values(sphere(0, 1.5 * t)).filter((p): p is Panel => typeof p === 'object')).tipDeg, 0);
  assert.ok(groundSupport(Object.values(sphere(15, 1.5 * t)).filter((p): p is Panel => typeof p === 'object')).tipDeg > 15);
});

test('a tab shoulder touching the underside of a top makes a tab-sized slot, not a full-width one', () => {
  const leg = makePanel(0, 'Leg', 'leg', withTabs(rect(-100, 0, 100, 300), 2, [{at: 0.25, width: 30, height: t}, {at: 0.75, width: 30, height: t}]), uprightFrame([0, 0, 0], 0), t);
  const top = makePanel(1, 'Top', 'top', circle(150), flatFrame([0, 0, 300 + t / 2]), t);
  carve([leg, top], fixedThen(null, DOWN), [{a: 0, b: 1, mode: 'moving', slit: 'tab'}], c, 2000);
  const cut = top.cuts.reduce((s, k) => s + area(k.poly), 0);
  assert.ok(Math.abs(cut - 2 * (30 + c) * (t + c)) < 1, `slot area ${cut}`);
  assert.deepEqual(collisions([leg, top]), []);
  assert.equal(partHold(top, [leg], 0, 1.7).hold, 'seated');
});

const area = (p: [number, number][]) => Math.abs(p.reduce((s, a, i) => s + a[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * a[1], 0) / 2);

test('every form × slit type either verifies or says why not', () => {
  const prompts: Record<Typology, string> = {table: 'side table', tower: 'small tower', sphere: 'sphere'};
  for (const typ of Object.keys(MATRIX) as Typology[]) for (const slit of Object.keys(MATRIX[typ]) as SlitType[]) {
    const r = generate(parsePrompt(prompts[typ]), {slit, thickness: null, clearance: c, seed: 1, candidates: 6});
    if (!MATRIX[typ][slit].gen) { assert.ok(r.unsupported && r.unsupported.length > 20, `${typ}/${slit}`); continue; }
    const d = r.design!;
    assert.ok(d.ok, `${typ}/${slit}: ${d.checks.filter(k => k.level === 'error').map(k => `${k.label}: ${k.detail}`).join('; ')}`);
    assert.equal(d.hits.length, 0);
    assert.ok(d.support.tipDeg > 6, `${typ}/${slit} tip ${d.support.tipDeg}`);
  }
});

test('slit type changes how the top is held: resting is friction-held, tabs seat it', () => {
  const b = parsePrompt('side table');
  const hold = (slit: SlitType) => generate(b, {slit, thickness: null, clearance: c, seed: 3, candidates: 3}).design!.panels.find(p => p.role === 'top')!.hold;
  assert.equal(hold('cross'), 'friction');
  assert.equal(hold('tab'), 'seated');
});

test('prompt reading', () => {
  const tower = parsePrompt('small tower');
  assert.equal(tower.typology, 'tower');
  assert.equal(tower.height, 300);
  const t2 = parsePrompt('a twisted tower 60cm tall with 5 fins, 6mm plywood');
  assert.equal(t2.height, 600);
  assert.equal(t2.count, 5);
  assert.equal(t2.thickness, 6);
  assert.ok(t2.twist > 0);
  const tb = parsePrompt('round coffee table 45 cm tall');
  assert.equal(tb.typology, 'table');
  assert.equal(tb.plan, 'round');
  assert.equal(tb.height, 450);
  assert.equal(parsePrompt('egg-crate stool').slit, 'cross');
  assert.ok(parsePrompt('a bookshelf').unsupported);
});

/* ---------- pinwheel kit ---------- */

import {apply, chain, chainPanels, fitRange, jointAxis, makeModule, ringClear, ringSolutions, rotate as rot} from './kit';
import {kitDefaults} from './generators';

test('kit joint is a half-turn: the partner’s slit lies on the same line, reversed, its mouth 2ℓ along', () => {
  const m = makeModule(kitDefaults(6), 100, 4, c), {X} = chain(m, 0, 2, 1.7, 1.9, 2);
  const s = m.slits[2], q = apply(X[1], [s.e[0], s.e[1], 0]), dq = rot(X[1], [s.d[0], s.d[1], 0]);
  const want = [s.e[0] + 2 * m.len * s.d[0], s.e[1] + 2 * m.len * s.d[1], 0];
  assert.ok(Math.hypot(q[0] - want[0], q[1] - want[1], q[2] - want[2]) < 1e-9);
  assert.ok(Math.abs(dq[0] + s.d[0]) + Math.abs(dq[1] + s.d[1]) + Math.abs(dq[2]) < 1e-9);
  assert.ok(jointAxis(m, 2, 1.7).c.every(Number.isFinite));
});

test('kit fit range 2·atan(t/(w−c)) matches the collision engine', () => {
  const kit = kitDefaults(6), t4 = 4, m = makeModule(kit, 100, t4, c), [lo] = fitRange(t4, kit.slitWidth * t4, c);
  const pair = (phi: number) => chainPanels(m, chain(m, 0, 2, phi, phi, 2).X, t4);
  for (const phi of [lo + rad(1.5), Math.PI / 2, Math.PI - lo - rad(1.5)]) assert.equal(panelDepth(...(pair(phi) as [Panel, Panel])), 0, `inside at ${phi}`);
  for (const phi of [lo - rad(3), Math.PI - lo + rad(3)]) assert.ok(panelDepth(...(pair(phi) as [Panel, Panel])) > 0, `outside at ${phi}`);
});

test('kit rings close exactly: 2N pieces return to the start when the half-turn axes meet at π/N', () => {
  const kit = kitDefaults(10), m = makeModule(kit, 100, 6, c), rings = ringSolutions(m, fitRange(6, kit.slitWidth * 6, c));
  assert.ok(rings.length > 0);
  for (const r of rings.slice(0, 4)) {
    const {X} = chain(m, r.a, r.b, r.phiA, r.phiB, 2 * r.N + 1), end = X[2 * r.N];
    assert.ok(end.R.every((x, i) => Math.abs(x - [1, 0, 0, 0, 1, 0, 0, 0, 1][i]) < 1e-7) && Math.hypot(...end.t) < 1e-6, `${2 * r.N} pieces close`);
  }
  assert.ok(rings.some(r => ringClear(m, r, 6)), 'at least one ring has no piece running into another');
});

test('kit table and tower verify; a kit sphere says why not', () => {
  for (const prompt of ['side table', 'small tower']) {
    const d = generate(parsePrompt(prompt), {slit: 'kit', thickness: null, clearance: c, seed: 1, candidates: 3}).design!;
    assert.ok(d.ok, `${prompt}: ${d.checks.filter(k => k.level === 'error').map(k => k.detail).join('; ')}`);
    assert.ok(d.panels.filter(p => p.role === 'module').length >= 6);
  }
  assert.ok(generate(parsePrompt('sphere'), {slit: 'kit', thickness: null, clearance: c, seed: 1, candidates: 1}).unsupported);
  const b = parsePrompt('a hexagon kit tower');
  assert.equal(b.slit, 'kit');
  assert.equal(b.kitSides, 6);
});

/* ---------- slot kits, gallery, laser files ---------- */

import {childFrame, coverPiece, finishPieces, grow, pieceProblem} from './kits';
import {gallery, type GalleryItem} from './gallery';
import {assemblyGuideHTML, cutSheetDXF, cutSheetSVG} from './svg';
import {exitDistance, pathBlocker} from './collide';
import {rng as seeded} from './math';
import {IDENTITY, frameOf as frameOfX} from './kit';

test('circular kit is the sketch: discs with 1, 2 (90°), 2 (180°), 3 slits and a half disc notched at both ends', () => {
  const ps = finishPieces('circle', 160, 4, c), by = new Map(ps.map(p => [p.id, p]));
  assert.deepEqual(ps.map(p => p.slits.length), [1, 2, 2, 3, 2]);
  const dirDeg = (id: string) => by.get(id)!.slits.map(s => Math.round((Math.atan2(-s.d[1], -s.d[0]) * 180) / Math.PI));
  assert.deepEqual(dirDeg('C2L'), [90, 0]);
  assert.deepEqual(dirDeg('C2I'), [180, 0]);
  // Half disc notches run along the flat edge (y = 0) and are flush with it.
  for (const cut of by.get('H')!.cuts) assert.ok(Math.abs(Math.max(...cut.map(q => q[1]))) < 1e-9 && Math.abs(Math.min(...cut.map(q => q[1])) + (4 + c)) < 1e-9);
  for (const kit of ['circle', 'triangle', 'pentagon', 'hexagon', 'decagon'] as const) {
    const ps = finishPieces(kit, 160, 4, c), cover = coverPiece(kit, 160, 4, c);
    const reach = (o: [number, number][]) => Math.max(...o.map(q => Math.hypot(q[0], q[1])));
    for (const p of ps) {
      assert.equal(pieceProblem(p), null, p.id);
      assert.ok(Math.abs(reach(p.outline) - reach(cover.outline)) < 1e-6, `${p.id} is the same size as the cover`);
    }
  }
});

test('two kit pieces joined slit to slit are perpendicular, share the slit line, and do not overlap', () => {
  const ps = finishPieces('circle', 160, 4, c), P = ps[3], Q = ps[2];
  for (const psi of [Math.PI / 2, (3 * Math.PI) / 2]) {
    const X = childFrame(IDENTITY, P, 0, Q, 1, psi), fq = frameOfX(X);
    assert.ok(Math.abs(fq.n[2]) < 1e-9, 'perpendicular to P');
    const mouthQ = fq.o.map((o, k) => o + fq.u[k] * Q.slits[1].e[0] + fq.v[k] * Q.slits[1].e[1]);
    const want = [P.slits[0].e[0] + P.slits[0].d[0] * (P.len + Q.len), P.slits[0].e[1] + P.slits[0].d[1] * (P.len + Q.len), 0];
    assert.ok(Math.hypot(...mouthQ.map((v, k) => v - want[k])) < 1e-9, 'mouths ℓP + ℓQ apart on one line');
    const a = makePanel(0, 'P', 'module', P.outline, frameOfX(IDENTITY), 4, P.cuts), b = makePanel(1, 'Q', 'module', Q.outline, fq, 4, Q.cuts);
    assert.equal(panelDepth(a, b), 0);
  }
});

test('growth order is a build order: each piece slides straight in past everything placed before it', () => {
  const ps = finishPieces('triangle', 150, 4, c);
  let checked = 0;
  for (let s = 1; s <= 6 && checked < 2; s++) {
    const g = grow(ps, 7, 'any', 4, seeded(s));
    if (!g) continue;
    checked++;
    for (let k = 1; k < g.panels.length; k++) {
      const back = g.travel[k]!.map(x => -x) as V3, before = g.panels.slice(0, k);
      assert.equal(pathBlocker(g.panels[k], back.map(x => x * exitDistance(g.panels[k], before, back)) as V3, before), null);
    }
    assert.deepEqual(collisions(g.panels), []);
  }
  assert.ok(checked > 0);
});

test('every kit fills a gallery with verified designs, and each exports cut files and a guide', () => {
  for (const kit of ['circle', 'triangle', 'hexagon', 'decagon'] as const) {
    const items = [...gallery({kit, intent: 'any', count: 6, size: 150, t: 4, clearance: c, seed: 1, designs: 2, attempts: 40})].filter((x): x is GalleryItem => 'design' in x);
    assert.ok(items.length >= 1, kit);
    for (const it of items) {
      const d = it.design;
      assert.ok(d.ok && d.hits.length === 0 && d.support.tipDeg > 4, `${kit}: ${d.checks.filter(k => k.level === 'error').map(k => k.label)}`);
      assert.equal(it.steps.length, d.panels.length);
      const svg = cutSheetSVG(d, it.marks), dxf = cutSheetDXF(d, it.marks), html = assemblyGuideHTML('t', d, it.parts, it.steps, it.marks);
      assert.equal((svg.match(/<path /g) ?? []).length, d.panels.length);
      assert.equal((svg.match(/<text /g) ?? []).length, it.marks.length);
      assert.equal((dxf.match(/\nPOLYLINE\n/g) ?? []).length, d.panels.reduce((s, p) => s + p.loops.length, 0));
      assert.ok(dxf.startsWith('0\nSECTION') && dxf.trimEnd().endsWith('EOF'));
      assert.ok(it.steps.every(st => html.includes(st.text.replace(/&/g, '&amp;'))));
    }
  }
});

/* ---------- engraving, 30-piece designs, recipes ---------- */

import {labelBox} from './gallery';
import {clampRecipe, recipeWeights, type Recipe} from './recipe';
import {convexOverlap as overlap2, pointInPolygon as inside2} from './poly2d';

test('engraved labels never cross a cut and stay on the piece, for every kit', () => {
  const area = (l: [number, number][]) => l.reduce((s2, a, k) => s2 + a[0] * l[(k + 1) % l.length][1] - l[(k + 1) % l.length][0] * a[1], 0) / 2;
  for (const kit of ['circle', 'triangle', 'hexagon', 'decagon'] as const) {
    const items = [...gallery({kit, intent: 'any', count: 8, size: 160, t: 4, clearance: c, seed: 2, designs: 2, attempts: 40})].filter((x): x is GalleryItem => 'design' in x);
    assert.ok(items.length > 0, kit);
    for (const it of items) for (const m of it.marks) {
      const panel = it.design.panels[m.panel], box = labelBox(m.at, m.text, m.size);
      const outer = [...panel.loops].sort((a, b) => area(b) - area(a))[0]; // slits open to the rim are notches in this loop
      assert.ok(box.every(q => inside2(outer, q)), `${kit}: label "${m.text}" leaves its piece`);
      for (const cut of panel.cuts) assert.ok(!overlap2(box, cut.poly, 0), `${kit}: label "${m.text}" crosses a slit`);
    }
  }
});

test('30-piece kit designs verify after loose end pieces are pruned', () => {
  const items = [...gallery({kit: 'circle', intent: 'compact', count: 30, size: 120, t: 4, clearance: c, seed: 1, designs: 1, attempts: 60})].filter((x): x is GalleryItem => 'design' in x);
  assert.equal(items.length, 1);
  const d = items[0].design;
  assert.ok(d.ok && d.panels.length >= Math.ceil(0.75 * 30) && d.panels.length <= 30, `${d.panels.length} pieces`);
  assert.ok(d.panels.every(p => p.hold !== 'loose'));
});

test('recipes are clamped to what the generator supports', () => {
  const r: Recipe = {kit: 'circle', form: 'tower', pieces: 80, pieceSizeMm: 5, footprintMm: 5000, sheetMm: 2.73, favour: ['C2I', 'P6'], avoid: ['C2L', 'C2I', 'C3T', 'H'], branching: 'chain', title: 'x', rationale: 'y'};
  const k = clampRecipe(r);
  assert.equal(k.pieces, 30);
  assert.equal(k.pieceSizeMm, 40);
  assert.equal(k.footprintMm, 8 * 40, 'the footprint circle is held to 2–8 piece sizes');
  assert.equal(k.sheetMm, 2.7);
  assert.ok(!k.favour.includes('P6' as never), 'pieces from another kit are dropped');
  assert.ok(['C2L', 'C2I', 'C3T', 'H'].some(id => !k.avoid.includes(id as never)), 'a growing piece is always left');
  assert.equal(recipeWeights(k).C1 ?? 1, 1);
});

/* ---------- tables: a cover of the kit's own shape resting on a level top ---------- */

import {coverReport} from './covers';
import {tableStance} from './gallery';

test('circle tables are stacked grids: tall, level cover on top, braced joints, built layer by layer', () => {
  const size = 200, items = [...gallery({kit: 'circle', intent: 'table', count: 14, size, t: 6, clearance: c, seed: 1, designs: 3, attempts: 80})].filter((x): x is GalleryItem => 'design' in x);
  assert.ok(items.length >= 2, `${items.length} tables`);
  for (const it of items) {
    const d = it.design, last = d.panels.length - 1;
    assert.ok(d.ok, `${d.checks.filter(k => k.level === 'error').map(k => k.detail)}`);
    assert.equal(d.panels[last].role, 'top');
    assert.ok(it.top!.tiltDeg < 0.1, `cover tilted ${it.top!.tiltDeg}`);
    assert.ok(Math.abs(it.top!.height - d.size.height) < 1e-6, 'the cover is the highest thing');
    assert.ok(it.top!.height >= 1.5 * size, `only ${Math.round(it.top!.height)} mm tall`);
    assert.ok(d.support.tipDeg >= 8, `tips at ${d.support.tipDeg.toFixed(1)}°`);
    assert.ok(Math.max(d.size.width, d.size.depth) <= 2 * it.top!.coverScale * size + 1e-6, 'no wider than twice the cover');
    const flatLevels = new Set(d.panels.slice(0, last).filter(p => Math.abs(p.frame.n[2]) > 0.99).map(p => Math.round(p.frame.o[2])));
    assert.ok(flatLevels.size >= 2, `flat discs on ${flatLevels.size} level(s)`);
    assert.ok(d.checks.some(k => k.label === 'Braced joints' && k.level === 'ok'));
    assert.ok(d.steps.some(st => (st.group?.length ?? 0) > 1), 'an upper layer is lowered as one unit');
    assert.equal(it.steps.length, d.steps.length);
    assert.ok(it.parts.some(p => p.id === 'CV' && p.count === 1));
  }
});

test('a table must stand tall, stay narrow and keep its cover over its feet', () => {
  const ok = {height: 400, plan: 500, coverWidth: 420, centreMargin: 120, tipDeg: 20};
  assert.equal(tableStance(ok, 240), null);
  assert.equal(tableStance({...ok, height: 126}, 240), 'too low for a table');
  assert.equal(tableStance({...ok, plan: 1600}, 240), 'spreads too wide for its cover');
  assert.equal(tableStance({...ok, centreMargin: 10}, 240), 'cover sits off to one side of the feet');
});

/* ---------- slit joints are hinges about their slit lines ---------- */

import {crossings, hingeModes} from './hinges';
import {weakJoint} from './kits';

test('a flat disc held on one slit line swings on it; one held on two lines at 90° is braced', () => {
  const ps = finishPieces('circle', 240, 6, c), by = new Map(ps.map(p => [p.id, p]));
  const mk = (id: string, X: Parameters<typeof frameOfX>[0], i: number) => makePanel(i, String(i + 1), 'module', by.get(id)!.outline, frameOfX(X), 6, by.get(id)!.cuts);
  // Flat C2I with a standing disc at each end: both joints on one line, so the flat turns about it.
  const F = by.get('C2I')!, legs = [0, 1].map(i => childFrame(IDENTITY, F, i, by.get('C1')!, 0, Math.PI / 2));
  const a = hingeModes([mk('C2I', IDENTITY, 0), mk('C1', legs[0], 1), mk('C1', legs[1], 2)]);
  assert.equal(a.crossings.length, 2);
  assert.deepEqual(a.swinging, [0]);
  assert.equal(a.sags, false, 'its centre of mass is on the line');
  // Flat C3T with three standing discs: lines along x and y, braced.
  const T = by.get('C3T')!, b = hingeModes([mk('C3T', IDENTITY, 0), ...[0, 1, 2].map(i => mk('C1', childFrame(IDENTITY, T, i, by.get('C1')!, 0, Math.PI / 2), i + 1))]);
  assert.deepEqual(b.swinging, []);
  // A load on the one-line flat off its line folds it.
  const flat = mk('C2I', IDENTITY, 0), load = hingeModes([flat, mk('C1', legs[0], 1), mk('C1', legs[1], 2)], new Set(), [{piece: 0, at: [0, 80, 3]}]);
  assert.equal(load.foldsUnderLoad, true);
  assert.equal(crossings([flat, flat]).length, 0, 'parallel pieces never cross');
});

test('no design pairs two half discs notch to notch', () => {
  const ps = finishPieces('circle', 200, 4, c), by = new Map(ps.map(p => [p.id, p]));
  assert.equal(weakJoint(by.get('H')!, by.get('H')!), true);
  assert.equal(weakJoint(by.get('H')!, by.get('C2I')!), false);
  let joints = 0;
  for (let s = 1; s <= 12; s++) {
    const g = grow(ps, 10, 'spread', 4, seeded(s), {weights: {H: 6}});
    if (!g) continue;
    for (const j of g.joints) { joints++; assert.ok(!(g.types[j.child] === 'H' && g.types[j.parent] === 'H'), `H–H joint in seed ${s}`); }
  }
  assert.ok(joints > 0);
});

/* ---------- random form: no target shape, inside a circle on the floor ---------- */

import {enclosingCircle} from './poly2d';
import {planDiameter} from './gallery';

test('smallest enclosing circle: two points set it, or three on its rim', () => {
  const sq = enclosingCircle([[0, 0], [2, 0], [2, 2], [0, 2], [1, 1]]);
  assert.ok(Math.abs(sq.r - Math.SQRT2) < 1e-9 && Math.abs(sq.c[0] - 1) < 1e-9 && Math.abs(sq.c[1] - 1) < 1e-9);
  const obtuse = enclosingCircle([[-3, 0], [3, 0], [0, 1]]);
  assert.ok(Math.abs(obtuse.r - 3) < 1e-9, 'an obtuse triangle is held by the circle on its long side');
  const acute = enclosingCircle([[-1, 0], [1, 0], [0, 1.5]]);
  assert.ok(Math.abs(Math.hypot(acute.c[0] + 1, acute.c[1]) - acute.r) < 1e-9 && Math.abs(Math.hypot(acute.c[0], acute.c[1] - 1.5) - acute.r) < 1e-9);
});

test('random designs fit inside their footprint circle and pass every check', () => {
  for (const [kit, size, limit] of [['circle', 200, 800], ['hexagon', 160, 480]] as const) {
    const items = [...gallery({kit, intent: 'random', count: 10, size, t: 4, clearance: c, seed: 1, designs: 3, attempts: 60, footprint: limit})].filter((x): x is GalleryItem => 'design' in x);
    assert.ok(items.length >= 2, `${kit}: ${items.length} random designs`);
    for (const it of items) {
      const d = it.design;
      assert.ok(d.ok, d.checks.filter(x => x.level === 'error').map(x => x.label).join(', '));
      assert.ok(planDiameter(d.panels) <= limit + 0.5 && it.footprint!.needed <= limit + 0.5, `${kit}: plan ${planDiameter(d.panels).toFixed(0)} mm in a ${limit} mm circle`);
      assert.equal(d.checks.find(x => x.label === 'Footprint')?.level, 'ok');
      assert.ok(d.panels.length >= Math.ceil(0.75 * 10) && d.panels.length <= 10);
    }
  }
});
