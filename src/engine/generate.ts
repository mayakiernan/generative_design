import {DIRECTIONS,add,key,type Vec,type Edge,type Design} from './physical';
import {score} from './scoring';import {feasibility,validate} from './validate';
export function rng(seed:number){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
// Translation / rotation / reflection invariant graph signature, including actual occupied rods.
export function fingerprint(nodes:Vec[],edges:Edge[]){
 let best='~';for(const perm of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]])for(let mask=0;mask<8;mask++){
 const pts=nodes.map(p=>perm.map((a,i)=>p[a]*(mask&(1<<i)?-1:1)) as Vec),mins=[0,1,2].map(a=>Math.min(...pts.map(p=>p[a]))),ks=pts.map(p=>p.map((v,i)=>v-mins[i]).join(','));
 const s=ks.slice().sort().join(';')+'|'+edges.map(([a,b])=>[ks[a],ks[b]].sort().join('/')).sort().join(';');if(s<best)best=s;
 }return best;
}
function candidate(n:number,e:number,seed:number):Design|null{
 const random=rng(seed),nodes:Vec[]=[[0,0,0]],occupied=new Map([['0,0,0',0]]),tree:Edge[]=[];
 const axes=[.4+random()*2,.4+random()*2,.4+random()*2],compact=e>n-1?2+random()*5:random()*3;
 for(let i=1;i<n;i++){
  const frontier=new Map<string,{p:Vec;parent:number;w:number}>();
  for(let j=0;j<nodes.length;j++)for(let a=0;a<6;a++){const p=add(nodes[j],DIRECTIONS[a]),k=key(p);if(occupied.has(k)||frontier.has(k))continue;
   const adjacent=DIRECTIONS.filter(d=>occupied.has(key(add(p,d)))).length;
   const dist=p.reduce((s,v,k)=>s+Math.abs(v)*axes[k],0);
   frontier.set(k,{p,parent:j,w:Math.exp(Math.min(15,compact*(adjacent-1)))/(1+dist*.18)});
  }
  let r=random()*[...frontier.values()].reduce((s,v)=>s+v.w,0),chosen=[...frontier.values()][0];for(const v of frontier.values()){r-=v.w;if(r<=0){chosen=v;break;}}
  occupied.set(key(chosen.p),i);nodes.push(chosen.p);tree.push([chosen.parent,i]);
 }
 const used=new Set(tree.map(([a,b])=>[a,b].sort((a,b)=>a-b).join(':'))),extra:Edge[]=[];
 nodes.forEach((p,i)=>DIRECTIONS.forEach(d=>{const j=occupied.get(key(add(p,d)));if(j!==undefined&&j>i&&!used.has(i+':'+j))extra.push([i,j]);}));
 if(tree.length+extra.length<e)return null;
 for(let i=extra.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[extra[i],extra[j]]=[extra[j],extra[i]];}
 const edges=[...tree,...extra.slice(0,e-tree.length)];
 // Choose a grounded orientation with the best support heuristic.
 let oriented=nodes,metrics=score(nodes,edges);
 for(let a=0;a<3;a++)for(const sign of [-1,1]){const ps=nodes.map(p=>a===0?[p[1],p[0]*sign,p[2]]:a===1?[p[0],p[1]*sign,p[2]]:[p[0],p[2]*sign,p[1]]) as Vec[];const m=score(ps,edges);if(m.score>metrics.score){metrics=m;oriented=ps;}}
 if(validate(oriented,edges,n,e).length)return null;
 return {seed,nodes:oriented,edges,fingerprint:'',...metrics};
}
export function generate(n:number,e:number,seed:number,attempts=650):{designs:Design[];notice:string}{
 const issue=feasibility(n,e);if(issue)throw Error(issue);
 const unique=new Map<string,Design>();
 for(let i=0;i<attempts;i++){const d=candidate(n,e,(seed+Math.imul(i+1,2654435761))>>>0);if(!d)continue;d.fingerprint=fingerprint(d.nodes,d.edges);if(!unique.has(d.fingerprint))unique.set(d.fingerprint,d);}
 const pool=[...unique.values()].sort((a,b)=>b.score-a.score),selected:Design[]=[];
 while(selected.length<9&&pool.length){const wantExperimental=selected.length>=7;let best=0,bestScore=-Infinity;
  pool.forEach((d,i)=>{const novelty=selected.length?Math.min(...selected.map(s=>Math.sqrt(d.descriptor.reduce((v,x,j)=>v+(x-s.descriptor[j])**2,0)))):0;const value=novelty*3+d.score*.25+(d.experimental===wantExperimental?3:0);if(value>bestScore){best=i;bestScore=value;}});
  selected.push(pool.splice(best,1)[0]);
 }
 return {designs:selected,notice:selected.length<9?`Found ${selected.length} distinct valid design${selected.length===1?'':'s'} within the search budget. ${selected.length===0?'Try fewer toothpicks or more connectors; no valid arrangement was found.':''}`:''};
}
