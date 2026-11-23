// npm run atlas [-- --no-notched --rank novel|useful|both --iterations 20000 --judge-to 5 --count-to 6 --height 120 --size 80 --sheet 3 --seed 1]
// Maps the table forms of the Circular slot kit (src/slots/atlas/) and writes atlas-runs/<stamp>/{atlas.json, summary.md}.
// Not under results/: the comparison page bundles every JSON file there.
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fromKey, makeKit} from '../src/slots/atlas/lattice';
import {defaultRules, FAIL, FAIL_NAMES, FAIL_TEXT, failList, type FailName} from '../src/slots/atlas/judge';
import {Atlas, defaultSearch, enumerate, explore, gridSeeds, isEggCrate, treeSeeds, type Entry, type Rank, type SearchOptions} from '../src/slots/atlas/explore';
import {CRATE_BUCKETS, crateBucket, motifLabels} from '../src/slots/atlas/structure';

const args = process.argv.slice(2);
const num = (flag: string, dflt: number) => { const i = args.indexOf(flag); return i >= 0 ? Number(args[i + 1]) : dflt; };
const size = num('--size', 80), sheet = num('--sheet', 3), seed = num('--seed', 1);
const iterations = num('--iterations', 20000), judgeTo = num('--judge-to', 5), countTo = Math.max(num('--count-to', 6), judgeTo);
const gridDraws = num('--grids', 3000), treeDraws = num('--trees', 400);
const rankAt = args.indexOf('--rank'), rank = (rankAt >= 0 ? args[rankAt + 1] : 'novel') as Rank;
if (!['novel', 'useful', 'both'].includes(rank)) throw new Error(`--rank must be novel, useful or both, not ${rank}`);
// Search switches (defaults follow the rank): --select uniform|novel-legal|novel-all, --graft 0|1, --motif 0|1, --tag name.
const opt = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const base = defaultSearch(rank), search0: SearchOptions = {
  select: (opt('--select') as SearchOptions['select']) ?? base.select,
  graft: opt('--graft') !== undefined ? opt('--graft') === '1' : base.graft,
  motif: opt('--motif') !== undefined ? opt('--motif') === '1' : base.motif,
};
const tag = opt('--tag');
const kit = makeKit(size, sheet, 0.2);
// --no-notched: the kit without its notched half disc (H); full discs and the one-slit half disc (H1) only.
if (args.includes('--no-notched')) kit.noNotched = true;
const rules = {...defaultRules(kit), height: num('--height', 1.5 * size)};
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const started = performance.now();
log(`rank: ${rank}; parents ${search0.select}, grafts ${search0.graft ? 'on' : 'off'}, rare motifs ${search0.motif ? 'on' : 'off'}. kit: ${size} mm discs, ${sheet} mm sheet, lattice pitch ${kit.p.toFixed(1)} mm. Table: surface ≥ ${rules.height} mm up, ≤ ${rules.maxDiscs} discs, tips past ${rules.minTip}°, braced, buildable, nothing loose, level surface`);

// 1. Search: seed with the gallery's own grids and trees, then MAP-Elites.
const atlas = new Atlas(kit, rules, rank);
const grids = gridSeeds(kit, gridDraws, seed);
// Distance from an egg crate is measured to these grids' fingerprints.
atlas.setCrates(grids);
for (const f of grids) atlas.add(f);
log(`seeded ${grids.length} distinct grids from ${gridDraws} draws of the gallery's grid generator`);
const trees = treeSeeds(kit, treeDraws, seed);
for (const f of trees) atlas.add(f);
log(`seeded ${trees.length} grown trees; ${atlas.evaluations} forms judged, ${atlas.cells.size} cells`);
explore(atlas, iterations, seed, i => {
  if (i && i % 2000 === 0) log(`  ${i}/${iterations} changes: ${atlas.evaluations} forms judged, ${atlas.cells.size} cells, ${[...atlas.cells.values()].filter(c => c.legal).length} with a legal table`);
}, search0);
const search = {evaluations: atlas.evaluations, seconds: atlas.ms / 1000};
log(`search done: ${atlas.evaluations} forms judged in ${search.seconds.toFixed(0)} s (${(atlas.ms / atlas.evaluations).toFixed(1)} ms each)`);
// Cells the search reached with a small form, before the exhaustive forms are added.
const searchSmall = new Set([...atlas.cells.entries()].filter(([, c]) => c.minDiscs <= judgeTo).map(([k]) => k));

