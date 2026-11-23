import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DIRS, step, type Cell} from './atlas/lattice.js';
import {hardChecks, normalAt, SlotBuild} from '../slotwright/sdk.js';
import {contactSheet, parseColor, pieceColor} from '../slotwright/render.js';

/** The hand-built car: a spine of five discs, four wheels on hangers, a cabin loop. */
function car() {
  const b = new SlotBuild();
  for (let x = 0; x <= 4; x++) b.disc([x, 0, 0], {name: `spine-${x}`});
  for (const x of [0, 4]) { b.disc([x, 1, 0], {name: `hanger-${x}-l`}); b.disc([x, 1, -1], {name: `wheel-${x}-l`}); }
  b.mirror('y');
  for (const c of [[1, 0, 1], [1, 0, 2], [2, 0, 2], [3, 0, 2], [3, 0, 1]] as Cell[]) b.disc(c);
  return b;
}

test('the joint lattice: a disc plane per cell parity, and every pair of neighbouring disc cells crosses square', () => {
  assert.equal(normalAt([0, 0, 0]), 2);
  assert.equal(normalAt([1, 1, 1]), 2);
  assert.equal(normalAt([1, 0, 0]), 1);
  assert.equal(normalAt([0, 1, 1]), 1);
  assert.equal(normalAt([0, 1, 0]), 0);
  assert.equal(normalAt([-1, 0, 1]), 0);
  assert.equal(normalAt([0, 0, 1]), null);
  assert.equal(normalAt([1, -1, 0]), null);
  for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) for (let z = -3; z <= 3; z++) {
    const a = normalAt([x, y, z]);
    if (a === null) continue;
    for (let d = 0; d < 6; d++) {
      const b = normalAt(step([x, y, z], d));
      // Through the face there is never a disc; in the plane there always is, square to both and to the step.
      if (d >> 1 === a) assert.equal(b, null);
      else assert.deepEqual([b !== null, b !== a, b !== d >> 1], [true, true, true], `(${x},${y},${z}) step ${DIRS[d]}`);
    }
  }
});

test('slits are the joints, and the kit piece follows from them', () => {
  const r = car().resolve();
  assert.deepEqual(r.problems, []);
  const by = new Map(r.pieces.map(p => [p.name, p]));
  assert.equal(by.get('spine-0')!.piece, 'C3T');
  assert.equal(by.get('spine-2')!.piece, 'C2I');
  assert.equal(by.get('hanger-0-l')!.piece, 'C2L');
  assert.equal(by.get('wheel-0-r')!.piece, 'C1');
  assert.ok(by.get('wheel-4-r')!.touchesFloor);
  // Joints are symmetric.
  for (const p of r.pieces) for (const j of p.joins) assert.ok(r.pieces[j - 1].joins.includes(p.index));
});

test('placing errors are immediate; shape errors are reported with the piece and cell', () => {
  const b = new SlotBuild();
  assert.throws(() => b.disc([0, 0, 1]), /no disc can sit at \(0, 0, 1\)/);
  b.disc([0, 0, 0]);
  assert.throws(() => b.disc([0, 0, 0]), /already holds piece #1/);
  for (const c of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]] as Cell[]) b.disc(c);
  b.disc([5, 5, 5], {name: 'stray'});
  const problems = b.resolve().problems.join('\n');
  assert.match(problems, /#1 at \(0, 0, 0\) has 4 neighbours/);
  assert.match(problems, /"stray" at \(5, 5, 5\) has no neighbour/);
  assert.equal(hardChecks(b.resolve()).ok, false);
  const h = new SlotBuild();
  h.disc([0, 0, 0]);
  assert.throws(() => h.half([1, 0, 0], '+y'), /cannot face \+y/);
  h.half([1, 0, 0], '-x');
  assert.deepEqual(h.resolve().problems, []);
  assert.equal(h.resolve().pieces[1].piece, 'H1');
});

test('the car passes every hard check; a lone wheel on a stick does not stand', () => {
  const v = hardChecks(car().resolve());
  assert.deepEqual(v.checks.filter(c => !c.passed), []);
  assert.ok(v.ok && v.tipDeg > 5 && v.steps.length > 0);
  const stick = new SlotBuild();
  stick.disc([0, 0, 0]); stick.disc([1, 0, 0]); stick.disc([2, 0, 0]);
  const w = hardChecks(stick.resolve());
  assert.equal(w.checks.find(c => c.name === 'stands')!.passed, false);
});

