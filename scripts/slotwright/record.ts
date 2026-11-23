// Slotwright records: one directory per build under slotwright-runs/ (never results/, which the comparison page
// bundles), holding the agent's build.mjs, metadata, every validated snapshot and render, and the finished outputs.
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {template} from '../../src/slotwright/template.js';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const RUNS_DIR = join(REPO, 'slotwright-runs');
const SDK = join(REPO, 'src/slotwright/sdk.ts');

export interface Meta {
  id: string;
  prompt: string;
  created: string;
  status: 'new' | 'valid' | 'invalid' | 'error';
  /** sha256 of the build.mjs that last validated, and whether it passed. */
  validatedSha?: string;
  validatedOk?: boolean;
  finalized?: boolean;
  from?: string;
  model?: string;
  turns?: number;
  costUsd?: number;
  usage?: {input: number; output: number; cacheRead: number; cacheWrite: number};
  stopReason?: string;
  seconds?: number;
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const slugOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'build';
const stamp = () => new Date().toISOString().slice(0, 19).replace(/:/g, '-');

export class SlotRecord {
  constructor(readonly dir: string) {}
  get id() { return this.dir.split('/').pop()!; }
  get buildPath() { return join(this.dir, 'build.mjs'); }
  get outDir() { return join(this.dir, 'out'); }
  readBuild() { return readFileSync(this.buildPath, 'utf8'); }
  writeBuild(src: string) { writeFileSync(this.buildPath, src); }
  get sourceSha() { return sha256(this.readBuild()); }
  meta(): Meta { return JSON.parse(readFileSync(join(this.dir, 'meta.json'), 'utf8')); }
  update(patch: Partial<Meta>) { writeFileSync(join(this.dir, 'meta.json'), JSON.stringify({...this.meta(), ...patch}, null, 2) + '\n'); }
  /** The next free number in a numbered folder (snapshots/, renders/). */
  private next(sub: string, ext: string) {
    const d = join(this.dir, sub);
    mkdirSync(d, {recursive: true});
    const n = readdirSync(d).filter(f => f.endsWith(ext)).length + 1;
    return join(d, `${String(n).padStart(3, '0')}${ext}`);
  }
  snapshot(source: string, report: object) {
    const p = this.next('snapshots', '.mjs');
    writeFileSync(p, source);
    writeFileSync(p.replace(/\.mjs$/, '.json'), JSON.stringify(report, null, 2) + '\n');
  }
  nextRender() { return this.next('renders', '.png'); }
  appendTranscript(entry: object) {
    mkdirSync(this.dir, {recursive: true});
    writeFileSync(join(this.dir, 'transcript.jsonl'), JSON.stringify(entry) + '\n', {flag: 'a'});
  }
}

/** The starting build.mjs, importing the SDK by a path relative to the record, so the record runs where it is. */
function recordTemplate(dir: string, prompt: string) {
  let rel = relative(dir, SDK);
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return template(prompt, rel);
}

export function createRecord(prompt: string, o: {from?: string; dir?: string} = {}): SlotRecord {
  const base = o.dir ?? RUNS_DIR;
  mkdirSync(base, {recursive: true});
  let dir = join(base, `${stamp()}-${slugOf(prompt)}`);
  for (let k = 2; existsSync(dir); k++) dir = join(base, `${stamp()}-${slugOf(prompt)}-${k}`);
  mkdirSync(dir, {recursive: true});
  // Node resolves a module's imports from its real path, so the SDK path is made relative to that.
  dir = realpathSync(dir);
  const meta: Meta = {id: dir.split('/').pop()!, prompt, created: new Date().toISOString(), status: 'new'};
  const r = new SlotRecord(dir);
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  if (o.from) {
    const src = findRecord(o.from);
    copyFileSync(src.buildPath, r.buildPath);
    r.update({from: src.id});
  } else r.writeBuild(recordTemplate(dir, prompt));
  return r;
}

/** A record by id (under slotwright-runs/) or path. */
export function findRecord(ref: string): SlotRecord {
  const candidates = [isAbsolute(ref) ? ref : resolve(ref), join(RUNS_DIR, ref)];
  for (const c of candidates) if (existsSync(join(c, 'meta.json'))) return new SlotRecord(c);
  throw new Error(`no Slotwright record "${ref}" (looked in ${RUNS_DIR})`);
}
