// Child-process entry: runs one operation on a record's build.mjs and writes the result as JSON to a file, so the
// build's own console output (stdout) stays separate. node --import tsx worker.ts <cmd> <record> <args> <result>
import {writeFileSync} from 'node:fs';
import {finalize, render, validate} from './ops.js';
import {findRecord} from './record.js';

const [cmd, ref, argsJson, resultPath] = process.argv.slice(2);
const rec = findRecord(ref), args = JSON.parse(argsJson || '{}');
const result = cmd === 'validate' ? await validate(rec) : cmd === 'render' ? await render(rec, args) : cmd === 'finalize' ? await finalize(rec) : {ok: false, error: `unknown command ${cmd}`};
writeFileSync(resultPath, JSON.stringify(result));
process.exit(0);