test('mirror swaps sides in names and skips taken cells', () => {
  const b = new SlotBuild();
  b.disc([0, 0, 0]); b.disc([0, 1, 0], {name: 'arm-l'}); b.disc([0, -1, 0], {name: 'taken'});
  b.mirror('y');
  assert.equal(b.count, 3);
  b.disc([0, 1, 1], {name: 'hand-l'});
  b.mirror('y');
  assert.equal(b.resolve().pieces.find(p => p.cell.join() === '0,-1,1')!.name, 'hand-r');
});

test('renders a contact sheet with every piece visible and colours parse', () => {
  const r = car().resolve();
  const img = contactSheet(r.panels.map((panel, i) => ({panel, color: pieceColor(i), label: String(i + 1)})), {pitch: r.kit.p});
  assert.equal(img.width, 2 * 512 + 2);
  assert.equal(img.rgb.length, img.width * img.height * 3);
  let coloured = 0;
  for (let i = 0; i < img.rgb.length; i += 3) if (Math.max(img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]) - Math.min(img.rgb[i], img.rgb[i + 1], img.rgb[i + 2]) > 40) coloured++;
  assert.ok(coloured > 20000, `${coloured} coloured pixels`);
  assert.deepEqual(parseColor('#f00'), [255, 0, 0]);
  assert.deepEqual(parseColor('black'), [40, 40, 44]);
  assert.equal(parseColor('not a colour'), null);
});

test('studio runs: the material and circle count are checked, and SDK imports are rewritten for the worker', async () => {
  const {checkModule} = await import('../slotwright/validate.js');
  const {asModule} = await import('../slotwright/module.js');
  const {studioMaterial, template, WEB_SDK} = await import('../slotwright/template.js');
  const m = studioMaterial(228.6, 24);
  assert.deepEqual(m, {discMm: 228.6, sheetMm: 6.35, clearance: 0.2, maxPieces: 24});
  assert.equal(studioMaterial(200, 99).maxPieces, 30);
  const src = template('a car', WEB_SDK, m);
  assert.match(src, /new SlotBuild\(\{discMm: 228\.6, sheetMm: 6\.35\}\)/);
  const mod = asModule(src);
  assert.match(mod, /^const \{SlotBuild\} = globalThis\.__slotlayer;$/m);
  assert.equal(mod.split('\n').length, src.split('\n').length);
  assert.equal(asModule("import {SlotBuild as SB, normalAt} from 'x';"), 'const {SlotBuild : SB, normalAt} = globalThis.__slotlayer;');
  const at = (discMm: number, sheetMm: number) => ({createBuild: () => { const b = new SlotBuild({discMm, sheetMm}); for (let x = 0; x <= 4; x++) b.disc([x, 0, 0]); for (const x of [0, 4]) { b.disc([x, 1, 0]); b.disc([x, 1, -1]); } b.mirror('y'); return b; }});
  const ok = (await checkModule(at(228.6, 6.35), '', m)).report;
  assert.ok(ok.ok, JSON.stringify(ok.checks));
  const wrong = (await checkModule(at(80, 3), '', m)).report;
  assert.equal(wrong.checks.find(c => c.name === 'material')!.passed, false);
  const few = (await checkModule(at(228.6, 6.35), '', {...m, maxPieces: 10})).report;
  assert.match(few.checks.find(c => c.name === 'piece_budget')!.detail ?? '', /13 pieces; the user has 10 circles/);
});

test('a car with half-disc hood and trunk finishes (the planner used to recurse until the stack ran out)', async () => {
  const {finishedItem, formKey} = await import('../slotwright/design.js');
  const {kitFor, CUT_CLEARANCE} = await import('../studio/query.js');
  const b = new SlotBuild({discMm: 228.6, sheetMm: 6.35});
  for (const x of [-3, -1, 1, 3]) b.disc([x, 1, 1]);
  b.disc([-2, 1, 1]); b.disc([2, 1, 1]);
  b.mirror('y');
  for (const x of [3, 1, -1, -3]) b.disc([x, 0, 1]);
  b.disc([1, 0, 2]); b.disc([-1, 0, 2]); b.disc([0, 0, 2]);
  b.half([3, 0, 2], '-z'); b.half([-3, 0, 2], '-z');
  const r = b.resolve(), v = hardChecks(r);
  assert.ok(v.ok, JSON.stringify(v.checks.filter(c => !c.passed)));
  for (const kit of [kitFor(228.6), kitFor(228.6, CUT_CLEARANCE)]) {
    const item = finishedItem(kit, formKey(r.form), v.steps, 'Car');
    assert.equal(item.design.panels.length, 21);
  }
});
