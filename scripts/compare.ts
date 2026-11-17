// Run one design brief against several Claude models and record what each one builds.
//
//   npm run compare -- briefs/bridge-6in.json
//   npm run compare -- briefs/bridge-6in.json --models sonnet,opus --repairs 0 --runs 3
//   npm run compare -- --prompt "Make me a chair" --max-connectors 20 --freestanding
//   npm run compare -- briefs/bridge-6in.json --dry-run
//
// Credentials come from ANTHROPIC_API_KEY (exported in your shell, or in a gitignored .env.local).
// Results are written to results/<brief id>/<timestamp>.json and shown on the comparison page (/compare/).
// The same runs can be started from that page while `npm run dev` is running.
import {readFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {MODELS,costUsd,systemPrompt,type Brief,type ModelResult} from '../src/engine/compare.js';
import {EFFORTS,outputFormat,runComparison,slug,type Effort} from './runner.js';

const {values:args,positionals}=parseArgs({allowPositionals:true,options:{
 models:{type:'string',default:MODELS.map(m=>m.key).join(',')},
 effort:{type:'string',default:'high'},
 repairs:{type:'string',default:'2'},
 runs:{type:'string',default:'1'},
 'max-tokens':{type:'string',default:'64000'},
 'dry-run':{type:'boolean',default:false},
 prompt:{type:'string'},
 id:{type:'string'},
 'max-connectors':{type:'string'},
 'max-rods':{type:'string'},
 'gap-in':{type:'string'},
 'gap-mm':{type:'string'},
 freestanding:{type:'boolean',default:false},
 help:{type:'boolean',short:'h',default:false},
}});

function usage(message?:string):never{
 if(message)console.error(`\n${message}`);
 console.error(`
Usage: npm run compare -- <brief.json> [options]
       npm run compare -- --prompt "<brief text>" [constraint options] [options]

Options
  --models sonnet,opus,fable   Which models to run (default: all three)
  --effort high                low | medium | high | xhigh | max, same for every model (default: high)
  --repairs 2                  Follow-up turns that feed checker problems back (default: 2)
  --runs 1                     Repeat the whole comparison N times
  --max-tokens 64000           Output cap per turn
  --dry-run                    Print the prompts and a cost estimate; call nothing

Constraint options (with --prompt)
  --max-connectors N  --max-rods N  --gap-in N | --gap-mm N  --freestanding  --id name
`);
 process.exit(message?1:0);
}
if(args.help)usage();

function loadBrief():Brief{
 if(positionals[0]){
  const brief=JSON.parse(readFileSync(positionals[0],'utf8')) as Partial<Brief>;
  if(!brief.id||!brief.prompt)usage(`${positionals[0]} needs at least "id" and "prompt".`);
  return {id:brief.id,prompt:brief.prompt,title:brief.title??brief.prompt,constraints:brief.constraints??{}};
 }
 if(!args.prompt)usage('Give a brief file or --prompt.');
 const num=(v?:string)=>v===undefined?undefined:Number(v);
 const gapMm=args['gap-mm']!==undefined?num(args['gap-mm']):args['gap-in']!==undefined?Math.round(num(args['gap-in'])!*25.4*1000)/1000:undefined;
 return {id:args.id??slug(args.prompt),title:args.prompt,prompt:args.prompt,constraints:{maxConnectors:num(args['max-connectors']),maxRods:num(args['max-rods']),gapMm,freestanding:args.freestanding||undefined}};
}

const brief=loadBrief();
const effort=args.effort as Effort;
if(!EFFORTS.includes(effort))usage(`--effort must be one of ${EFFORTS.join(', ')}.`);
const repairs=Math.max(0,Math.floor(Number(args.repairs))),runs=Math.max(1,Math.floor(Number(args.runs))),maxTokens=Math.floor(Number(args['max-tokens']));
const models=args.models.split(',').map(k=>MODELS.find(m=>m.key===k.trim())??usage(`Unknown model "${k}". Choose from ${MODELS.map(m=>m.key).join(', ')}.`));

console.log(`\nBrief: ${brief.prompt}`);
console.log(`Checks: ${JSON.stringify(brief.constraints)}`);
console.log(`Models: ${models.map(m=>`${m.label} (${m.id})`).join(', ')}`);
console.log(`Effort ${effort}, up to ${repairs} repair turn${repairs===1?'':'s'}, ${runs} run${runs===1?'':'s'}, max ${maxTokens} output tokens per turn.`);

if(args['dry-run']){
 const system=systemPrompt();
 console.log(`\n--- system prompt ---\n${system}\n\n--- user message ---\n${brief.prompt}\n`);
 // Rough: ~3.5 characters per token for input; output (mostly thinking) varies widely by model and effort.
 const input=Math.ceil((system.length+brief.prompt.length+JSON.stringify(outputFormat.schema).length)/3.5);
 console.log(`Rough cost per model per run (input ~${input} tokens/turn, 5k-30k output tokens/turn, 1-${repairs+1} turns):`);
 for(const m of models)console.log(`  ${m.label.padEnd(11)} $${costUsd(m,{input,output:5000}).toFixed(2)} - $${costUsd(m,{input:input*(repairs+1)*2,output:30000*(repairs+1)}).toFixed(2)}`);
 process.exit(0);
}

function table(results:ModelResult[]){
 const rows=[['Model','Result','1st try','Connectors','Rods','Clear span','Stable','Turns','Time','Cost'],...results.map(r=>{const e=r.evaluation;return [
  r.label,r.status.toUpperCase(),r.status==='pass'||r.status==='fail'?(r.firstTryPass?'yes':'no'):'-',
  e?`${e.connectors}${brief.constraints.maxConnectors!==undefined?`/${brief.constraints.maxConnectors}`:''}`:'-',e?String(e.rods):'-',
  e?.span?`${e.span.clearMm.toFixed(1)} mm`:'-',e?(e.stable?'yes':'no'):'-',String(r.attempts.length),`${(r.ms/1000).toFixed(0)}s`,`$${r.costUsd.toFixed(2)}`];})];
 const widths=rows[0].map((_,i)=>Math.max(...rows.map(r=>r[i].length)));
 return rows.map(r=>r.map((c,i)=>c.padEnd(widths[i])).join('  ')).join('\n');
}

for(let run=1;run<=runs;run++){
 if(runs>1)console.log(`\n=== Run ${run} of ${runs} ===`);
 const {file,path}=await runComparison({brief,models,effort,repairs,maxTokens,log:line=>console.log(line)});
 if(!path){
  console.error(`\nNo model could be reached, so nothing was saved.\n${[...new Set(file.results.map(r=>r.error))].join('\n')}`);
  process.exit(1);
 }
 console.log(`\n${table(file.results)}\n`);
 for(const r of file.results){
  if(r.servedBy&&r.servedBy!==r.model)console.log(`Note: ${r.label} was answered by ${r.servedBy}.`);
  if(r.error)console.log(`${r.label}: ${r.error}`);
 }
 console.log(`Total cost about $${file.results.reduce((s,r)=>s+r.costUsd,0).toFixed(2)}. Saved ${path}`);
}
