// npm run atlas:free [-- --iterations 3000 --seed 1 --tag free --from atlas-runs/<lattice run> --seeds <max>]
// The rule-free form atlas (src/slots/ruleless/): kit pieces placed where the pieces allow, judged by statics.
// Seeds from a lattice atlas run's legal tables, searches for novel structures, triages every legal table, and
// writes atlas-runs/<stamp>-<tag>/{free-atlas.json, summary.md} (not atlas.json, which the lattice tab reads).
import {mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {fromKey, makeKit} from '../src/slots/atlas/lattice';
import {defaultRules} from '../src/slots/atlas/judge';
import {fromLattice} from '../src/slots/ruleless/free';
import {FREE_FAIL_TEXT, freeFailList, type FreeFailName} from '../src/slots/ruleless/judge';
import {BREAKS, exploreFree, FreeAtlas, KIT_DIST, kitBucket, triage, type FreeEntry} from '../src/slots/ruleless/explore';
import {STATICS_DEFAULTS} from '../src/slots/ruleless/statics';
import {Feasible} from '../src/slots/ruleless/lp';

const args = process.argv.slice(2);
const opt = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const num = (flag: string, d: number) => Number(opt(flag) ?? d);
const iterations = num('--iterations', 3000), seed = num('--seed', 1), tag = opt('--tag') ?? 'free';
const runs = readdirSync('atlas-runs').filter(d => existsSync(join('atlas-runs', d, 'atlas.json'))).sort();
const from = opt('--from') ?? join('atlas-runs', runs[runs.length - 1]);
const lattice = JSON.parse(readFileSync(join(from, 'atlas.json'), 'utf8'));
const kit = makeKit(lattice.params.size ?? 80, lattice.params.sheet ?? 3, 0.2), rules = defaultRules(kit);
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const started = performance.now();

// 1. Seeds: the lattice atlas's legal tables, judged again by statics. They are also the rule-bound tables that
// novelty and "distance from a kit table" are measured from.
const atlas = new FreeAtlas(kit, rules);
const kitLegal: {key: string}[] = lattice.cells.map((c: {legal?: {key: string}}) => c.legal).filter(Boolean).slice(0, num('--seeds', Infinity));
const seedVerdicts = new Map<string, number>();
for (const e of kitLegal) {
  const got = atlas.add(fromLattice(kit, fromKey(e.key)), 'seed', true);
  if (!got) continue;
  const k = freeFailList(got.fails).join('+') || 'legal';
  seedVerdicts.set(k, (seedVerdicts.get(k) ?? 0) + 1);
}
const seedsLegal = seedVerdicts.get('legal') ?? 0;
log(`seeded ${kitLegal.length} of the lattice atlas's legal tables (${from}); ${seedsLegal} pass the statics judge`);

// 2. Search.
exploreFree(atlas, iterations, seed, i => {
  if (i && i % 500 === 0) log(`  ${i}/${iterations}: ${atlas.evaluations} judged, ${atlas.cells.size} cells, ${atlas.elites().filter(e => !e.fails).length} legal elites`);
});
log(`search done: ${atlas.evaluations} forms judged in ${(atlas.ms / 1000).toFixed(0)} s (${(atlas.ms / atlas.evaluations).toFixed(0)} ms each)`);

// 3. Triage every legal elite.
const legal = atlas.elites().filter(e => !e.fails);
for (const e of legal) e.triage = triage(kit, rules, e);
log(`triaged ${legal.length} legal tables`);

// 4. Write.
const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-'), dir = join('atlas-runs', `${stamp}-${tag}`);
mkdirSync(dir, {recursive: true});
const cells = [...atlas.cells.entries()].map(([cell, c]) => ({cell, seen: c.seen, minPieces: c.minPieces, legal: c.legal, near: c.near}));
const byFails = [...atlas.byFails.entries()].sort((a, b) => b[1] - a[1]).map(([fails, count]) => ({fails, failing: freeFailList(fails), count, example: atlas.exampleOf.get(fails)}));
const moves = Object.fromEntries(atlas.moves);
const out = {
  params: {mode: 'free', size: kit.size, sheet: kit.t, clearance: kit.clearance, pitch: kit.p, rules, iterations, seed, statics: STATICS_DEFAULTS, from},
  seeding: {kitLegal: kitLegal.length, verdicts: Object.fromEntries(seedVerdicts)},
  search: {evaluations: atlas.evaluations, seconds: atlas.ms / 1000, moves, numericalTroubles: Feasible.troubles},
  cells, byFails,
};
writeFileSync(join(dir, 'free-atlas.json'), JSON.stringify(out));

const fmt = (n: number) => n.toLocaleString('en-US');
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '–');
const lines: string[] = [];
lines.push(`# Rule-free form atlas: ${stamp}`, '');
lines.push(`Circular kit, ${kit.size} mm pieces, ${kit.t} mm sheet. A table: a level surface at least ${rules.height} mm up, at most ${rules.maxDiscs} pieces, standing on its own (statics: friction ${STATICS_DEFAULTS.mu} between pieces and on the floor), buildable. The kit's joining rules are not applied: pieces may clip a slit onto a plain edge, rest on each other, or meet off the pitch.`, '');
lines.push(`## The lattice atlas's tables, judged by statics`, '');
lines.push(`${fmt(seedsLegal)} of the ${fmt(kitLegal.length)} legal tables stored in ${from} still pass. The rest:`, '');
for (const [k, v] of [...seedVerdicts.entries()].sort((a, b) => b[1] - a[1])) if (k !== 'legal') lines.push(`- ${fmt(v)}: ${k.split('+').map(x => FREE_FAIL_TEXT[x as FreeFailName]).join(', ')}`);
lines.push('', `The lattice judge took the floor as non-slip and pinned every floor contact, so an upright disc standing on its rim could neither roll nor lift there. Statics lets a rim roll and a foot slide or lift: legs that can roll, joined by slit joints that are hinges, let a frame rack sideways or sag. Nearly all the tables it rejects pass again with the floor pinned.`, '');
const all = atlas.elites();
lines.push(`## Search`, '');
lines.push(`${fmt(iterations)} changes from the seeds; ${fmt(atlas.evaluations)} forms judged (${(atlas.ms / atlas.evaluations).toFixed(0)} ms each); ${fmt(atlas.cells.size)} map cells, ${fmt(legal.length)} with a legal table.`, '');
lines.push('| move | forms judged | legal |', '|---|---:|---:|');
for (const [k, v] of atlas.moves) lines.push(`| ${k} | ${fmt(v.tried)} | ${fmt(v.legal)} (${pct(v.legal, v.tried)}) |`);
lines.push('', `## Legal tables (one per map cell)`, '');
lines.push('| rules broken | legal tables | robust | needs friction | needs slack | half on half |', '|---|---:|---:|---:|---:|---:|');
for (const b of BREAKS) {
  const xs = legal.filter(e => e.features.breaks === b), t = (l: string) => xs.filter(e => e.triage?.label === l).length;
  lines.push(`| ${b} | ${xs.length} | ${t('robust')} | ${t('needs friction')} | ${t('needs slack')} | ${t('half on half')} |`);
}
lines.push('', `Robust: still legal with friction ${0.3} and with slits cut to the sheet thickness. Needs friction: fails at 0.3. Needs slack: runs into something with no slit clearance. Half on half: joins two notched half discs notch to notch, which the kit rules out as too shallow to hold.`, '');
lines.push(`### How far from a kit table`, '', '| structure | legal tables |', '|---|---:|');
for (const [, name] of KIT_DIST) lines.push(`| ${name} | ${legal.filter(e => kitBucket(e.kitDist) === name).length} |`);
const show = (e: FreeEntry) => `${e.metrics.pieces} pieces (${e.metrics.laps} laps, ${e.metrics.clips} clips, ${e.metrics.rests} rests), ${Math.round(e.metrics.height)} mm, surface ${Math.round(e.metrics.surface / 100)} cm², tips at ${e.metrics.stanceDeg.toFixed(0)}°, ${e.triage?.label ?? ''}, distance from a kit table ${e.kitDist.toFixed(2)}`;
lines.push('', `### Most novel legal tables`, '');
for (const e of [...legal].sort((a, b) => b.novelty - a.novelty).slice(0, 8)) lines.push(`- ${show(e)}`);
lines.push('', `### Robust tables that break a rule, farthest from a kit table`, '');
for (const e of legal.filter(e => e.triage?.label === 'robust' && e.features.breaks !== 'kit joints').sort((a, b) => b.kitDist - a.kitDist).slice(0, 8)) lines.push(`- ${show(e)}`);
lines.push('', `## Near misses`, '', '| fails | forms |', '|---|---:|');
for (const f of byFails.slice(0, 12)) lines.push(`| ${f.failing.join(' + ') || 'legal'} | ${fmt(f.count)} |`);
lines.push('', `## Caveats`, '');
lines.push(`- Statics shows that some set of contact forces balances; with joints that have clearance the real forces may not find it. Triage re-judges at lower friction and a tight fit; the robust ones are the ones worth cutting.`);
lines.push(`- Slit walls carry no friction (a slit with clearance does not clamp), so a joint pulled along its slit comes apart. Real cardboard and plywood grip more.`);
lines.push(`- Planes stay square to the axes; leaning and off-square joints are not tried. Rim-on-rim contacts are counted only where the pieces cross square.`);
lines.push(`- The build search is sound, not complete, as in the lattice atlas.`);
lines.push(`- Numerical breakdowns of the solver: ${Feasible.troubles} (each counted as "does not hold").`);
lines.push('', `${all.length} elites written; ${((performance.now() - started) / 1000 / 60).toFixed(1)} min in all.`);
writeFileSync(join(dir, 'summary.md'), lines.join('\n'));
log(`wrote ${dir}`);
