import type {Vec} from './physical.js';
export const categories=['chair','table','bridge','tree','tower','arch','house','cube','staircase'] as const;
export interface ShapeTarget {category:string;attributes:string[];unknown:string[];active:boolean;}
export function parseShape(prompt:string):ShapeTarget{
 const words=prompt.toLowerCase().match(/[a-z]+/g)||[];const aliases:Record<string,string>={branches:'branching',stairs:'staircase',stepped:'stepped',spiral:'spiral',sculpture:'abstract'};
 const normalized=words.map(w=>aliases[w]||w),attributes=normalized.filter(w=>['tall','wide','narrow','asymmetric','symmetric','branching','dense','open','low','stepped','spiral','abstract'].includes(w));
 return {category:normalized.find(w=>(categories as readonly string[]).includes(w))||'',attributes,unknown:words.filter((w,i)=>!attributes.includes(normalized[i])&&!(categories as readonly string[]).includes(normalized[i])&&!['a','with','and','the','small','structure','two','supports'].includes(w)),active:!!attributes.length||normalized.some(w=>(categories as readonly string[]).includes(w))};
}
// Procedural occupancy objectives, scaled and varied per candidate, not stored models.
export function targetField(target:ShapeTarget,n:number,random:()=>number){
 let w=Math.max(1,Math.round(Math.cbrt(n)*(.65+random()*.35))),h=w,d=Math.max(1,w-1);const a=target.attributes;
 if(target.category==='chair'){w=Math.max(2,Math.round(Math.cbrt(n)));d=Math.max(1,w-(random()<.35?1:0));h=w;}
 if(['tower','tree'].includes(target.category)){h=w*2;w=Math.max(1,w-1);}
 if(['bridge','arch'].includes(target.category)){w*=2;h=Math.max(1,Math.round(w/2));}
 if(a.includes('wide'))w+=2;if(a.includes('tall'))h+=2;if(a.includes('narrow')){w=Math.max(1,w-1);d=1;}if(a.includes('low'))h=1;
 const seat=Math.max(1,Math.floor(h*.5));
 function affinity(p:Vec){const [x,y,z]=p;if(x<0||x>w||y<0||y>h||z<0||z>d)return .0001;const edgeX=x===0||x===w,edgeZ=z===0||z===d;let hit=true;
 switch(target.category){
 case 'chair':hit=y===seat||(z===d&&y>=seat)||(edgeX&&edgeZ&&y<=seat);break;
 case 'table':hit=y===h||(edgeX&&edgeZ);break;
 case 'bridge':case 'arch':hit=y===h||edgeX||(target.category==='bridge'&&y===h-1);break;
 case 'tree':hit=(x===Math.floor(w/2)&&z===Math.floor(d/2))||y>=h*.6;break;
 case 'tower':hit=edgeX||edgeZ;break;
 case 'house':hit=y<h-1?(edgeX||edgeZ||y===0):Math.abs(x-w/2)<=Math.max(0,(h-y)*w/2);break;
 case 'staircase':hit=y===Math.round(x*h/w)||y===0||(edgeZ&&y<=Math.round(x*h/w));break;
 case 'cube':hit=edgeX||edgeZ||y===0||y===h;break;
 }
 if(a.includes('stepped'))hit=hit&&y<=Math.ceil((x+1)*h/(w+1));
 if(a.includes('spiral')&&y>0){const side=y%4;hit=hit&&(side===0?z===0:side===1?x===w:side===2?z===d:x===0);}
 let value=hit?1:.025;if(a.includes('open')&&!edgeX&&!edgeZ)value*=.3;if(a.includes('dense'))value=Math.max(.3,value);if(a.includes('asymmetric'))value*=.4+.6*(x+1)/(w+1);if(a.includes('branching'))value*=y>h/2?1.8:.7;return value;
 }
 return {affinity,w,h,d,seat};
}
export function shapeScore(nodes:Vec[],target:ShapeTarget){if(!target.active)return 0;const mins=[0,1,2].map(a=>Math.min(...nodes.map(p=>p[a])));const ps=nodes.map(p=>p.map((v,i)=>v-mins[i]) as Vec);const size=[0,1,2].map(a=>Math.max(1,...ps.map(p=>p[a])));const [w,h,d]=size;let score=0;
 if(target.category==='chair'){const seat=Math.max(1,Math.floor(h/2));score=ps.filter(p=>p[1]===seat).length/ps.length+ps.filter(p=>p[1]>seat&&p[2]>=d*.75).length/ps.length+ps.filter(p=>p[1]<seat&&(p[0]===0||p[0]===w)).length/ps.length;}
 else if(target.category==='tower')score=h/(w+d);
 else if(target.category==='tree')score=h/(w+d)+ps.filter(p=>p[1]>=h*.6).length/ps.length;
 else if(target.category==='house')score=ps.filter(p=>p[1]<h*.6?(p[0]===0||p[0]===w||p[2]===0||p[2]===d):Math.abs(p[0]-w/2)<=w*(1-p[1]/h)/2+.5).length/ps.length;
 else if(['bridge','arch'].includes(target.category))score=w/(h+d)+ps.filter(p=>p[1]===h||p[0]===0||p[0]===w).length/ps.length;
 else if(target.category==='table')score=ps.filter(p=>p[1]===h||((p[0]===0||p[0]===w)&&(p[2]===0||p[2]===d))).length/ps.length;
 else if(target.category==='staircase')score=ps.filter(p=>Math.abs(p[1]-p[0]*h/w)<.75).length/ps.length;
 else score=1-Math.abs(w-h)/(w+h);
 const occupied=new Set(ps.map(p=>p.join(',')));const symmetry=ps.filter(p=>occupied.has([w-p[0],p[1],p[2]].join(','))).length/ps.length;
 for(const a of target.attributes){if(a==='symmetric')score+=symmetry;if(a==='asymmetric')score+=1-symmetry;if(a==='dense')score+=ps.length/((w+1)*(h+1)*(d+1));if(a==='open')score+=1-ps.length/((w+1)*(h+1)*(d+1));if(a==='tall')score+=h/(w+d);if(a==='wide'||a==='low')score+=w/h;if(a==='narrow')score+=h/w;}
 return Math.max(0,Math.min(1,score/3));
}
