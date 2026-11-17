import React,{useEffect,useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Viewer} from './components/Viewer';
import {BriefForm} from './components/BriefForm';
import {ModelCard,STATUS,designsFor,runs as savedRuns,when} from './components/ModelRuns';
import type {BriefConstraints,RunFile} from './engine/compare';
import './style.css';

// Runs made on the deployed site can't be written to the repo, so this browser keeps them.
const LOCAL_KEY='possible-pieces:runs';
function loadLocal():RunFile[]{try{const v=JSON.parse(localStorage.getItem(LOCAL_KEY)??'[]');return Array.isArray(v)?v.filter(r=>r?.version===1):[];}catch{return [];}}
function saveLocal(list:RunFile[]){try{localStorage.setItem(LOCAL_KEY,JSON.stringify(list.slice(0,20)));}catch{/* storage full or blocked: the run still shows until reload */}}
function merge(local:RunFile[]){const seen=new Set<string>();return [...local,...savedRuns].filter(r=>!seen.has(r.createdAt)&&!!seen.add(r.createdAt)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
const firstDesign=(run?:RunFile)=>run?Math.max(0,designsFor(run).findIndex(Boolean)):0;

function constraintLabels(c:BriefConstraints){
 return [c.maxConnectors!==undefined&&`≤ ${c.maxConnectors} CONNECTORS`,c.maxRods!==undefined&&`≤ ${c.maxRods} RODS`,c.gapMm!==undefined&&`SPANS ${Math.round(c.gapMm*10)/10} MM GAP`,c.freestanding&&'FREESTANDING'].filter(Boolean) as string[];
}

function ComparePage(){
 const[local,setLocal]=useState(loadLocal);
 const runs=useMemo(()=>merge(local),[local]);
 const[runKey,setRunKey]=useState(()=>runs[0]?.createdAt??''),[selected,setSelected]=useState(()=>firstDesign(runs[0]));
 const[writing,setWriting]=useState(()=>!runs.length);
 const[wire,setWire]=useState(false),[animating,setAnimating]=useState(false),[progress,setProgress]=useState(1),[reset,setReset]=useState(0),[angle,setAngle]=useState(41);
 const run=runs.find(r=>r.createdAt===runKey)??runs[0];
 const designs=useMemo(()=>run?designsFor(run):[],[run]);
 const result=run?.results[selected],design=designs[selected]??null;
 function replay(){setWire(true);setProgress(0);setAnimating(true);}
 function stop(){setAnimating(false);setWire(false);setProgress(1);}
 function choose(i:number){setSelected(i);if(designs[i])replay();else stop();}
 function chooseRun(key:string){setRunKey(key);setSelected(firstDesign(runs.find(r=>r.createdAt===key)));stop();}
 function finished(file:RunFile,saved:boolean){
  // Saved runs come back through the results/ folder; unsaved (deployed) ones are kept in this browser.
  if(!saved){const next=[file,...local.filter(r=>r.createdAt!==file.createdAt)];setLocal(next);saveLocal(next);}
  else setLocal(l=>[file,...l.filter(r=>r.createdAt!==file.createdAt)]);
  setRunKey(file.createdAt);setSelected(firstDesign(file));setWriting(false);
  if(designsFor(file).some(Boolean))replay();
 }
 useEffect(()=>{if(!animating)return;let last=performance.now();const timer=setInterval(()=>{const now=performance.now(),dt=now-last;last=now;setProgress(p=>Math.min(1.13,p+dt/5500));},30);return()=>clearInterval(timer);},[animating]);
 useEffect(()=>{if(animating&&progress>=1.13)stop();},[progress,animating]);

 const tabs=<div className="compare-tabs mono" role="tablist">
  <button role="tab" aria-selected={!writing} onClick={()=>setWriting(false)} disabled={!run}>SAVED RUNS</button>
  <button role="tab" aria-selected={writing} onClick={()=>setWriting(true)}>WRITE A BRIEF +</button></div>;

 return <main className="compare-page"><section className="workspace"><aside>
  <a className="wordmark" href="../">Possible<br/>Pieces</a>
  <div className="compare-brief">
   <p className="mono eyebrow">MODEL COMPARISON</p>
   {tabs}
   {writing?<BriefForm onDone={finished}/>:run&&<>
    <p className="brief">“{run.brief.prompt}”</p>
    <ul className="brief-checks mono" aria-label="Checked constraints">{constraintLabels(run.brief.constraints).map(c=><li key={c}>{c}</li>)}</ul>
    {runs.length>1&&<label className="run-picker"><span className="sr-only">Saved run</span><select value={run.createdAt} onChange={e=>chooseRun(e.target.value)}>{runs.map(r=><option key={r.createdAt} value={r.createdAt}>{r.brief.title.slice(0,60)} · {when(r.createdAt)}</option>)}</select></label>}
    <p className="mono run-settings">{when(run.createdAt).toUpperCase()} · EFFORT {run.settings.effort.toUpperCase()} · UP TO {run.settings.repairs} REPAIR TURN{run.settings.repairs===1?'':'S'}</p>
   </>}
  </div>
  {!writing&&run&&<ol className="scoreboard">{run.results.map((r,i)=><li key={r.model}><button aria-pressed={i===selected} onClick={()=>choose(i)}>
   <span className="dot" aria-hidden="true"/>
   <span className="who"><span>{r.label.toUpperCase()}</span><span>{r.final?.name??r.error??''}</span></span>
   <span className="score"><span className={`badge ${r.status}`}>{STATUS[r.status]}</span><span>{r.evaluation?`${r.evaluation.connectors} CONN · ${r.evaluation.rods} RODS · `:''}${r.costUsd.toFixed(2)}</span></span>
  </button></li>)}</ol>}
  <a className="mono back-link" href="../">← BUILD GENERATOR</a>
 </aside>
 <div className="model-area">
  <div className="section-label"><span>{result?`${result.label} · ${result.final?.name??''} · ${STATUS[result.status]}`.toUpperCase():'NO RUN YET'}</span></div>
  <div className={'viewport '+(wire?'dark':'')} aria-label="Selected model's structure">
   <div className="viewport-top"><span>{wire?'CONSTRUCTION VIEW':'OBJECT VIEW'}</span><button onClick={()=>{setAnimating(false);setWire(v=>!v);setProgress(1);}} disabled={!design}>{wire?'OBJECT':'CONSTRUCTION'} ↗</button></div>
   {design?<Viewer design={design} wire={wire} progress={Math.min(1,progress)} reset={reset} onAngle={setAngle}/>:<p className="viewport-empty">{run?(result?.error??'This model returned no design.'):'Write a brief to see what each model builds.'}</p>}
   <div className="viewport-bottom"><span>{!design?'NO DESIGN':animating?`ASSEMBLING ${Math.round(Math.min(1,progress)*100)}%`:`${design.edges.length} RODS / ${design.nodes.length} JOINTS`}</span><span>DRAG TO ORBIT · SCROLL TO ZOOM</span></div>
  </div>
  <div className="view-controls"><div className="orientation"><svg width="53" height="36" viewBox="0 0 53 36" aria-hidden="true"><ellipse cx="26" cy="22" rx="22" ry="9" fill="none" stroke="#aaa" strokeDasharray="86 12" transform={`rotate(${angle} 26 22)`}/><path d="M26 23V5M26 23L14 29M26 23L38 28" stroke="#555" fill="none"/></svg><span>{String((angle+360)%360).padStart(3,'0')}°</span></div>
   <div className="actions"><button onClick={replay} disabled={!design}>REPLAY</button>{animating?<button onClick={stop}>SKIP ↗</button>:<button onClick={()=>setReset(v=>v+1)} disabled={!design}>RESET VIEW ↺</button>}</div></div>
 </div></section>
 {run&&<section className="collection model-runs" aria-labelledby="answers-title">
  <div className="collection-heading"><div><h2 id="answers-title">The answers</h2><p>One brief, the same checks, different models.</p></div><span className="mono">{String(run.results.length).padStart(2,'0')} MODEL{run.results.length===1?'':'S'}</span></div>
  <div className="model-grid">{run.results.map((r,i)=><ModelCard key={r.model} result={r} design={designs[i]} selected={i===selected} onSelect={()=>{choose(i);document.querySelector('.model-area')?.scrollIntoView({behavior:'smooth',block:'nearest'});}}/>)}</div>
 </section>}
 <footer><a href="../">← BUILD GENERATOR</a><span>GEOMETRY VERIFIED. STABILITY ESTIMATED.</span><span>{run?`RUN COST $${run.results.reduce((s,r)=>s+r.costUsd,0).toFixed(2)}`:''}</span></footer>
 </main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><ComparePage/></React.StrictMode>);
