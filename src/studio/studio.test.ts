import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {fromKey} from '../slots/atlas/lattice.js';
import type {AtlasRun} from '../slots/atlas/item.js';
import {parsePurpose} from './spec.js';
import {candidates, cellsNeeded, circleCount, inSlice, isClosed, judgeAt, MIN_DIAMETER, reach, scaleAt, sheetCells, sheetOptions, spreadOrder} from './query.js';

const runDir = readdirSync('atlas-runs').filter(d => /^\d{4}-/.test(d)).sort().reverse()[0];
const run = JSON.parse(readFileSync(`atlas-runs/${runDir}/atlas.json`, 'utf8')) as AtlasRun;

test('purpose text becomes a spec, with what it heard', () => {
  const side = parsePurpose('a side table for the sofa');
  assert.ok(side.ok && side.spec.purpose === 'side table' && side.spec.minH === 450 && side.spec.maxH === 600);
  const tall = parsePurpose('plant stand 70 cm tall');
  assert.ok(tall.ok && Math.abs(tall.spec.target - 700) < 1e-9 && tall.spec.minH < 700 && tall.spec.maxH > 700, JSON.stringify(tall));
  const wide = parsePurpose('coffee table with a top 50 cm wide');
  assert.ok(wide.ok && wide.spec.minWidth === 500);
  const desk = parsePurpose('Desk');
  assert.ok(desk.ok && desk.spec.knee);
  assert.ok(!parsePurpose('bookshelf').ok);
  assert.ok(!parsePurpose('a chair').ok);
  assert.ok(!parsePurpose('a lamp').ok);
});

test('candidates are closed: every slit cut joins something, and halves count half', () => {
  const cs = candidates(run, true);
  assert.ok(cs.length > 300, `${cs.length} candidates`);
  for (const c of cs.slice(0, 200)) {
    const f = fromKey(c.key);
    assert.ok(isClosed(f), c.key);
    assert.equal(c.circles, circleCount(f));
  }
  assert.ok(candidates(run, false).length > cs.length, 'not stable adds near misses');
});

test('a side table at 220 mm discs: slice, spread, and the judge agrees on most', () => {
  const spec = parsePurpose('side table');
  assert.ok(spec.ok);
  const cs = candidates(run, true), m = {diameter: 220, circles: 30}, s = scaleAt(run, 220);
  const slice = cs.filter(c => inSlice(c, spec.spec, m, s));
  assert.ok(slice.length > 10, `${slice.length} in the slice`);
  const order = spreadOrder(slice);
  assert.equal(order.length, slice.length);
  const judged = order.slice(0, 4).map(c => judgeAt(c.key, spec.spec, 220, true));
  assert.ok(judged.filter(j => j.ok).length >= 3, JSON.stringify(judged.map(j => [j.verdict.fails, j.misses])));
  for (const j of judged.filter(j => j.ok)) assert.ok(j.verdict.metrics.height >= 450 && j.verdict.metrics.height <= 600);
});

test('a dining table at the smallest discs is out of reach, and reach says what diameter would do', () => {
  const spec = parsePurpose('dining table');
  assert.ok(spec.ok);
  const cs = candidates(run, true), m = {diameter: MIN_DIAMETER, circles: 30};
  assert.equal(cs.filter(c => inSlice(c, spec.spec, m, scaleAt(run, MIN_DIAMETER))).length, 0);
  const r = reach(run, cs, spec.spec, m);
  assert.ok(r.minD && r.minD > MIN_DIAMETER, JSON.stringify(r));
});

test('sheet mode: cells, a design\'s share of them, and the diameters worth offering', () => {
  assert.equal(sheetCells([1220, 610], 200), 5 * 2);
  const cs = candidates(run, true), spec = parsePurpose('side table');
  assert.ok(spec.ok);
  const c = cs[0];
  assert.ok(cellsNeeded(fromKey(c.key), [300, 300], 200) >= Math.ceil(c.circles));
  const opts = sheetOptions(run, cs, spec.spec, [2440, 1220]);
  assert.ok(opts.length > 0 && opts.length <= 5, JSON.stringify(opts));
  for (const o of opts) assert.ok(o.diameter >= MIN_DIAMETER && o.count > 0);
});
