// Parent side of the worker: run validate / render / finalize on a record in a child process with a timeout, as
// BrickWright runs build.py, so a runaway or crashing build cannot take the agent loop down with it.
import {spawn} from 'node:child_process';
import {existsSync, readFileSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import type {FinalizeResult, Look, RenderResult, ValidationReport} from './ops.js';
import {REPO, sha256, type SlotRecord} from './record.js';

const WORKER = join(REPO, 'scripts/slotwright/worker.ts');
const MAX_OUTPUT = 4000;
const cap = (s: string) => (s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n…[truncated]` : s);

async function inWorker<T>(cmd: string, rec: SlotRecord, args: object, timeoutMs: number): Promise<{result: T | null; stdout: string; error?: string}> {
  const resultPath = join(rec.dir, `.result-${process.pid}-${Date.now()}.json`);
  const child = spawn(process.execPath, ['--import', 'tsx', WORKER, cmd, rec.dir, JSON.stringify(args), resultPath], {cwd: REPO, stdio: ['ignore', 'pipe', 'pipe']});
  let stdout = '', stderr = '';
  child.stdout.on('data', d => { stdout += d; });
  child.stderr.on('data', d => { stderr += d; });
  const timedOut = await new Promise<boolean>(done => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); done(true); }, timeoutMs);
    child.on('close', () => { clearTimeout(timer); done(false); });
  });
  let result: T | null = null;
  if (existsSync(resultPath)) { result = JSON.parse(readFileSync(resultPath, 'utf8')); unlinkSync(resultPath); }
  const error = timedOut ? `timed out after ${timeoutMs / 1000} s` : result ? undefined : `the worker exited without a result${stderr ? `:\n${cap(stderr.trim())}` : ''}`;
  return {result, stdout: cap(stdout.trim()), error};
}

export async function validateRecord(rec: SlotRecord, timeoutMs = 120_000): Promise<ValidationReport & {stdout?: string}> {
  const {result, stdout, error} = await inWorker<ValidationReport>('validate', rec, {}, timeoutMs);
  const report: ValidationReport = result ?? {ok: false, sourceSha: sha256(rec.readBuild()), buildError: error, problems: [], checks: []};
  if (!result) rec.update({status: 'error', validatedSha: report.sourceSha, validatedOk: false});
  return stdout ? {...report, stdout} : report;
}

export async function renderRecord(rec: SlotRecord, o: {azimuth?: number; elevation?: number; look?: Look; out?: string} = {}, timeoutMs = 120_000): Promise<RenderResult> {
  const {result, error} = await inWorker<RenderResult>('render', rec, o, timeoutMs);
  return result ?? {ok: false, error, views: ''};
}

export async function finalizeRecord(rec: SlotRecord, timeoutMs = 180_000): Promise<FinalizeResult> {
  const {result, error} = await inWorker<FinalizeResult>('finalize', rec, {}, timeoutMs);
  return result ?? {ok: false, error};
}
