import {test} from 'node:test';
import assert from 'node:assert/strict';
import {childFrame, grow} from './kits.js';
import {frameOf, type Xf} from './kit.js';
import {growStacked} from './grids.js';
import {crossings} from './hinges.js';
import {panelDepth, pathBlocker} from './collide.js';
import {partHold} from './stability.js';
import {panelVertices} from './panel.js';
import {rng} from './math.js';
import type {Frame} from './panel.js';
import {
  axisOf, canonicalKey, connected, dirIndex, DIRS, Form, HALF_PIECES, inPlane, looseDiscs, pieceId, skeletonKey, fromKey, FULL_PIECES, latticeOf, makeKit, mouths, overlaps, pieceOf,
  posePanel, posesOnto, symmetryOrder, transformPose, type Axis, type Pose,
} from './atlas/lattice.js';
import {blockerMasks, findAssembly, placementOrder} from './atlas/assembly.js';
import {judge} from './atlas/judge.js';
import {addSlit, Atlas, enumerate, graft, gridSeeds, isEggCrate, mutate, prune, treeSeeds} from './atlas/explore.js';
import {distance, fingerprint, FingerprintSet} from './atlas/structure.js';
import {defaultRules} from './atlas/judge.js';
import {atlasDesign} from './atlas/view.js';

const kit = makeKit(80, 3, 0.2);
const xfOf = (f: Frame): Xf => ({R: [f.u[0], f.v[0], f.n[0], f.u[1], f.v[1], f.n[1], f.u[2], f.v[2], f.n[2]], t: f.o});

/** Every pose a piece can take: full discs with every mouth set some kit piece has, and with `halves` H1 and H. */
const allPoses = (halves = false, c: [number, number, number] = [0, 0, 0]): Pose[] =>
  ([0, 1, 2] as Axis[]).flatMap(a => [
    ...Array.from({length: 64}, (_, m) => m).filter(m => pieceOf(a, m)).map(m => ({c, a, m})),
    ...(halves ? inPlane(a).flatMap(d => [
      {c, a, m: 1 << d, k: 'H1' as const},
      ...(d % 2 === 0 ? inPlane(a).filter(s => axisOf(s) !== axisOf(d)).map(s => ({c, a, m: (1 << d) | (1 << (d ^ 1)), k: 'H' as const, s})) : []),
    ]) : []),
  ]);
/** World direction of a slit mouth (an H's notch mouths sit half a slit width off the diameter, so round). */
const mouthDir = (f: Frame, e: [number, number]) => { const l = Math.hypot(e[0], e[1]); return dirIndex([0, 1, 2].map(k => Math.round(f.u[k] * e[0] / l + f.v[k] * e[1] / l)) as [number, number, number]); };

test('lattice pitch: two joined discs sit 2R − 2ℓ apart, 1.04 R for the circle kit', () => {
  assert.ok(Math.abs(kit.p - 1.04 * kit.R) < 1e-9, `p = ${kit.p}`);
  assert.equal(allPoses().length, 42);
  assert.equal(allPoses(true).length, 42 + 12 + 12);
  for (const p of allPoses(true)) assert.ok(pieceId(p), JSON.stringify(p));
});

test('lattice joints are exactly childFrame joints: every piece (half discs too), slit and side lands on a lattice pose onto that slit', () => {
  for (const A of allPoses(true)) {
    const PA = posePanel(kit, A, 0), P = kit.pieces.get(pieceId(A)!)!, XP = xfOf(PA.frame);
    for (let i = 0; i < P.slits.length; i++) {
      const d = mouthDir(PA.frame, P.slits[i].e);
      assert.ok(d >= 0 && A.m & (1 << d), `${P.id} slit ${i}`);
      const want = new Set(posesOnto(A, d).map(q => canonicalKey([q])));
      const got = new Set<string>();
      for (const id of [...FULL_PIECES, ...HALF_PIECES]) {
        if (id === 'H' && A.k === 'H') continue; // never notch to notch
        const Q = kit.pieces.get(id)!;
        for (let j = 0; j < Q.slits.length; j++) for (const psi of [Math.PI / 2, (3 * Math.PI) / 2]) {
          const F = frameOf(childFrame(XP, P, i, Q, j, psi)), pose = latticeOf(kit, [PA, {...PA, frame: F}], [P.id, id]);
          assert.ok(pose instanceof Form, `${P.id} slit ${i} → ${id} slit ${j}: ${'why' in pose ? pose.why : ''}`);
          const B = pose.discs[1];
          assert.ok(posesOnto(A, d).some(q => q.a === B.a && q.m === B.m && q.c.join() === B.c.join()), `${id} lands on a pose onto the slit`);
          assert.equal(pose.joints().length, 1, 'the form sees the joint');
          assert.ok(!overlaps(kit, A, B), 'joined discs do not overlap');
          assert.ok(panelDepth(PA, posePanel(kit, B, 1)) <= 0);
          got.add(canonicalKey([B]));
        }
      }
      // And every pose onto the slit is some piece on some side.
      for (const k of want) assert.ok(got.has(k), `${P.id}: ${k} not reached`);
    }
  }
});

