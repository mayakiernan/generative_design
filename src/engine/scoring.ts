import {PHYSICAL,SPACING,type Vec,type Edge} from './physical.js';
type P=[number,number];
const cross=(a:P,b:P,c:P)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
export function hull(points:P[]){const p=points.slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);if(p.length<3)return p;const lo:P[]=[],hi:P[]=[];for(const v of p){while(lo.length>1&&cross(lo.at(-2)!,lo.at(-1)!,v)<=0)lo.pop();lo.push(v);}for(const v of p.slice().reverse()){while(hi.length>1&&cross(hi.at(-2)!,hi.at(-1)!,v)<=0)hi.pop();hi.push(v);}return [...lo.slice(0,-1),...hi.slice(0,-1)];}
export const STABILITY={margin:0.002,threshold:0.32,rodMass:.35};
export function score(nodes:Vec[],edges:Edge[]){
 const min=[0,1,2].map(a=>Math.min(...nodes.map(p=>p[a]))),max=[0,1,2].map(a=>Math.max(...nodes.map(p=>p[a]))),span=max.map((v,i)=>v-min[i]+1);
 const ground=nodes.filter(p=>p[1]===min[1]);const radius=PHYSICAL.armRadius/SPACING;const h=hull(ground.flatMap(p=>Array.from({length:8},(_,i)=>[p[0]+radius*Math.cos(i*Math.PI/4),p[2]+radius*Math.sin(i*Math.PI/4)] as P)));
 // Equal connector mass, with rod mass proportional to length (one rod = 0.35 connector).
 let mass=nodes.length, cx=nodes.reduce((s,p)=>s+p[0],0),cz=nodes.reduce((s,p)=>s+p[2],0);
 for(const [a,b]of edges){mass+=.35;cx+=.175*(nodes[a][0]+nodes[b][0]);cz+=.175*(nodes[a][2]+nodes[b][2]);}const com:P=[cx/mass,cz/mass];
 const clearance=Math.min(...h.map((p,i)=>cross(p,h[(i+1)%h.length],com)/Math.hypot(h[(i+1)%h.length][0]-p[0],h[(i+1)%h.length][1]-p[1])));const inside=clearance>=STABILITY.margin;
 const area=Math.abs(h.reduce((s,p,i)=>s+p[0]*h[(i+1)%h.length][1]-p[1]*h[(i+1)%h.length][0],0))/2;
 const degree=nodes.map((_,i)=>edges.filter(e=>e.includes(i)).length),leaves=degree.filter(d=>d===1).length;
 const cantilever=Math.max(0,...nodes.map(p=>Math.min(...ground.map(g=>Math.hypot(p[0]-g[0],p[2]-g[2])))));const slenderness=span[1]/Math.max(.1,Math.sqrt(area));const loops=edges.length-nodes.length+1;const stabilityScore=Math.max(0,Math.min(1,.55+Math.min(.25,clearance*.25)+Math.min(.15,loops/nodes.length)-.015*slenderness-.025*cantilever-.07*leaves/nodes.length));const stable=inside&&stabilityScore>=STABILITY.threshold;
 const density=nodes.length/(span[0]*span[1]*span[2]);
 const descriptor=[...span.map(v=>v/Math.cbrt(nodes.length)),density,leaves/nodes.length,degree.filter(d=>d>=3).length/nodes.length,ground.length/nodes.length];
 return {stabilityScore,centerOfMass:com,supportPolygon:h,clearance,cantilever,score:(inside?3:0)+Math.min(area/Math.max(1,span[1]),3)+.6*(3-span.filter(s=>s===1).length)-leaves/nodes.length,experimental:!stable,descriptor,groundContacts:ground.length};
}
