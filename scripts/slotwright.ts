// Slotwright: say "make a car" and get a slot-kit design for it, cut sheet included. After BrickWright
// (github.com/AvaLovelace1/brickwright), with the Circular slot kit in place of LEGO parts.
//
//   npm run slotwright -- "make a car"                  Claude designs it (needs ANTHROPIC_API_KEY, e.g. .env.local)
//   npm run slotwright -- generate "make a car" [--effort high] [--max-turns 80] [--max-cost 8] [--model id]
//
// External-agent mode (an agent such as Claude Code edits build.mjs itself and drives these):
//   npm run slotwright -- instructions                  the kit, the SDK and the rules
//   npm run slotwright -- init "make a car" [--from <record>]
//   npm run slotwright -- validate <record> [--json]    exit 0 only when every check passes
//   npm run slotwright -- render <record> [--azimuth A --elevation E] [--plain]
//   npm run slotwright -- finalize <record>
import {readFileSync} from 'node:fs';
import {join, relative} from 'node:path';
import {runAgent, type AgentOptions} from './slotwright/agent.js';
import {reportText} from './slotwright/ops.js';
import {createRecord, findRecord, REPO} from './slotwright/record.js';
import {finalizeRecord, renderRecord, validateRecord} from './slotwright/run.js';

const EXTERNAL = `
## Working from the command line

Edit only the build.mjs that init printed; everything else in the record is written by the tools.

    npm run slotwright -- init "<request>"              creates a record and prints its build.mjs
    npm run slotwright -- validate <record>             checks it; exit 0 only when ok
    npm run slotwright -- render <record>               writes a contact sheet PNG and prints its path; open it
    npm run slotwright -- render <record> --azimuth 30 --elevation 20 [--plain]
    npm run slotwright -- finalize <record>             after validate is ok: renders, cut sheet, assembly guide

Validate after each change and read every failure; render and look at the image before finishing.`;

const rel = (p: string) => relative(process.cwd(), p) || '.';

function flags(args: string[]) {
  const out: Record<string, string | boolean> = {}, rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2), next = args[i + 1];
      if (next !== undefined && !next.startsWith('--') && !['json', 'plain'].includes(key)) { out[key] = next; i++; } else out[key] = true;
    } else rest.push(a);
  }
  return {flags: out, rest};
}

async function main() {
  const [first, ...more] = process.argv.slice(2);
  const commands = ['generate', 'init', 'validate', 'render', 'finalize', 'instructions'];
  const cmd = commands.includes(first) ? first : 'generate';
  const {flags: f, rest} = flags(cmd === first ? more : process.argv.slice(2));
  const num = (k: string) => (typeof f[k] === 'string' ? Number(f[k]) : undefined);

  if (cmd === 'instructions') { process.stdout.write(readFileSync(join(REPO, 'src/slotwright/INSTRUCTIONS.md'), 'utf8') + EXTERNAL + '\n'); return; }
  if (cmd === 'init') {
    if (!rest.length) throw new Error('usage: init "<request>" [--from <record>]');
    const rec = createRecord(rest.join(' '), {from: typeof f.from === 'string' ? f.from : undefined});
    console.log(`record_id=${rec.id}\nbuild_path=${rel(rec.buildPath)}`);
    return;
  }
  if (cmd === 'validate') {
    const rec = findRecord(rest[0] ?? '');
    const r = await validateRecord(rec);
    console.log(f.json ? JSON.stringify(r, null, 2) : reportText(r));
    process.exitCode = r.ok ? 0 : 1;
    return;
  }
  if (cmd === 'render') {
    const rec = findRecord(rest[0] ?? '');
    const r = await renderRecord(rec, {azimuth: num('azimuth'), elevation: num('elevation'), look: f.plain ? 'plain' : 'pieces', out: join(rec.outDir, num('azimuth') !== undefined ? 'viewpoint.png' : 'build.png')});
    if (!r.ok) { console.error(`render failed:\n${r.error}`); process.exitCode = 1; return; }
    console.log(`${rel(r.path!)}\n${r.views}`);
    return;
  }
  if (cmd === 'finalize') {
    const rec = findRecord(rest[0] ?? '');
    const r = await finalizeRecord(rec);
    if (!r.ok) { console.error(`finalize refused: ${r.error}`); process.exitCode = 1; return; }
    console.log(r.files!.map(rel).join('\n'));
    return;
  }
  // generate
  const prompt = rest.join(' ').trim();
  if (!prompt) throw new Error('usage: npm run slotwright -- "make a car"');
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) console.warn('No ANTHROPIC_API_KEY in the environment (or .env.local); the SDK will try other credentials.');
  const rec = createRecord(prompt);
  console.log(`Slotwright: "${prompt}"\nrecord ${rel(rec.dir)}\n`);
  const o: AgentOptions = {model: typeof f.model === 'string' ? f.model : undefined, effort: typeof f.effort === 'string' ? (f.effort as AgentOptions['effort']) : undefined, maxTurns: num('max-turns'), maxCostUsd: num('max-cost'), maxMinutes: num('max-minutes')};
  const report = await runAgent(rec, o);
  console.log(`\n${report.finalized ? 'Done' : `Stopped (${report.stopReason})`}: ${report.turns} turns, ${report.validations} validations, ${report.renders} renders, $${report.costUsd.toFixed(2)}, ${report.seconds} s.`);
  if (report.summary) console.log(report.summary);
  if (report.files.length) console.log(report.files.map(rel).join('\n'));
  else {
    const meta = rec.meta();
    if (meta.validatedOk && meta.validatedSha) {
      const r = await finalizeRecord(rec);
      if (r.ok) console.log(`The last build passed, so it was finalized anyway:\n${r.files!.map(rel).join('\n')}`);
    }
    process.exitCode = 1;
  }
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
