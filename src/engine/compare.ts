// Shared, dependency-free pieces of the model comparison harness.
// Used by scripts/compare.ts (Node, calls the API) and by the in-app viewer (browser, reads results).
// Nothing here talks to the network or touches an API key.
import {PHYSICAL,SPACING,type Vec,type Edge,type Design} from './physical.js';
import {validate} from './validate.js';
import {score} from './scoring.js';
import {fingerprint} from './generate.js';

export interface BriefConstraints {
 /** Hard upper limit on connectors. */
 maxConnectors?:number;
 /** Hard upper limit on rods (toothpicks). */
 maxRods?:number;
 /** Clear ground gap, in millimetres, the structure must bridge. */
 gapMm?:number;
 /** Require the estimated freestanding check to pass. */
 freestanding?:boolean;
}
export interface Brief {id:string;title:string;prompt:string;constraints:BriefConstraints;}

export interface ModelSpec {key:string;label:string;id:string;
 /** USD per million tokens, Anthropic first-party list prices as of 2026-11. */
 price:{input:number;output:number};}
export const MODELS:ModelSpec[]=[
 {key:'sonnet',label:'Sonnet 5.5',id:'claude-sonnet-5-5',price:{input:2,output:10}},
 {key:'opus',label:'Opus 5.5',id:'claude-opus-5-5',price:{input:4,output:20}},
 {key:'fable',label:'Fable 5.2',id:'claude-fable-5-2',price:{input:8,output:40}},
];

/** The design shape each model returns (also the JSON schema the API enforces). */
export interface ModelDesign {
 name:string;
 rationale:string;
 connectors:{id:number;x:number;y:number;z:number}[];
 rods:{from:number;to:number}[];
}

export function systemPrompt():string{
 const s=SPACING,r=PHYSICAL.armRadius;
 return `You design physical structures built from a construction kit. A program checks your design, so it must follow the kit's geometry exactly.

The kit
- Rods: identical straight toothpicks, ${PHYSICAL.rodLength} mm long.
- Connectors: identical hubs with six sockets pointing along +x, -x, +y, -y, +z and -z. Every connector keeps the same orientation; none can be rotated.
- A rod pushed into two sockets holds the two connector centres exactly ${s} mm apart. So every connector sits on a point of a cubic lattice with ${s} mm spacing, and every rod joins two connectors one lattice step apart along a single axis.

Coordinates
- Connector positions are integer lattice coordinates (x, y, z). One unit is ${s} mm.
- y is vertical. The connectors with the lowest y rest on the ground. Each touches it with its downward socket: a circular contact ${r} mm in radius around the connector's centre. Nothing else touches the ground.

Rules the checker enforces
- No two connectors share a position.
- Each rod joins two connectors whose coordinates differ by exactly 1 along exactly one axis, and at most one rod joins any pair.
- The assembly is one connected piece.
- Every connector and rod you list counts as used.

How the checker judges the result
- Freestanding: the centre of mass (each connector weighs 1, each rod 0.35) must project inside the convex hull of the ground contacts, with some clearance. Tall narrow forms, long cantilevers and connectors hanging from a single rod are penalised.
- Gaps: when a brief asks to span a gap, the checker looks along x and along z for a band of ground that no contact touches at any depth, with contacts on both sides. Its clear width is D * ${s} - 2 * ${r} mm, where D is the lattice distance between the contacts on either side of the band. The structure rests on the ground on both sides.
- Limits on connectors or rods in the brief are hard limits.

Answer with the design in the requested JSON format: a short name, a brief rationale explaining how the design meets the brief, the connectors (each with an integer id and x, y, z) and the rods (each naming the ids of the two connectors it joins).`;
}

/** Turn a model's id-based answer into the engine's index-based graph. */
export function toGraph(d:ModelDesign):{nodes:Vec[];edges:Edge[];errors:string[]}{
 const index=new Map<number,number>(),errors:string[]=[];
 d.connectors.forEach((c,i)=>{if(index.has(c.id))errors.push(`Connector id ${c.id} is listed more than once.`);else index.set(c.id,i);});
 const nodes=d.connectors.map(c=>[c.x,c.y,c.z] as Vec),edges:Edge[]=[];
 for(const r of d.rods){const a=index.get(r.from),b=index.get(r.to);if(a===undefined||b===undefined){errors.push(`Rod ${r.from}-${r.to} names a connector that is not listed.`);continue;}edges.push([a,b]);}
 return {nodes,edges,errors};
}