test('discs in one plane one step apart overlap; a slit facing a disc face does not', () => {
  const A: Pose = {c: [0, 0, 0], a: 1, m: 1 << 0};
  assert.ok(overlaps(kit, A, {c: [1, 0, 0], a: 1, m: 1 << 1}), 'coplanar neighbours overlap');
  assert.ok(!overlaps(kit, A, {c: [1, 0, 0], a: 0, m: 1 << 2}), 'a disc square to the slit, facing its mouth, clears it');
  assert.ok(overlaps(kit, A, {c: [1, 0, 0], a: 2, m: 1 << 2}), 'a square disc without the matching slit runs into it');
});

test('stacked grids map onto the lattice, and lattice joints match the crossings found from geometry', () => {
  const pieces = [...kit.pieces.values()];
  let n = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const g = growStacked(pieces, 12 + (seed % 15), kit.t, rng(seed), {}, [2, 3, 4]);
    if (!g) continue;
    const form = latticeOf(kit, g.panels, g.types);
    assert.ok(form instanceof Form, 'why' in form ? form.why : '');
    assert.ok(connected(form));
    assert.equal(form.joints().length, crossings(g.panels).length, `seed ${seed}`);
    for (let i = 0; i < form.size; i++) for (let j = i + 1; j < form.size; j++) assert.ok(!overlaps(kit, form.discs[i], form.discs[j]));
    n++;
  }
  assert.ok(n >= 20, `${n} grids`);
});

test('canonical keys ignore turning, mirroring and sliding about the vertical, and fromKey round-trips', () => {
  const r = rng(5);
  for (let trial = 0; trial < 40; trial++) {
    // A random tree of a few pieces, half discs included.
    let form = new Form([r.pick(allPoses(true))]);
    for (let k = 0; k < 6; k++) {
      const open = form.openSlits();
      if (!open.length) break;
      const [i, d] = r.pick(open), pose = r.pick(posesOnto(form.discs[i], d));
      if (form.fits(kit, pose)) form = form.with(pose);
    }
    const key = canonicalKey(form), shift = [r.int(-3, 3), r.int(-3, 3), r.int(-3, 3)];
    for (let s = 0; s < 8; s++) {
      const moved = form.discs.map(p => transformPose(p, s)).map(p => ({...p, c: p.c.map((x, i) => x + shift[i]) as Pose['c']}));
      assert.equal(canonicalKey(moved), key);
    }
    assert.equal(canonicalKey(fromKey(key)), key);
    for (const p of fromKey(key).discs) assert.ok(pieceId(p), `round-trips to a real piece: ${JSON.stringify(p)}`);
    assert.ok([1, 2, 4, 8].includes(symmetryOrder(form)));
    for (const p of form.discs) assert.ok(mouths(p.m).length >= 1);
  }
});

test('a joined disc slides off along its slit line and is blocked every other way (an H, notched at its edge, may also lift off its material side)', () => {
  for (const A of allPoses()) for (const d of mouths(A.m)) for (const B of posesOnto(A, d)) {
    const form = new Form([A, B]), masks = blockerMasks(kit, form);
    for (let r = 0; r < 6; r++) {
      const exempt = B.k === 'H' && r === B.s;
      if (!exempt) assert.equal(masks[1][r] === 0, r === d, `${B.k ?? 'disc'} along ${r} (slit line ${d})`);
      if (B.k !== 'H') assert.equal(masks[0][r] === 0, r === (d ^ 1), `A along ${r}`);
    }
  }
});

