// Run one design brief against several Claude models and record what each one builds.
//
//   npm run compare -- briefs/bridge-6in.json
//   npm run compare -- briefs/bridge-6in.json --models sonnet,opus --repairs 0 --runs 3
//   npm run compare -- --prompt "Make me a chair" --max-connectors 20 --freestanding
//   npm run compare -- briefs/bridge-6in.json --dry-run
//
// Credentials come from ANTHROPIC_API_KEY (exported in your shell, or in a gitignored .env.local).
// Results are written to results/<brief id>/<timestamp>.json and shown in the app's Model comparison section.
import Anthropic from '@anthropic-ai/sdk';
import {zodOutputFormat} from '@anthropic-ai/sdk/helpers/zod';
import {z} from 'zod';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {MODELS,costUsd,evaluate,feedback,systemPrompt,type Attempt,type Brief,type ModelDesign,type ModelResult,type ModelSpec,type RunFile,type Usage} from '../src/engine/compare.ts';

const Design=z.object({
 name:z.string(),
 rationale:z.string(),
 connectors:z.array(z.object({id:z.number().int(),x:z.number().int(),y:z.number().int(),z:z.number().int()})),
 rods:z.array(z.object({from:z.number().int(),to:z.number().int()})),
});
// The API constrains output to this schema; we parse it ourselves so a failed parse still keeps the response.
const {parse:parseDesign,...outputFormat}=zodOutputFormat(Design);
const EFFORTS=['low','medium','high','xhigh','max'] as const;
type Effort=typeof EFFORTS[number];

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
 const id=args.id??args.prompt.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40);
 return {id,title:args.prompt,prompt:args.prompt,constraints:{maxConnectors:num(args['max-connectors']),maxRods:num(args['max-rods']),gapMm,freestanding:args.freestanding||undefined}};
}

const brief=loadBrief();
const effort=args.effort as Effort;
if(!EFFORTS.includes(effort))usage(`--effort must be one of ${EFFORTS.join(', ')}.`);
const repairs=Math.max(0,Math.floor(Number(args.repairs))),runs=Math.max(1,Math.floor(Number(args.runs))),maxTokens=Math.floor(Number(args['max-tokens']));
const models=args.models.split(',').map(k=>MODELS.find(m=>m.key===k.trim())??usage(`Unknown model "${k}". Choose from ${MODELS.map(m=>m.key).join(', ')}.`));
const system=systemPrompt();

console.log(`\nBrief: ${brief.prompt}`);
console.log(`Checks: ${JSON.stringify(brief.constraints)}`);
console.log(`Models: ${models.map(m=>`${m.label} (${m.id})`).join(', ')}`);
console.log(`Effort ${effort}, up to ${repairs} repair turn${repairs===1?'':'s'}, ${runs} run${runs===1?'':'s'}, max ${maxTokens} output tokens per turn.`);

if(args['dry-run']){
 console.log(`\n--- system prompt ---\n${system}\n\n--- user message ---\n${brief.prompt}\n`);
 // Rough: ~3.5 characters per token for input; output (mostly thinking) varies widely by model and effort.
 const input=Math.ceil((system.length+brief.prompt.length+JSON.stringify(outputFormat.schema).length)/3.5);
 console.log(`Rough cost per model per run (input ~${input} tokens/turn, 5k-30k output tokens/turn, 1-${repairs+1} turns):`);
 for(const m of models)console.log(`  ${m.label.padEnd(11)} $${costUsd(m,{input,output:5000}).toFixed(2)} - $${costUsd(m,{input:input*(repairs+1)*2,output:30000*(repairs+1)}).toFixed(2)}`);
 process.exit(0);
}

const client=new Anthropic({timeout:30*60*1000,maxRetries:2});

function describeError(error:unknown):string{
 if(error instanceof Anthropic.AuthenticationError)return 'Authentication failed. Check ANTHROPIC_API_KEY.';
 if(error instanceof Anthropic.PermissionDeniedError)return `Permission denied: ${error.message}`;
 if(error instanceof Anthropic.NotFoundError)return `Model not available to this key: ${error.message}`;
 if(error instanceof Anthropic.RateLimitError)return `Rate limited: ${error.message}`;
 if(error instanceof Anthropic.BadRequestError)return `Request rejected: ${error.message}`;
 if(error instanceof Anthropic.APIError)return `API error ${error.status}: ${error.message}`;
 const message=error instanceof Error?error.message:String(error);
 if(message.includes('Could not resolve authentication method'))return 'No API key found. Put ANTHROPIC_API_KEY=... in .env.local, or export it in this shell.';
 return message;
}

const clock=(t0:number)=>`${((Date.now()-t0)/1000).toFixed(0)}s`;

