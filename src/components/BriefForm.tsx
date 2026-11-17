import {useState,type FormEvent} from 'react';
import {MODELS,type RunFile} from '../engine/compare';

const EFFORTS=['low','medium','high','xhigh','max'];
const num=(v:string)=>v.trim()===''?undefined:Number(v);

/** Write a brief and send it to the models through POST /api/compare (dev server or Vercel Function). */
export function BriefForm({onDone}:{onDone:(file:RunFile,saved:boolean)=>void}){
 const[prompt,setPrompt]=useState(''),[maxConnectors,setMaxConnectors]=useState(''),[maxRods,setMaxRods]=useState(''),[gapIn,setGapIn]=useState(''),[freestanding,setFreestanding]=useState(true);
 const[models,setModels]=useState<string[]>(MODELS.map(m=>m.key)),[effort,setEffort]=useState('high'),[repairs,setRepairs]=useState(2);
 const[running,setRunning]=useState(false),[log,setLog]=useState<string[]>([]),[error,setError]=useState('');

 async function submit(event:FormEvent){
  event.preventDefault();if(running)return;
  setError('');setLog([]);setRunning(true);
  try{
   const gap=num(gapIn);
   const response=await fetch('/api/compare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt,models,effort,repairs,
    constraints:{maxConnectors:num(maxConnectors),maxRods:num(maxRods),gapMm:gap===undefined?undefined:Math.round(gap*25.4*1000)/1000,freestanding}})});
   if(!response.ok||!response.body){
    const body=await response.json().catch(()=>null) as {error?:string}|null;
    throw new Error(body?.error??(response.status===404?'Writing briefs needs `npm run dev` or the deployed site.':`Request failed (${response.status}).`));
   }
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',finished=false;
   for(;;){
    const {done,value}=await reader.read();if(done)break;
    buffer+=decoder.decode(value,{stream:true});
    const lines=buffer.split('\n');buffer=lines.pop()!;
    for(const line of lines.filter(Boolean)){
     const message=JSON.parse(line) as {type:'log';line:string}|{type:'done';file:RunFile;saved:string|null}|{type:'error';error:string};
     if(message.type==='log')setLog(l=>[...l,message.line]);
     else if(message.type==='error')throw new Error(message.error);
     else{finished=true;onDone(message.file,!!message.saved);}
    }
   }
   if(!finished)throw new Error('The run stopped before it finished. It may have hit the server time limit.');
  }catch(e){setError(e instanceof Error?e.message:String(e));}
  finally{setRunning(false);}
 }

 const toggle=(key:string)=>setModels(ms=>ms.includes(key)?ms.filter(k=>k!==key):[...ms,key]);
 return <form className="brief-form" onSubmit={submit}>
  <label className="field"><span>BRIEF</span><textarea rows={4} required maxLength={2000} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="e.g. Make me a chair a small toy could sit on, using no more than 30 connectors." disabled={running}/></label>
  <fieldset className="field-row" disabled={running}><legend>CHECKS</legend>
   <label>MAX CONNECTORS<input type="number" min={1} max={100} value={maxConnectors} onChange={e=>setMaxConnectors(e.target.value)} placeholder="—"/></label>
   <label>MAX RODS<input type="number" min={1} max={300} value={maxRods} onChange={e=>setMaxRods(e.target.value)} placeholder="—"/></label>
   <label>GAP, INCHES<input type="number" min={0.1} step={0.1} value={gapIn} onChange={e=>setGapIn(e.target.value)} placeholder="—"/></label>
  </fieldset>
  <label className="standing-option"><span>MUST STAND ON ITS OWN</span><input type="checkbox" checked={freestanding} onChange={e=>setFreestanding(e.target.checked)} disabled={running}/></label>
  <fieldset className="model-picks" disabled={running}><legend>MODELS</legend>{MODELS.map(m=><label key={m.key}><input type="checkbox" checked={models.includes(m.key)} onChange={()=>toggle(m.key)}/>{m.label.toUpperCase()}</label>)}</fieldset>
  <fieldset className="field-row" disabled={running}><legend className="sr-only">Settings</legend>
   <label>EFFORT<select value={effort} onChange={e=>setEffort(e.target.value)}>{EFFORTS.map(v=><option key={v} value={v}>{v.toUpperCase()}</option>)}</select></label>
   <label>REPAIR TURNS<select value={repairs} onChange={e=>setRepairs(Number(e.target.value))}>{[0,1,2,3].map(v=><option key={v} value={v}>{v}</option>)}</select></label>
  </fieldset>
  <p className="form-note">The brief goes to each model word for word. The checks are what the checker enforces, so state any limits in the brief too. Each run is billed to the site's API key.</p>
  <button className="primary" disabled={running||!prompt.trim()||!models.length}>{running?'ASKING THE MODELS':'ASK THE MODELS'}<span>↗</span></button>
  {log.length>0&&<ol className="run-log mono" aria-live="polite">{log.map((l,i)=><li key={i}>{l}</li>)}</ol>}
  {error&&<p role="alert" className="message error">{error}</p>}
 </form>;
}