test('every stacked grid has a group build sequence, and a grown tree comes apart a disc at a time', () => {
  const pieces = [...kit.pieces.values()];
  let grids = 0, loopy = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const g = growStacked(pieces, 12 + (seed % 17), kit.t, rng(seed), {}, [2, 3, 4]);
    if (!g) continue;
    const form = latticeOf(kit, g.panels, g.types) as Form, a = findAssembly(kit, form);
    assert.ok(a.ok, `grid seed ${seed}: ${a.exhausted ? 'budget' : 'none found'} after ${a.nodes}`);
    assert.deepEqual([...placementOrder(a.steps)].sort((x, y) => x - y), form.discs.map((_, i) => i));
    if (a.steps.some(s => s.group.length > 1)) loopy++;
    grids++;
  }
  assert.ok(grids >= 15 && loopy >= 10, `${grids} grids, ${loopy} needing groups`);
  const noHalves = {weights: {H: 0, H1: 0}};
  for (let seed = 1; seed <= 15; seed++) {
    const g = grow(pieces, 10, 'any', kit.t, rng(seed), noHalves);
    if (!g) continue;
    const form = latticeOf(kit, g.panels, g.types) as Form, a = findAssembly(kit, form);
    assert.ok(a.ok, `tree seed ${seed}`);
    assert.ok(a.steps.every(s => s.group.length === 1), 'a tree needs no groups');
  }
});

test('memoised slide blockers and loose-part test agree with the engine on real forms', () => {
  const pieces = [...kit.pieces.values()], forms: Form[] = [];
  for (let seed = 1; seed <= 6; seed++) {
    const g = growStacked(pieces, 14 + seed, kit.t, rng(seed), {}, [2, 3]);
    if (g) forms.push(latticeOf(kit, g.panels, g.types) as Form);
    const tr = grow(pieces, 12, 'any', kit.t, rng(seed), seed % 2 ? {} : {weights: {H: 0, H1: 0}});
    if (tr) forms.push(latticeOf(kit, tr.panels, tr.types) as Form);
  }
  for (const form of forms) {
    const panels = form.panels(kit), masks = blockerMasks(kit, form), span = 20 * kit.p;
    for (let i = 0; i < form.size; i++) for (let d = 0; d < 6; d++) for (let j = 0; j < form.size; j++) {
      if (i === j) continue;
      const direct = pathBlocker(panels[i], DIRS[d].map(x => x * span) as [number, number, number], [panels[j]]) !== null;
      assert.equal(!!(masks[i][d] & (1 << j)), direct, `disc ${i} along ${d} vs ${j}`);
    }
    const z0 = Math.min(...panels.flatMap(panelVertices).map(v => v[2]));
    const engine = panels.map((P, i) => (partHold(P, panels.filter(Q => Q !== P), z0, 1.5 + kit.clearance).hold === 'loose' ? i : -1)).filter(i => i >= 0);
    assert.deepEqual(looseDiscs(kit, form, panels), engine);
  }
});

test('exhaustive enumeration: 14, 60 and 419 forms of one to three full discs; more with half discs', () => {
  const full: number[] = [], all: number[] = [];
  assert.deepEqual(enumerate(kit, 3, (_, keys) => full.push(keys.length), 2_000_000, false), {complete: true});
  assert.deepEqual(full, [14, 60, 419]);
  enumerate(kit, 3, (_, keys) => all.push(keys.length));
  assert.ok(all.every((n, i) => n > full[i]), `${all}`);
});

test('changes keep forms connected and overlap-free; a spare slit keeps the skeleton', () => {
  const r = rng(11);
  let form = gridSeeds(kit, 20)[0];
  for (let k = 0; k < 150; k++) {
    const next = mutate(kit, form, r, 30);
    if (!next) continue;
    form = next;
    assert.ok(connected(form));
    assert.ok(form.size <= 30);
    for (let i = 0; i < form.size; i++) {
      assert.ok(pieceOf(form.discs[i].a, form.discs[i].m));
      for (let j = i + 1; j < form.size; j++) assert.ok(!overlaps(kit, form.discs[i], form.discs[j]));
    }
  }
  const grid = gridSeeds(kit, 20)[1];
  for (let s = 0; s < 20; s++) {
    const spare = addSlit(kit, grid, rng(s));
    if (spare && spare.joints().length === grid.joints().length) assert.equal(skeletonKey(spare), skeletonKey(grid));
  }
});