async function runModel(m:ModelSpec,t0:number):Promise<ModelResult>{
 const messages:Anthropic.MessageParam[]=[{role:'user',content:brief.prompt}];
 const attempts:Attempt[]=[],total:Usage={input:0,output:0,thinking:0};
 const result:ModelResult={key:m.key,label:m.label,model:m.id,servedBy:null,status:'error',attempts,final:null,evaluation:null,firstTryPass:false,usage:total,costUsd:0,ms:0};
 const started=Date.now();
 try{
  for(let turn=0;turn<=repairs;turn++){
   const turnStart=Date.now();
   console.log(`[${clock(t0)}] ${m.label}: turn ${turn+1} started`);
   // No server-side fallbacks: a refusal answered by another model would be credited to this one.
   const message=await client.messages.stream({
    model:m.id,max_tokens:maxTokens,system,messages,
    thinking:{type:'adaptive'},
    output_config:{effort,format:outputFormat},
   }).finalMessage();
   result.servedBy=message.model;
   const u:Usage={input:message.usage.input_tokens+(message.usage.cache_read_input_tokens??0)+(message.usage.cache_creation_input_tokens??0),output:message.usage.output_tokens,thinking:message.usage.output_tokens_details?.thinking_tokens??0};
   total.input+=u.input;total.output+=u.output;total.thinking+=u.thinking;
   const attempt:Attempt={turn:turn+1,stopReason:message.stop_reason,design:null,evaluation:null,usage:u,ms:Date.now()-turnStart};
   attempts.push(attempt);
   if(message.stop_reason==='refusal'){result.status='refusal';result.error=`Declined${message.stop_details?.category?` (${message.stop_details.category})`:''}${message.stop_details?.explanation?`: ${message.stop_details.explanation}`:''}`;attempt.error=result.error;break;}
   if(message.stop_reason==='max_tokens'){attempt.error=`Ran out of output tokens (${maxTokens}).`;result.error=attempt.error;break;}
   const text=message.content.flatMap(b=>b.type==='text'?[b.text]:[]).join('');
   let design:ModelDesign;
   try{design=parseDesign(text);}catch(error){attempt.error=describeError(error);result.error=attempt.error;break;}
   const evaluation=evaluate(design,brief.constraints);
   Object.assign(attempt,{design,evaluation});
   Object.assign(result,{final:design,evaluation,status:evaluation.passes?'pass':'fail',error:undefined});
   if(turn===0)result.firstTryPass=evaluation.passes;
   console.log(`[${clock(t0)}] ${m.label}: turn ${turn+1} ${evaluation.passes?'PASSES':'misses'} (${evaluation.checks.filter(c=>!c.pass).map(c=>c.label).join(', ')||'all checks pass'})`);
   if(evaluation.passes||turn===repairs)break;
   // Append-only history: the model's own turn goes back unchanged, followed by the checker's report.
   messages.push({role:'assistant',content:message.content},{role:'user',content:feedback(evaluation)});
  }
 }catch(error){
  result.error=describeError(error);
  if(!result.final)result.status='error';
  console.log(`[${clock(t0)}] ${m.label}: ${result.error}`);
 }
 result.costUsd=costUsd(m,total);result.ms=Date.now()-started;
 return result;
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
 const t0=Date.now();
 if(runs>1)console.log(`\n=== Run ${run} of ${runs} ===`);
 const settled=await Promise.allSettled(models.map(m=>runModel(m,t0)));
 const results=settled.map((s,i):ModelResult=>s.status==='fulfilled'?s.value:{key:models[i].key,label:models[i].label,model:models[i].id,servedBy:null,status:'error',error:describeError(s.reason),attempts:[],final:null,evaluation:null,firstTryPass:false,usage:{input:0,output:0,thinking:0},costUsd:0,ms:0});
 if(results.every(r=>!r.attempts.length)){
  console.error(`\nNo model could be reached, so nothing was saved.\n${[...new Set(results.map(r=>r.error))].join('\n')}`);
  process.exit(1);
 }
 const createdAt=new Date().toISOString();
 const file:RunFile={version:1,brief,createdAt,settings:{effort,repairs,maxTokens},systemPrompt:system,results};
 const out=path.join('results',brief.id,`${createdAt.replace(/[:.]/g,'-')}.json`);
 mkdirSync(path.dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(file,null,1)+'\n');
 console.log(`\n${table(results)}\n`);
 for(const r of results){
  if(r.servedBy&&r.servedBy!==r.model)console.log(`Note: ${r.label} was answered by ${r.servedBy}.`);
  if(r.error)console.log(`${r.label}: ${r.error}`);
 }
 console.log(`Total cost about $${results.reduce((s,r)=>s+r.costUsd,0).toFixed(2)}. Saved ${out}`);
}
