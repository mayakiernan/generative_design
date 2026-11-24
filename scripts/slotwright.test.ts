import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inflateSync} from 'node:zlib';
import {encodePNG} from './slotwright/png.js';
import {createRecord} from './slotwright/record.js';
import {finalizeRecord, renderRecord, validateRecord} from './slotwright/run.js';

test('PNG encoder writes a valid header and the pixels back', () => {
  const rgb = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]);
  const png = encodePNG({width: 2, height: 2, rgb});
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 2);
  assert.equal(png.readUInt32BE(20), 2);
  const idat = png.indexOf('IDAT'), len = png.readUInt32BE(idat - 4), raw = inflateSync(png.subarray(idat + 4, idat + 4 + len));
  assert.deepEqual([...raw], [0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 9, 9, 9]);
});

test('a record validates, renders and finalizes in a child process; finalize needs the current source validated', async () => {
  const base = mkdtempSync(join(tmpdir(), 'slotwright-'));
  try {
    const rec = createRecord('make a car', {dir: base});
    const sdk = readFileSync(rec.buildPath, 'utf8').match(/from '([^']+)'/)![1];
    rec.writeBuild(`import {SlotBuild} from '${sdk}';
export const title = 'Test car';
export function createBuild() {
  const b = new SlotBuild();
  for (let x = 0; x <= 4; x++) b.disc([x, 0, 0]);
  for (const x of [0, 4]) { b.disc([x, 1, 0]); b.disc([x, 1, -1], {name: 'wheel-' + x + '-l'}); }
  b.mirror('y');
  console.log('built');
  return b;
}
export function runTests(model, t) { t.check('four wheels', model.group('wheel').length === 4, 'wrong count'); }
`);
    assert.equal((await finalizeRecord(rec)).ok, false);
    const v = await validateRecord(rec);
    assert.ok(v.ok, v.buildError ?? JSON.stringify(v.checks));
    assert.equal(v.stdout, 'built');
    assert.ok(v.checks.some(c => c.name === 'four wheels' && c.passed));
    const r = await renderRecord(rec);
    assert.ok(r.ok && r.path && readFileSync(r.path).subarray(1, 4).toString() === 'PNG');
    const f = await finalizeRecord(rec);
    assert.ok(f.ok, f.error);
    assert.match(readFileSync(join(rec.outDir, 'cut-sheet.svg'), 'utf8'), /<svg/);
    rec.writeBuild(rec.readBuild().replace("'Test car'", "'Changed'"));
    assert.match((await finalizeRecord(rec)).error ?? '', /changed since it last validated/);
    rec.writeBuild('export function createBuild() { throw new Error("boom"); }\n');
    const e = await validateRecord(rec);
    assert.equal(e.ok, false);
    assert.match(e.buildError ?? '', /boom/);
  } finally {
    rmSync(base, {recursive: true, force: true});
  }
});

test('the studio endpoint checks the password, origin and conversation before calling Claude', async () => {
  const {handleSlotwrightTurn} = await import('./slotwright/turn.js');
  const env = {password: 'pw', deployed: true, instructions: 'x'};
  const auth = {authorization: `Basic ${btoa('a:pw')}`};
  const call = (headers: Record<string, string>, body: object) => handleSlotwrightTurn(new Request('https://s.test/api/slotwright', {method: 'POST', headers: {host: 's.test', origin: 'https://s.test', 'content-type': 'application/json', ...headers}, body: JSON.stringify(body)}), env);
  const good = {prompt: 'a car', discMm: 228.6, circles: 24, messages: []};
  assert.equal((await call({}, good)).status, 401);
  assert.equal((await call({...auth, origin: 'https://evil.test'}, good)).status, 403);
  assert.equal((await call(auth, {...good, discMm: 100})).status, 400);
  assert.equal((await call(auth, {...good, messages: [{role: 'user', content: []}]})).status, 400);
  assert.equal((await call(auth, {...good, messages: Array.from({length: 120}, (_, i) => ({role: i % 2 ? 'user' : 'assistant', content: []}))})).status, 400);
  const noKey = await call(auth, good);
  assert.equal(noKey.status, 500);
  assert.match(await noKey.text(), /ANTHROPIC_API_KEY is not set/);
});
