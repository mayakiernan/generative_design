import {Thumbnail} from './Thumbnail';
import {toDesign,type ModelResult,type RunFile} from '../engine/compare';
import type {Design} from '../engine/physical';

// Saved runs from `npm run compare`, newest first. Vite picks up new files while the dev server runs.
const files=import.meta.glob<RunFile>('/results/**/*.json',{eager:true,import:'default'});
export const runs=Object.values(files).filter(r=>r?.version===1&&Array.isArray(r.results)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));

export const STATUS:Record<ModelResult['status'],string>={pass:'MEETS BRIEF',fail:'MISSES BRIEF',refusal:'DECLINED',error:'NO DESIGN'};
export const when=(iso:string)=>new Date(iso).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
function seedFor(text:string){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
/** Engine designs for each model's final answer, so the Viewer and Thumbnail can draw them. */
export function designsFor(run:RunFile):(Design|null)[]{return run.results.map(r=>r.final?toDesign(r.final,seedFor(run.createdAt+r.model)):null);}

export function ModelCard({result:r,design,selected,onSelect}:{result:ModelResult;design:Design|null;selected:boolean;onSelect:()=>void}){
 const turns=r.attempts.length;
 return <article className={`model-card ${r.status}${selected?' selected':''}`}>
  <header className="caption"><span>{r.label.toUpperCase()}{selected?' · VIEWING':''}</span><span className={`badge ${r.status}`}>{STATUS[r.status]}</span></header>
  {design&&r.final?<button className="thumb" onClick={onSelect} aria-pressed={selected} aria-label={`Show the ${r.label} design in the 3D viewer`}><Thumbnail design={design}/><span className="card-arrow">↗</span></button>
   :<div className="thumb empty"><p>{r.error??'No design returned.'}</p></div>}
  {r.final&&<h3>{r.final.name}</h3>}
  {r.evaluation&&<ul className="checks">{r.evaluation.checks.map(c=><li key={c.label} className={c.pass?'pass':'fail'}><span aria-hidden="true">{c.pass?'✓':'✕'}</span><span className="sr-only">{c.pass?'Pass:':'Fail:'}</span><span>{c.label}</span><span>{c.detail}</span></li>)}
   <li className="info"><span aria-hidden="true">·</span><span>Rods</span><span>{r.evaluation.rods} used</span></li></ul>}
  {r.final?.rationale&&<p className="rationale">{r.final.rationale}</p>}
  {r.error&&design&&<p className="message error">{r.error}</p>}
  <p className="mono meta">{turns} TURN{turns===1?'':'S'}{turns?` · FIRST TRY ${r.firstTryPass?'PASS':'MISS'}`:''} · {(r.ms/1000).toFixed(0)}S · ${r.costUsd.toFixed(2)}{r.servedBy&&r.servedBy!==r.model?` · ANSWERED BY ${r.servedBy.toUpperCase()}`:''}</p>
 </article>;
}