// 2. Ground truth: every form of up to countTo discs is counted; up to judgeTo they are judged too.
interface Level {n: number; forms: number; findSeconds: number; judged: boolean; legal: number; byFails: Record<string, number>}
const levels: Level[] = [], enumCells = new Set<string>();
const enumResult = enumerate(kit, countTo, (n, keys, ms) => {
  const row: Level = {n, forms: keys.length, findSeconds: Math.round(ms / 100) / 10, judged: n <= judgeTo, legal: 0, byFails: {}};
  if (n <= judgeTo) for (const key of keys) {
    atlas.add(fromKey(key));
    const fails = atlas.seen.get(key)!, name = failList(fails).join('+') || 'legal';
    row.byFails[name] = (row.byFails[name] ?? 0) + 1;
    if (!fails) row.legal++;
    enumCells.add(atlas.info.get(key)!.cell);
  }
  levels.push(row);
  log(`n = ${n}: ${keys.length} forms (found in ${row.findSeconds} s)${row.judged ? `, judged: ${row.legal} legal` : ''}`);
});
const covered = [...enumCells].filter(c => searchSmall.has(c)).length;

// 3. What it found.
// A form counts as a grid when its joined structure is an egg-crate layout of any size (grids.ts), spare slits aside.
const crate = new Map<string, boolean>();
const isGrid = (key: string) => { let v = crate.get(key); if (v === undefined) { v = isEggCrate(kit, fromKey(key)); crate.set(key, v); } return v; };
atlas.refreshNovelty();
const compact = (e: Entry) => ({key: e.key, discs: e.metrics.discs, fails: e.fails, failing: failList(e.fails), grid: isGrid(e.key), novelty: e.novelty, crate: e.crate, features: e.features, metrics: e.metrics, steps: e.steps, top: e.top, ...(e.rest ? {rest: e.rest} : {})});
const cells = [...atlas.cells.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([cell, c]) => ({cell, seen: c.seen, minDiscs: c.minDiscs, legal: c.legal && compact(c.legal), near: c.near && compact(c.near)}));
const byFails = [...atlas.byFails.entries()].sort((a, b) => b[1] - a[1]).map(([fails, count]) => ({fails, failing: failList(fails), count, example: compact(atlas.exampleOf.get(fails)!)}));
const legalKeys = [...atlas.seen.entries()].filter(([, f]) => !f).map(([k]) => k);
const legalInfo = legalKeys.map(k => ({key: k, grid: isGrid(k), ...atlas.info.get(k)!}));
const newLegal = legalInfo.filter(x => !x.grid);
const structures = (xs: typeof legalInfo) => new Set(xs.map(x => x.skeleton)).size;
const range = (xs: number[]) => (xs.length ? `${Math.min(...xs)}–${Math.max(...xs)}` : 'none');
const legalCells = cells.filter(c => c.legal);

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19), dir = join('atlas-runs', `${stamp}-${tag ?? rank}`);
mkdirSync(dir, {recursive: true});
const params = {rank, search: search0, size, sheet, clearance: kit.clearance, pitch: kit.p, rules, iterations, seed, judgeTo, countTo, gridDraws, treeDraws};
writeFileSync(join(dir, 'atlas.json'), JSON.stringify({params, failBits: FAIL, levels, enumeration: enumResult, coverage: {cells: enumCells.size, reached: covered}, search: {...search, grids: grids.length, trees: trees.length}, cells, byFails}));

