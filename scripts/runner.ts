// Node-only: calls the Claude API. Used by the CLI (scripts/compare.ts) and the dev-server endpoint
// (scripts/compare-plugin.ts). Never import this from src/: the browser must not see the SDK or the key.
import Anthropic from '@anthropic-ai/sdk';
import {zodOutputFormat} from '@anthropic-ai/sdk/helpers/zod';
import {z} from 'zod';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {costUsd,evaluate,feedback,systemPrompt,type Attempt,type Brief,type ModelDesign,type ModelResult,type ModelSpec,type RunFile,type Usage} from '../src/engine/compare.js';

export const EFFORTS=['low','medium','high','xhigh','max'] as const;
export type Effort=typeof EFFORTS[number];

const Design=z.object({
 name:z.string(),
 rationale:z.string(),
 connectors:z.array(z.object({id:z.number().int(),x:z.number().int(),y:z.number().int(),z:z.number().int()})),
 rods:z.array(z.object({from:z.number().int(),to:z.number().int()})),
});
// The API constrains output to this schema; we parse it ourselves so a failed parse still keeps the response.
const {parse:parseDesign,...format}=zodOutputFormat(Design);
export const outputFormat=format;

export const slug=(text:string)=>text.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'brief';

export function describeError(error:unknown):string{
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

export interface RunOptions {
 brief:Brief;models:ModelSpec[];effort:Effort;repairs:number;maxTokens:number;
 /** Defaults to ANTHROPIC_API_KEY from the environment. */
 apiKey?:string;
 log?:(line:string)=>void;
 /** Write results/<brief>/<timestamp>.json (default true). */
 save?:boolean;
}

/** Ask every model in parallel, check each answer, and save the run. `path` is null when no model was reached. */
export async function runComparison(o:RunOptions):Promise<{file:RunFile;path:string|null}>{
 const client=new Anthropic({apiKey:o.apiKey,timeout:30*60*1000,maxRetries:2});
 const system=systemPrompt(),log=o.log??(()=>{}),t0=Date.now();
 const clock=()=>`${((Date.now()-t0)/1000).toFixed(0)}s`;

 async function runModel(m:ModelSpec):Promise<ModelResult>{
  const messages:Anthropic.MessageParam[]=[{role:'user',content:o.brief.prompt}];
  const attempts:Attempt[]=[],total:Usage={input:0,output:0,thinking:0};
  const result:ModelResult={key:m.key,label:m.label,model:m.id,servedBy:null,status:'error',attempts,final:null,evaluation:null,firstTryPass:false,usage:total,costUsd:0,ms:0};
  const started=Date.now();
  try{
   for(let turn=0;turn<=o.repairs;turn++){
    const turnStart=Date.now();
    log(`[${clock()}] ${m.label}: turn ${turn+1} started`);
    // No server-side fallbacks: a refusal answered by another model would be credited to this one.
    const message=await client.messages.stream({
     model:m.id,max_tokens:o.maxTokens,system,messages,
     thinking:{type:'adaptive'},
     output_config:{effort:o.effort,format:outputFormat},
    }).finalMessage();
    result.servedBy=message.model;
    const u:Usage={input:message.usage.input_tokens+(message.usage.cache_read_input_tokens??0)+(message.usage.cache_creation_input_tokens??0),output:message.usage.output_tokens,thinking:message.usage.output_tokens_details?.thinking_tokens??0};
    total.input+=u.input;total.output+=u.output;total.thinking+=u.thinking;
    const attempt:Attempt={turn:turn+1,stopReason:message.stop_reason,design:null,evaluation:null,usage:u,ms:Date.now()-turnStart};
    attempts.push(attempt);
    if(message.stop_reason==='refusal'){result.status='refusal';result.error=`Declined${message.stop_details?.category?` (${message.stop_details.category})`:''}${message.stop_details?.explanation?`: ${message.stop_details.explanation}`:''}`;attempt.error=result.error;log(`[${clock()}] ${m.label}: declined`);break;}
    if(message.stop_reason==='max_tokens'){attempt.error=`Ran out of output tokens (${o.maxTokens}).`;result.error=attempt.error;log(`[${clock()}] ${m.label}: ${attempt.error}`);break;}
    const text=message.content.flatMap(b=>b.type==='text'?[b.text]:[]).join('');
    let design:ModelDesign;
    try{design=parseDesign(text);}catch(error){attempt.error=describeError(error);result.error=attempt.error;log(`[${clock()}] ${m.label}: ${attempt.error}`);break;}
    const evaluation=evaluate(design,o.brief.constraints);
    Object.assign(attempt,{design,evaluation});
    Object.assign(result,{final:design,evaluation,status:evaluation.passes?'pass':'fail',error:undefined});
    if(turn===0)result.firstTryPass=evaluation.passes;
    log(`[${clock()}] ${m.label}: turn ${turn+1} ${evaluation.passes?'PASSES':'misses'} (${evaluation.checks.filter(c=>!c.pass).map(c=>c.label).join(', ')||'all checks pass'})`);
    if(evaluation.passes||turn===o.repairs)break;
    // Append-only history: the model's own turn goes back unchanged, followed by the checker's report.
    messages.push({role:'assistant',content:message.content},{role:'user',content:feedback(evaluation)});
   }
  }catch(error){
   result.error=describeError(error);
   if(!result.final)result.status='error';
   log(`[${clock()}] ${m.label}: ${result.error}`);
  }
  result.costUsd=costUsd(m,total);result.ms=Date.now()-started;
  return result;
 }

 const settled=await Promise.allSettled(o.models.map(runModel));
 const results=settled.map((s,i):ModelResult=>s.status==='fulfilled'?s.value:{key:o.models[i].key,label:o.models[i].label,model:o.models[i].id,servedBy:null,status:'error',error:describeError(s.reason),attempts:[],final:null,evaluation:null,firstTryPass:false,usage:{input:0,output:0,thinking:0},costUsd:0,ms:0});
 const createdAt=new Date().toISOString();
 const file:RunFile={version:1,brief:o.brief,createdAt,settings:{effort:o.effort,repairs:o.repairs,maxTokens:o.maxTokens},systemPrompt:system,results};
 if(o.save===false||results.every(r=>!r.attempts.length))return {file,path:null};
 const out=path.join('results',o.brief.id,`${createdAt.replace(/[:.]/g,'-')}.json`);
 mkdirSync(path.dirname(out),{recursive:true});writeFileSync(out,JSON.stringify(file,null,1)+'\n');
 return {file,path:out};
}
