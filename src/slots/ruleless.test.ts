import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rng} from './math.js';
import {makeKit, transformPose, type Pose} from './atlas/lattice.js';
import {gridSeeds} from './atlas/explore.js';
import {solveLP} from './ruleless/lp.js';
import {fineKit, freeKey, freePanels, fromFreeKey, fromLattice, pitchSteps} from './ruleless/free.js';
import {findContacts} from './ruleless/contacts.js';
import {holds, rigidStance} from './ruleless/statics.js';
import {judgeFree, FREE_FAIL} from './ruleless/judge.js';
import {clipPoses, mutate} from './ruleless/moves.js';
import {narrowSlits} from './ruleless/explore.js';
import {freeFingerprint} from './ruleless/structure.js';
import {piecesOverlap} from './ruleless/judge.js';

const kit = makeKit(80, 3, 0.2), fine = fineKit(kit);
const flat = (x: number, y: number, z: number): Pose => ({c: [x, y, z], a: 2, m: 1});

test('the simplex solver finds a known optimum and reports infeasibility', () => {
  const r = solveLP([1, 1, 0, 0], [[1, 2, 1, 0], [3, 1, 0, 1]], [4, 6]);
  assert.equal(r.status, 'optimal');
  assert.ok(Math.abs(r.value - 2.8) < 1e-9);
  assert.equal(solveLP([1, 1], [[1, 1]], [-1]).status, 'infeasible');
});

test('statics: a disc on the floor slides at μ; an overhang falls; a disc on its rim rolls', () => {
  const one = freePanels(fine, [flat(0, 0, 15)]);
  const st = rigidStance(one, findContacts(one));
  assert.ok(Math.abs(st.push - 0.4) < 1e-6, `slides at μ, got ${st.push}`);
  const ok = freePanels(fine, [flat(0, 0, 15), flat(300, 0, 45)]), over = freePanels(fine, [flat(0, 0, 15), flat(600, 0, 45)]);
  assert.ok(holds(ok, findContacts(ok)), 'a disc stacked 30 mm off centre holds');
  assert.ok(!holds(over, findContacts(over)), 'a disc stacked 60 mm off centre tips off');
  const rim = freePanels(fine, [{c: [0, 0, 400], a: 1, m: 1 << 4}]);
  assert.ok(rigidStance(rim, findContacts(rim)).push < 1e-6, 'a disc standing on its rim takes no push');
});

test('a lattice joint is a lap gripping a slit length each way; free forms keep lattice positions', () => {
  const P = pitchSteps(kit);
  assert.equal(P, 416);
  const form = [{c: [0, 0, 400], a: 1, m: 1 << 4}, {c: [0, 0, 400 + P], a: 0, m: 1 << 5}] as Pose[];
  const cs = findContacts(freePanels(fine, form)), lap = cs.find(c => c.kind === 'lap')!;
  assert.ok(lap, 'found a lap');
  assert.ok(Math.abs(lap.grip - 38.2) < 0.5, `grip ${lap.grip}`);
  // The upper piece rests on the lower along the slit line: a one-way push up on it.
  assert.ok(lap.pushes.some(p => !p.two && p.on === 1 && p.n[2] > 0.5));
  assert.deepEqual(fromFreeKey(freeKey(form)).length, 2);
});

test('a clip seats its slit bottom on a plain rim, 2R − ℓ − c/2 out, and grips a slit length', () => {
  const base: Pose[] = [{c: [0, 0, 400], a: 1, m: 1}];
  const ctx = {kit, fine, panels: freePanels(fine, base)};
  const [p] = clipPoses(kit, base, 0, 5, 0, ctx);
  assert.ok(Math.abs(p.c[2] * 0.1 - (40 + 80 - 19.2 - 0.1)) < 0.11, `centre at ${p.c[2] * 0.1} mm`);
  const c = findContacts(freePanels(fine, [...base, p])).find(x => x.b === 1)!;
  assert.equal(c.kind, 'clip');
  assert.ok(c.grip > 19 && c.grip < 19.5);
  // Off centre the chord is shorter, so the clip grips less.
  const [q] = clipPoses(kit, base, 0, 5, 38, ctx);
  const cq = findContacts(freePanels(fine, [...base, q])).find(x => x.b === 1)!;
  assert.ok(cq.grip < c.grip && cq.grip > kit.t);
});

test('random rule-free moves never make pieces run into each other', () => {
  const r = rng(7);
  let form: Pose[] = [{c: [0, 0, 400], a: 1, m: 1 | 2 | 16}];
  for (let i = 0; i < 30; i++) { const m = mutate(kit, form, r, 30); if (m) form = m.form; }
  const panels = freePanels(fine, form);
  for (let i = 0; i < form.length; i++) for (let j = i + 1; j < form.length; j++) assert.ok(!piecesOverlap(kit, form[i], form[j], panels[i], panels[j]), `pieces ${i} and ${j} overlap`);
});

test('a gallery egg crate judged by statics: one piece, laps only, nothing overlapping', () => {
  const grid = fromLattice(kit, gridSeeds(kit, 20, 1)[0]);
  const v = judgeFree(kit, grid);
  assert.equal(v.fails & (FREE_FAIL.overlap | FREE_FAIL.apart), 0);
  assert.equal(v.metrics.clips, 0);
  assert.ok(v.metrics.laps >= grid.length - 1);
});

test('press-fit slits are as deep and as centred as before, only narrower', () => {
  const n = narrowSlits(kit), a = kit.pieces.get('C1')!.cuts[0], b = n.pieces.get('C1')!.cuts[0];
  const width = (poly: [number, number][]) => Math.max(...poly.map(q => q[0])) - Math.min(...poly.map(q => q[0]));
  assert.ok(Math.abs(width(a) - 3.2) < 1e-9 && Math.abs(width(b) - 3.0) < 1e-9);
  assert.deepEqual(a.map(q => q[1]), b.map(q => q[1]));
});

test('structural fingerprints of free forms ignore turns and mirrors about the vertical', () => {
  const grid = fromLattice(kit, gridSeeds(kit, 20, 1)[0]);
  const fp = (f: Pose[]) => freeFingerprint(f, findContacts(freePanels(fine, f)));
  const a = fp(grid), b = fp(grid.map(p => transformPose(p, 5)));
  assert.ok(a.every((x, i) => Math.abs(x - b[i]) < 1e-6));
});
