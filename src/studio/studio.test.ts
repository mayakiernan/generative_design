import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fromKey} from '../slots/atlas/lattice.js';
import type {AtlasRun} from '../slots/atlas/item.js';
import {parsePurpose} from './spec.js';
import {STUDIO_RUN, candidates, cellsNeeded, circleCount, inSlice, isClosed, judgeAt, MIN_DIAMETER, reach, scaleAt, sheetCells, sheetOptions, spreadOrder} from './query.js';

const run = JSON.parse(readFileSync(`atlas-runs/${STUDIO_RUN}/atlas.json`, 'utf8')) as AtlasRun;

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
    assert.ok(!f.discs.some(p => p.k === 'H'), `notched half disc in ${c.key}`);
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

test('form counts: exact where counted, then an estimate inside its band, rising', async () => {
  const {formCounts, formatCount} = await import('./counts.js');
  const rows = formCounts(run.levels);
  assert.equal(rows[0].n, 2);
  assert.equal(rows[rows.length - 1].n, 30);
  assert.equal(rows.length, 29);
  for (const r of rows.filter(r => r.exact)) assert.equal(Math.round(10 ** r.log), run.levels.find(l => l.n === r.n)!.forms);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].log > rows[i - 1].log);
  for (const r of rows.filter(r => !r.exact)) assert.ok(r.low <= r.log && r.log <= r.high, JSON.stringify(r));
  assert.equal(formatCount(rows.find(r => r.n === 4)!).text, run.levels.find(l => l.n === 4)!.forms.toLocaleString('en-US'));
  const last = rows[rows.length - 1];
  assert.ok(last.log > 32 && last.log < 38, `${last.log}`);
  // A level known only from below (where counting passed its cap) floors the estimates from there on.
  const counted = Math.max(...run.levels.map(l => l.n)), floor = {n: counted + 1, forms: 10 ** (rows.find(r => r.n === counted + 1)!.log + 0.5)};
  const floored = formCounts(run.levels, 2, 30, floor), next = floored.find(r => r.n === counted + 1)!;
  assert.ok(next.low >= Math.log10(floor.forms) - 1e-9 && next.log >= next.low && next.atLeast === floor.forms);
});

test('a sculpture has no top and only has to stand: some forms in the archive do, with nothing on top', () => {
  const p = parsePurpose('a sculpture for the shelf');
  assert.ok(p.ok && p.spec.role === 'none');
  const free = candidates(run, false, false);
  assert.ok(free.length > candidates(run, true).length, `${free.length} forms`);
  const s = scaleAt(run, 220), slice = free.filter(c => inSlice(c, p.spec, {diameter: 220, circles: 12}, s));
  assert.ok(slice.length > 20, `${slice.length} in the slice`);
  const judged = spreadOrder(slice).slice(0, 12).map(c => judgeAt(c.key, p.spec, 220, true, c.rest));
  const ok = judged.filter(j => j.ok);
  assert.ok(ok.length >= 1, JSON.stringify(judged.map(j => j.verdict.fails)));
  for (const j of ok) assert.equal(j.verdict.top, null);
});

test('blog posts: front matter, Markdown, and nothing unsafe gets through', async () => {
  const {parsePost, renderMarkdown} = await import('./blog/markdown.js');
  const p = parsePost('first', '---\ntitle: First cuts\ndate: 2026-11-30\nsummary: One line.\n---\n## Notes\n\nSome **bold** and *italic*, a [link](https://example.com).\n\n- one\n- two\n\n> quoted');
  assert.equal(p.title, 'First cuts');
  assert.equal(p.date, '2026-11-30');
  assert.ok(p.html.includes('<h3>Notes</h3>') && p.html.includes('<strong>bold</strong>') && p.html.includes('<em>italic</em>'), p.html);
  assert.ok(p.html.includes('<ul><li>one</li><li>two</li></ul>') && p.html.includes('<blockquote>'), p.html);
  assert.ok(p.html.includes('href="https://example.com" target="_blank"'), p.html);
  const bad = renderMarkdown('<script>alert(1)</script> [x](javascript:alert(1))');
  assert.ok(!bad.includes('<script') && !bad.includes('javascript:'), bad);
});

test('hold steps: one entry per build step, a flat disc alone needs no hand, and judged designs carry them', async () => {
  const {stepHolds} = await import('../slots/atlas/holds.js');
  const {Form, makeKit: mk} = await import('../slots/atlas/lattice.js');
  const kit = mk(229, 6.35, 0.2);
  const flat = new Form([{c: [0, 0, 0], a: 2, m: 1}]);
  assert.deepEqual(stepHolds(kit, flat, [{group: [0], travel: -1, bench: []}]).map(h => h.needs), [false]);
  const spec = parsePurpose('side table');
  assert.ok(spec.ok);
  const c = spreadOrder(candidates(run, true).filter(x => inSlice(x, spec.spec, {diameter: 229, circles: 30}, scaleAt(run, 229))))[0];
  const j = judgeAt(c.key, spec.spec, 229, true, c.rest);
  assert.ok(j.ok && j.holds && j.holds.length === j.verdict.steps.length, JSON.stringify(j.holds?.length));
});