// 4. The summary.
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '–');
const fmt = (n: number) => n.toLocaleString('en-US');
const growth = levels.length > 2 ? levels[levels.length - 1].forms / levels[levels.length - 2].forms : NaN;
const singles = FAIL_NAMES.map(name => ({name, count: atlas.byFails.get(FAIL[name]) ?? 0, ex: atlas.exampleOf.get(FAIL[name])}));
const legalByLoops = new Map<string, {grid: number; other: number}>();
for (const c of legalCells) { const k = c.legal!.features.loops, r = legalByLoops.get(k) ?? {grid: 0, other: 0}; if (c.legal!.grid) r.grid++; else r.other++; legalByLoops.set(k, r); }
const smallest = legalInfo.length ? legalInfo.reduce((a, b) => (b.discs < a.discs ? b : a)) : null;
// Structure of the legal tables: how far from an egg crate, and how many distinct motifs they use.
const legalByCrate = new Map<string, Set<string>>();
for (const x of legalInfo) { const b = x.grid ? 'egg crate' : crateBucket(x.crate || 1e-3); (legalByCrate.get(b) ?? legalByCrate.set(b, new Set()).get(b)!).add(x.skeleton); }
const motifSet = new Set<string>();
for (const x of legalInfo) for (const round of motifLabels(fromKey(x.key)).slice(2)) for (const l of round) motifSet.add(l);
const legalElites = legalCells.map(c => c.legal!);
const mostNovel = [...legalElites].sort((a, b) => b.novelty - a.novelty).slice(0, 10);
const median = (xs: number[]) => { const s2 = [...xs].sort((a, b) => a - b); return s2.length ? s2[Math.floor(s2.length / 2)] : NaN; };
const halfUse = legalInfo.filter(x => fromKey(x.key).discs.some(p => p.k)).length;
const describe = (e: ReturnType<typeof compact>) => `${e.discs} pieces${e.metrics.mix.H || e.metrics.mix.H1 ? ` (${[e.metrics.mix.H ? `${e.metrics.mix.H} H` : '', e.metrics.mix.H1 ? `${e.metrics.mix.H1} H1` : ''].filter(Boolean).join(', ')})` : ''}, ${e.metrics.loops} loops, ${Math.round(e.metrics.height)} mm tall, plan ${e.features.footprint}, surface ${Math.round(e.metrics.surface / 100) / 100} dm²${e.grid ? ' (an egg crate)' : ''}`;
const lines = [
  `# Form atlas: Circular slot-kit tables`,
  '',
  `${new Date().toISOString().slice(0, 10)} · ${size} mm discs, ${sheet} mm sheet, lattice pitch ${kit.p.toFixed(1)} mm · seed ${seed} · ${fmt(atlas.evaluations)} forms judged in ${Math.round((performance.now() - started) / 1000)} s.`,
  '',
  `A **legal table** has a level surface on top (the top is cut to fit; at least three supports off a line), at least ${rules.height} mm up; stands as built and tips only past ${rules.minTip}°; no part can drop out; no slit joint can swing under its own weight or under weight on top; a group build sequence exists; at most ${rules.maxDiscs} pieces (the top not counted). Half discs are in: H1 sits on the lattice like a one-slit disc; an H sits with its notch line through a lattice point, and is never joined notch to notch with another H.`,
  '',
  '## How many forms there are',
  '',
  'Every connected, overlap-free arrangement of kit pieces (full and half discs), counted once however it is turned or mirrored about the vertical:',
  '',
  '| pieces | forms | legal tables |',
  '|---:|---:|---:|',
  ...levels.map(l => `| ${l.n} | ${fmt(l.forms)} | ${l.judged ? fmt(l.legal) : 'not judged'} |`),
  '',
  `Each disc multiplies the count by about ${growth.toFixed(0)}, so at 30 discs there are on the order of 10^${Math.round(Math.log10(levels[levels.length - 1].forms) + (30 - levels[levels.length - 1].n) * Math.log10(growth))} forms: they can only be sampled. The rest of this atlas is a map of that space by form, filled by search.`,
  '',
  '## Legal tables',
  '',
  `- ${fmt(legalKeys.length)} legal tables found: ${fmt(structures(legalInfo))} distinct structures (ignoring spare slits), ${fmt(structures(newLegal))} of them not an egg-crate grid layout of any size. They fill ${legalCells.length} of the ${atlas.cells.size} cells of the map.`,
  smallest ? `- Fewest pieces: ${smallest.discs}.` : '- None found.',
  `- Legal tables using half discs: ${fmt(halfUse)} of ${fmt(legalKeys.length)}.`,
  `- Loops of joints: legal egg crates ${range(legalInfo.filter(x => x.grid).map(x => x.loops))}; other legal tables ${range(newLegal.map(x => x.loops))}. A tree (0 loops) can pass only because the floor is modelled as no-slip (see Caveats).`,
  '',
  '| loops | cells with a legal egg crate | cells with another legal table |',
  '|---|---:|---:|',
  ...['0', '1', '2', '3', '4–6', '7–10', '11+'].filter(k => legalByLoops.has(k)).map(k => `| ${k} | ${legalByLoops.get(k)!.grid} | ${legalByLoops.get(k)!.other} |`),
  '',
  ...legalCells.filter(c => !c.legal!.grid).sort((a, b) => a.legal!.metrics.loops - b.legal!.metrics.loops).slice(0, 12).map(c => `- ${c.cell}: ${describe(c.legal!)}`),
  '',
  '## Structural novelty',
  '',
  `Ranked by **${rank}**${rank === 'useful' ? ' (each cell keeps the most usable top per disc)' : rank === 'novel' ? ' (each cell keeps the structure least like the legal tables seen)' : ' (novelty × usable top per disc)'}; parents ${search0.select === 'uniform' ? 'from a cell picked uniformly' : search0.select === 'novel-legal' ? 'seven times in ten the most novel of four legal tables, else from a uniform cell' : 'seven times in ten the most novel of four elites of any kind'}; grafts and prunes ${search0.graft ? 'on' : 'off'}; rare-motif discs ${search0.motif ? 'on' : 'off'}.`,
  '',
  `A structure's fingerprint counts its joint motifs (Weisfeiler–Lehman, two rounds); novelty is the mean fingerprint distance to the 15 most similar legal tables, distance from an egg crate the distance to the nearest gallery grid's fingerprint (two different grids are typically about 0.5 apart).`,
  '',
  '| distance from an egg crate | legal structures |',
  '|---|---:|',
  ...CRATE_BUCKETS.map(([, b]) => `| ${b} | ${fmt(legalByCrate.get(b)?.size ?? 0)} |`),
  '',
  `- Distinct two-step joint motifs across all legal tables: ${fmt(motifSet.size)}.`,
  `- Legal tables that are not egg crates: median distance from an egg crate ${median(newLegal.map(x => x.crate)).toFixed(2)}.`,
  '',
  'Most novel legal tables (one per cell):',
  '',
  ...mostNovel.map(e => `- novelty ${e.novelty.toFixed(2)}, ${e.grid ? 'an egg crate' : `${crateBucket(e.crate)} from an egg crate (${e.crate.toFixed(2)})`}: ${describe(e)}`),
  '',
  '## Near misses',
  '',
  'Forms that fail exactly one check:',
  '',
  '| only fails | forms | best example |',
  '|---|---:|---|',
  ...singles.filter(s => s.count).map(s => `| ${FAIL_TEXT[s.name as FailName]} | ${fmt(s.count)} | ${describe(compact(s.ex!))} |`),
  '',
  'Most common combinations of failures:',
  '',
  '| fails | forms |',
  '|---|---:|',
  ...byFails.slice(0, 12).map(b => `| ${b.failing.map(f => FAIL_TEXT[f]).join(' · ') || '**legal**'} | ${fmt(b.count)} |`),
  '',
  '## Search',
  '',
  `- Seeds: ${grids.length} distinct gallery grids (from ${gridDraws} draws) and ${trees.length} grown trees. Then ${fmt(iterations)} changes (add a disc, take one off, add or remove a slit${search0.graft ? ', graft a branch from another elite, prune a branch' : ''}).`,
  `- ${fmt(search.evaluations)} forms judged by the search in ${Math.round(search.seconds)} s (${(1000 * search.seconds / Math.max(1, search.evaluations)).toFixed(1)} ms each).`,
  `- Ground truth: of the ${enumCells.size} cells the forms of up to ${judgeTo} discs fall in, the search had reached ${covered} (${pct(covered, enumCells.size)}) with forms of up to ${judgeTo} discs before they were added.`,
  `- Build search budget reached on ${fmt([...atlas.cells.values()].flatMap(c => [c.legal, c.near]).filter(e => e?.buildExhausted).length)} elites ("no build sequence found" there means "not found in budget").`,
  '',
  '## Caveats',
  '',
  '- "No build sequence found" is not proof none exists: the search tries single discs, clusters beyond a level along an axis, and jointed pairs.',
  '- Bracing follows hinges.ts: slit joints are frictionless hinges, but floor contacts do not slip. Every legal table with 0 loops (a tree) passes only because of that no-slip floor; on a slick floor or under a side push it may fold. That is a finding of the model, and it disagrees with the README, which says a covered design must be a braced grid. Strength is not modelled, and the top only rests.',
  '- One piece per lattice point: two half discs back to back at one point (a full disc in two halves) are not considered.',
  '',
  `Files: atlas.json in this folder holds every cell's best legal table and closest near miss (canonical lattice key, build steps, top), and an example of every failure combination. \`atlasDesign\` in src/slots/atlas/view.ts rebuilds any of them as an engine design for the build scene.`,
];
writeFileSync(join(dir, 'summary.md'), lines.filter(l => l !== null).join('\n') + '\n');
log(`wrote ${join(dir, 'atlas.json')} and summary.md`);
