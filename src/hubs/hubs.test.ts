import {test} from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {design, pinFreedom} from './design';
import {buildHub} from './hubmesh';
import {DEFAULT_HUB, band, stopFloor} from './params';
import {classify, partsGraph} from './parts';
import {makeDesign} from './pipeline';
import {SHAPES, chairParts} from './shapes';
import {dist, type V3} from './vec';

test('stop floor keeps a wall between bores at the same depth', () => {
  const p = DEFAULT_HUB, need = p.boreDiameter / 2 + p.wall / 2;
  for (const deg of [20, 30, 45, 60, 90]) {
    const th = (deg * Math.PI) / 180, s = stopFloor(th, p);
    assert.ok(s * Math.sin(th / 2) >= need - 1e-9, `${deg}°`);
  }
  assert.equal(stopFloor(Math.PI, p), p.minStop);
});

test('stop depths make hub spacing equal stick length plus both stops', () => {
  const nodes: V3[] = [[0, 0, 0], [80, 0, 0], [40, 69, 0]];
  const d = design('triangle', {nodes, edges: [[0, 1], [1, 2], [0, 2]]});
  for (const [i, s] of d.sticks.entries()) {
    const [a, b] = s.hubs;
    const sa = d.holes[a].find(h => h.stick === i)!.stop, sb = d.holes[b].find(h => h.stick === i)!.stop;
    assert.equal(s.status, 'ok');
    assert.ok(Math.abs(sa + sb + DEFAULT_HUB.stickLength - s.span) < 1e-9);
  }
});

test('spans outside the band are flagged rather than hidden', () => {
  const {lo, hi} = band();
  const short = design('s', {nodes: [[0, 0, 0], [lo - 10, 0, 0]], edges: [[0, 1]]});
  const long = design('l', {nodes: [[0, 0, 0], [hi + 10, 0, 0]], edges: [[0, 1]]});
  assert.equal(short.sticks[0].status, 'cut');
  assert.equal(long.sticks[0].status, 'long');
});

test('pin rigidity: a triangle is rigid, a square is not, a tetrahedron is', () => {
  assert.equal(pinFreedom({nodes: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], edges: [[0, 1], [1, 2], [0, 2]]}), 0);
  // A square without a diagonal can shear in its plane and fold out of it.
  assert.ok(pinFreedom({nodes: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], edges: [[0, 1], [1, 2], [2, 3], [3, 0]]}) > 0);
  assert.equal(pinFreedom({nodes: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], edges: [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]}), 0);
});

test('chair parts classify and fuse into one connected frame', () => {
  const kinds = Object.fromEntries(chairParts().map(p => [p.name, classify(p).kind]));
  assert.equal(kinds['leg front left'], 'rod');
  assert.equal(kinds.seat, 'plate');
  assert.equal(kinds.backrest, 'plate');
  const g = partsGraph(chairParts());
  const d = design('chair', g);
  assert.ok(d.report.connected);
  assert.equal(d.report.long + d.report.cut, 0);
  // Leg tops fuse with seat corners: no two hubs closer than half a span.
  for (let i = 0; i < g.nodes.length; i++) for (let j = i + 1; j < g.nodes.length; j++) assert.ok(dist(g.nodes[i], g.nodes[j]) > 40);
});

test('banana shell is connected, rigid and mostly uncut', () => {
  const d = makeDesign(SHAPES.banana());
  assert.ok(d.report.connected);
  assert.equal(d.report.pinFreedom, 0);
  assert.equal(d.report.tooTightHubs.length, 0);
  assert.ok(d.report.ok / d.report.stickCount >= 0.8, `${d.report.ok}/${d.report.stickCount} uncut`);
  assert.equal(d.order.length, d.report.stickCount);
});

test('every banana hub builds as a valid closed solid', async () => {
  const wasm = await Module();
  wasm.setup();
  const d = makeDesign(SHAPES.banana());
  for (const [i, holes] of d.holes.entries()) {
    const hub = buildHub(wasm, holes, d.params);
    assert.equal(hub.status(), 'NoError', `hub ${i}`);
    assert.equal(hub.genus(), 0, `hub ${i}: bores are blind, so the solid has no through-holes`);
    assert.ok(hub.volume() > 0);
    hub.delete();
  }
});
