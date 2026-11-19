// npm run hubs [-- banana chair --sticks 48]
// Writes out/hubs/<shape>/{design.json, report.txt, plate.stl, hub-NN.stl}.
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import Module from 'manifold-3d';
import {makeDesign} from '../src/hubs/pipeline';
import {buildHub, printPlate, toSTL} from '../src/hubs/hubmesh';
import {SHAPES} from '../src/hubs/shapes';
import type {StickDesign} from '../src/hubs/design';

const args = process.argv.slice(2);
const sticksAt = args.indexOf('--sticks');
const sticks = sticksAt >= 0 ? Number(args[sticksAt + 1]) : undefined;
const names = args.filter((a, i) => !a.startsWith('--') && i !== sticksAt + 1);
const shapes = names.length ? names : Object.keys(SHAPES);

export function reportText(d: StickDesign) {
  const r = d.report, f = (n: number) => n.toFixed(1);
  const lines = [
    `${d.name}: ${r.hubCount} hubs, ${r.stickCount} sticks (${d.params.stickLength} mm, bore ${d.params.boreDiameter} mm)`,
    `sticks: ${r.ok} uncut, ${r.cut} need trimming, ${r.long} too long for one stick`,
    `hub spacing ${f(r.spanRange[0])}–${f(r.spanRange[1])} mm; uncut band ${f(r.band[0])}–${f(r.band[1])} mm`,
    `connected: ${r.connected}; free-pin degrees of freedom: ${r.pinFreedom}${r.pinFreedom ? ' (relies on joint friction)' : ' (rigid)'}`,
    `hubs below the minimum stick angle: ${r.tooTightHubs.length ? r.tooTightHubs.join(', ') : 'none'}`,
    '', 'hub  sticks  min angle  max stop  diameter',
    ...d.hubs.map((h, i) => `${String(i).padStart(3)}  ${String(h.valence).padStart(6)}  ${f(h.minAngleDeg).padStart(8)}°  ${f(h.maxStop).padStart(6)} mm  ${f(h.diameter).padStart(6)} mm`),
    '', 'build order (stick: hub – hub, trim)',
    ...d.order.map((e, k) => { const s = d.sticks[e]; return `${String(k + 1).padStart(3)}. stick ${e}: ${s.hubs[0]} – ${s.hubs[1]}${s.status === 'cut' ? `, trim ${f(s.mm)} mm` : s.status === 'long' ? `, TOO LONG by ${f(s.mm)} mm` : ''}`; }),
  ];
  return lines.join('\n');
}

const wasm = await Module();
wasm.setup();
for (const name of shapes) {
  const make = SHAPES[name];
  if (!make) { console.error(`Unknown shape "${name}". Known: ${Object.keys(SHAPES).join(', ')}`); process.exitCode = 1; continue; }
  const d = makeDesign(make(), undefined, sticks);
  const dir = join('out', 'hubs', name);
  rmSync(dir, {recursive: true, force: true}); // stale hub files from a bigger run would linger
  mkdirSync(dir, {recursive: true});
  const hubs = d.holes.map(h => buildHub(wasm, h, d.params));
  hubs.forEach((h, i) => {
    if (h.status() !== 'NoError') throw Error(`hub ${i}: ${h.status()}`);
    writeFileSync(join(dir, `hub-${String(i).padStart(2, '0')}.stl`), toSTL(h.getMesh()));
  });
  const plate = printPlate(wasm, hubs);
  writeFileSync(join(dir, 'plate.stl'), toSTL(plate.getMesh()));
  writeFileSync(join(dir, 'design.json'), JSON.stringify(d, null, 1));
  const text = reportText(d);
  writeFileSync(join(dir, 'report.txt'), text);
  console.log(text.split('\n').slice(0, 5).join('\n'), `\n→ ${dir}\n`);
  [...hubs, plate].forEach(m => m.delete());
}
