// POST /api/compare: run a brief written on the comparison page.
// Shared by the Vercel Function (api/compare.ts) and the Vite dev server (scripts/compare-plugin.ts),
// so both check the same password and limits. Progress streams back as newline-delimited JSON:
//   {type:'log',line} ... then {type:'done',file,saved} or {type:'error',error}
// The API key is read in Node and never sent to the browser.
import {MODELS,type BriefConstraints} from '../src/engine/compare.js';
import {EFFORTS,describeError,runComparison,slug,type Effort} from './runner.js';
import {passwordOk} from './password.js';

export interface CompareRequest {prompt:string;constraints:BriefConstraints;models:string[];effort:Effort;repairs:number;}

const positive=(v:unknown,max:number)=>v===undefined||v===null?undefined:typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=max?v:NaN;

/** Returns a cleaned request, or an error message. */
export function parseRequest(raw:unknown):CompareRequest|string{
 if(!raw||typeof raw!=='object')return 'Expected a JSON object.';
 const r=raw as Record<string,unknown>,c=(r.constraints??{}) as Record<string,unknown>;
 const prompt=typeof r.prompt==='string'?r.prompt.trim():'';
 if(!prompt)return 'Write a brief first.';
 if(prompt.length>2000)return 'Keep the brief under 2000 characters.';
 const constraints:BriefConstraints={maxConnectors:positive(c.maxConnectors,100),maxRods:positive(c.maxRods,300),gapMm:positive(c.gapMm,10_000),freestanding:c.freestanding===true||undefined};
 if(Object.values(constraints).some(v=>Number.isNaN(v)))return 'Limits must be positive numbers (up to 100 connectors and 300 rods).';
 const models=Array.isArray(r.models)?r.models.filter((k):k is string=>MODELS.some(m=>m.key===k)):[];
 if(!models.length)return 'Pick at least one model.';
 const effort=(EFFORTS as readonly unknown[]).includes(r.effort)?r.effort as Effort:'high';
 const repairs=Number.isInteger(r.repairs)&&(r.repairs as number)>=0&&(r.repairs as number)<=3?r.repairs as number:2;
 return {prompt,constraints,models,effort,repairs};
}

const json=(status:number,body:object,headers:Record<string,string>={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}});
let running=0;

export interface HandlerEnv {apiKey?:string;password?:string;
 /** True on Vercel: require a password, and don't write result files (the filesystem is read-only). */
 deployed:boolean;log?:(line:string)=>void;}

export async function handleCompare(request:Request,env:HandlerEnv):Promise<Response>{
 if(request.method!=='POST')return json(405,{error:'Use POST.'});
 if(!passwordOk(request,env.password,env.deployed))return json(401,{error:'Password required.'},{'WWW-Authenticate':'Basic realm="Possible Pieces", charset="UTF-8"'});
 // Only the page itself may spend the key: same-origin JSON requests.
 const origin=request.headers.get('origin'),host=request.headers.get('host')??new URL(request.url).host;
 if(!origin||new URL(origin).host!==host||!request.headers.get('content-type')?.startsWith('application/json'))return json(403,{error:'Forbidden.'});
 if(running>=1)return json(409,{error:'A comparison is already running. Wait for it to finish.'});
 let parsed:CompareRequest|string;
 try{const text=await request.text();if(text.length>20_000)return json(413,{error:'Request too large.'});parsed=parseRequest(JSON.parse(text));}catch{return json(400,{error:'Could not read the request.'});}
 if(typeof parsed==='string')return json(400,{error:parsed});
 if(!env.apiKey)return json(500,{error:env.deployed?'ANTHROPIC_API_KEY is not set for this deployment.':'No API key found. Put ANTHROPIC_API_KEY=... in .env.local and restart npm run dev.'});
 const {prompt,constraints,models,effort,repairs}=parsed;
 running++;
 const encoder=new TextEncoder();
 const stream=new ReadableStream<Uint8Array>({async start(controller){
  const send=(o:object)=>controller.enqueue(encoder.encode(JSON.stringify(o)+'\n'));
  try{
   const {file,path}=await runComparison({brief:{id:slug(prompt),title:prompt,prompt,constraints},models:MODELS.filter(m=>models.includes(m.key)),effort,repairs,maxTokens:64000,apiKey:env.apiKey,save:!env.deployed,
    log:line=>{send({type:'log',line});env.log?.(line);}});
   if(file.results.every(r=>!r.attempts.length))send({type:'error',error:[...new Set(file.results.map(r=>r.error))].join(' ')||'No model could be reached.'});
   else send({type:'done',file,saved:path});
  }catch(error){send({type:'error',error:describeError(error)});}
  finally{running--;controller.close();}
 }});
 return new Response(stream,{headers:{'Content-Type':'application/x-ndjson','Cache-Control':'no-store'}});
}