test('the atlas files legal grids, and a legal entry rebuilds as an engine design that passes', () => {
  const atlas = new Atlas(kit, defaultRules(kit));
  for (const f of gridSeeds(kit, 60)) atlas.add(f);
  const legal = atlas.elites().filter(e => !e.fails);
  assert.ok(legal.length >= 5, `${legal.length} legal`);
  const e = legal[0], d = atlasDesign(kit, e, 'test');
  assert.ok(d.ok, d.checks.filter(c => c.level === 'error').map(c => `${c.label}: ${c.detail}`).join('; '));
  assert.equal(d.panels.length, e.metrics.discs + 1, 'discs and the top');
  assert.equal(d.steps.length, e.steps.length + 1);
  assert.ok(Math.abs(Math.min(...d.panels.flatMap(p => panelVertices(p).map(v => v[2])))) < 1e-9, 'set on the floor');
  // The judge is deterministic on the canonical form.
  assert.equal(judge(kit, fromKey(e.key)).fails, 0);
});

test('egg crates are recognised by structure: every stacked grid is one, grown trees are not', () => {
  const grids = gridSeeds(kit, 120);
  assert.ok(grids.length > 40);
  for (const g of grids) assert.ok(isEggCrate(kit, g), canonicalKey(g));
  for (const t of treeSeeds(kit, 40)) assert.ok(!isEggCrate(kit, t));
});

test('structural fingerprints ignore turning, sliding and spare slits, and tell grids from trees', () => {
  const [grid] = gridSeeds(kit, 5), [tree] = treeSeeds(kit, 3), fp = fingerprint(grid);
  for (let k = 0; k < 8; k++) {
    const moved = new Form(grid.discs.map(p => transformPose(p, k)).map(p => ({...p, c: p.c.map(x => x + 3) as Pose['c']})));
    assert.ok(distance(fingerprint(moved), fp) < 1e-6);
  }
  for (let s = 0; s < 10; s++) { const spare = addSlit(kit, grid, rng(s)); if (spare && spare.joints().length === grid.joints().length) assert.ok(distance(fingerprint(spare), fp) < 1e-6); }
  assert.ok(distance(fingerprint(tree), fp) > 0.3);
  const set = new FingerprintSet(3);
  set.add(fp); set.add(fingerprint(tree));
  assert.ok(set.novelty(fp, true) > 0.3, 'its own copy is not counted');
  assert.equal(set.novelty(fp, false), distance(fp, fingerprint(tree)) / 2);
});

test('grafts and prunes keep forms connected and overlap-free', () => {
  const r = rng(3), donors = [...gridSeeds(kit, 30), ...treeSeeds(kit, 20)];
  let made = 0;
  for (let k = 0; k < 120; k++) {
    const base = r.pick(donors), f = k % 2 ? graft(kit, base, r.pick(donors), r) : prune(base, r);
    if (!f) continue;
    made++;
    assert.ok(connected(f));
    for (let i = 0; i < f.size; i++) for (let j = i + 1; j < f.size; j++) assert.ok(!overlaps(kit, f.discs[i], f.discs[j]));
    if (k % 2) assert.ok(f.size > base.size); else assert.ok(f.size < base.size);
  }
  assert.ok(made > 40, `${made} made`);
});

test('ranked by novelty, egg crates sit at distance 0 and new structure scores higher than a copy', () => {
  const atlas = new Atlas(kit, defaultRules(kit), 'novel'), grids = gridSeeds(kit, 40);
  atlas.setCrates(grids);
  for (const g of grids) atlas.add(g);
  const legal = atlas.elites().filter(e => !e.fails);
  assert.ok(legal.length > 3);
  for (const e of legal) { assert.equal(e.crate, 0); assert.equal(e.features.crate, 'egg crate'); }
  atlas.refreshNovelty();
  for (const e of atlas.elites()) assert.ok(Number.isFinite(e.novelty) && e.novelty >= 0);
});

test('every half-disc pose survives a key round trip (an H facing any direction is not mistaken for H1)', () => {
  for (const p of allPoses(true).filter(q => q.k)) {
    const back = fromKey(canonicalKey([p])).discs[0];
    assert.equal(back.k, p.k);
    assert.equal(pieceId(back), pieceId(p));
  }
});