export interface SpanResult {axis:'x'|'z';clearMm:number;between:[number,number];}
/** Widest band of ground with no contact at any depth and contacts on both sides. */
export function largestClearSpan(nodes:Vec[]):SpanResult|null{
 if(!nodes.length)return null;
 const floor=Math.min(...nodes.map(p=>p[1])),ground=nodes.filter(p=>p[1]===floor);let best:SpanResult|null=null;
 for(const [axis,i] of [['x',0],['z',2]] as const){
  const values=[...new Set(ground.map(p=>p[i]))].sort((a,b)=>a-b);
  for(let k=1;k<values.length;k++){const clearMm=(values[k]-values[k-1])*SPACING-2*PHYSICAL.armRadius;if(!best||clearMm>best.clearMm)best={axis,clearMm,between:[values[k-1],values[k]]};}
 }
 return best;
}

export interface Check {label:string;pass:boolean;detail:string;}
export interface Evaluation {
 passes:boolean;valid:boolean;errors:string[];checks:Check[];
 connectors:number;rods:number;stable:boolean;stabilityScore:number;groundContacts:number;
 span:SpanResult|null;sizeMm:[number,number,number];
}
export function evaluate(d:ModelDesign,c:BriefConstraints):Evaluation{
 const {nodes,edges,errors:mapping}=toGraph(d);
 const errors=nodes.length?[...mapping,...validate(nodes,edges,nodes.length,edges.length)]:['The design has no connectors.'];
 const metrics=nodes.length?score(nodes,edges):null;
 const stable=!!metrics&&!metrics.experimental,stabilityScore=metrics?.stabilityScore??0,span=largestClearSpan(nodes);
 const size=[0,1,2].map(a=>nodes.length?(Math.max(...nodes.map(p=>p[a]))-Math.min(...nodes.map(p=>p[a])))*SPACING:0) as [number,number,number];
 const checks:Check[]=[{label:'Valid geometry',pass:!errors.length,detail:errors.length?[...new Set(errors)].join(' '):'On the lattice and connected'}];
 if(c.maxConnectors!==undefined)checks.push({label:'Connectors',pass:nodes.length<=c.maxConnectors,detail:`${nodes.length} of ${c.maxConnectors} max`});
 if(c.maxRods!==undefined)checks.push({label:'Rods',pass:edges.length<=c.maxRods,detail:`${edges.length} of ${c.maxRods} max`});
 if(c.gapMm!==undefined){const need=`${Math.round(c.gapMm*10)/10} mm needed`;checks.push({label:'Spans gap',pass:!!span&&span.clearMm>=c.gapMm,detail:span?`${span.clearMm.toFixed(1)} mm clear, ${need}`:`No clear band between ground contacts, ${need}`});}
 if(c.freestanding)checks.push({label:'Freestanding',pass:stable,detail:metrics?`${stable?'Estimated stable':'Estimated unstable'}, score ${stabilityScore.toFixed(2)}`:'Nothing to stand'});
 return {passes:checks.every(k=>k.pass),valid:!errors.length,errors,checks,connectors:nodes.length,rods:edges.length,stable,stabilityScore,groundContacts:metrics?.groundContacts??0,span,sizeMm:size};
}

/** The follow-up message a model gets when its design misses the brief. Same for every model. */
export function feedback(e:Evaluation):string{
 return `The checker found problems with that design:\n${e.checks.filter(k=>!k.pass).map(k=>`- ${k.label}: ${k.detail}`).join('\n')}\nReturn a complete corrected design.`;
}

export function costUsd(m:ModelSpec,usage:{input:number;output:number}){return (usage.input*m.price.input+usage.output*m.price.output)/1e6;}

/** A full engine Design, so model output can use the existing Viewer and Thumbnail. */
export function toDesign(d:ModelDesign,seed:number):Design|null{
 const {nodes,edges}=toGraph(d);if(!nodes.length)return null;
 return {seed,nodes,edges,fingerprint:fingerprint(nodes,edges),...score(nodes,edges)};
}

export interface Usage {input:number;output:number;thinking:number;}
export interface Attempt {turn:number;stopReason:string|null;design:ModelDesign|null;evaluation:Evaluation|null;usage:Usage;ms:number;error?:string;}
export interface ModelResult {
 key:string;label:string;model:string;
 /** The model that actually answered, as reported by the API. */
 servedBy:string|null;
 status:'pass'|'fail'|'refusal'|'error';error?:string;
 attempts:Attempt[];final:ModelDesign|null;evaluation:Evaluation|null;
 firstTryPass:boolean;usage:Usage;costUsd:number;ms:number;
}
export interface RunFile {
 version:1;brief:Brief;createdAt:string;
 settings:{effort:string;repairs:number;maxTokens:number};
 systemPrompt:string;results:ModelResult[];
}
