import {key,type Vec,type Edge} from './physical.js';
export function validate(nodes:Vec[],edges:Edge[],n:number,e:number):string[]{
 const errors:string[]=[];
 if(nodes.length!==n||edges.length!==e)errors.push('Component counts do not match.');
 if(new Set(nodes.map(key)).size!==nodes.length)errors.push('Overlapping connectors.');
 if(nodes.some(p=>p.length!==3||p.some(v=>!Number.isInteger(v))))errors.push('Non-lattice position.');
 const seen=new Set<string>(),sockets=new Set<string>(),adj=nodes.map(()=>[] as number[]);
 for(const [a,b]of edges){
  if(!nodes[a]||!nodes[b]||a===b){errors.push('Invalid endpoint.');continue;}
  const d=nodes[b].map((v,i)=>v-nodes[a][i]);
  if(d.reduce((s,v)=>s+Math.abs(v),0)!==1)errors.push('Invalid rod length or socket direction.');
  const id=[a,b].sort((x,y)=>x-y).join(':');if(seen.has(id))errors.push('Duplicate rod.');seen.add(id);
  for(const [i,dir]of [[a,d],[b,d.map(v=>-v)]] as [number,number[]][]){const s=i+':'+dir.join(',');if(sockets.has(s))errors.push('Socket reused.');sockets.add(s);}
  adj[a].push(b);adj[b].push(a);
 }
 const reached=new Set<number>();const stack=nodes.length?[0]:[];
 while(stack.length){const i=stack.pop()!;if(reached.has(i))continue;reached.add(i);stack.push(...adj[i]);}
 if(reached.size!==nodes.length)errors.push('Disconnected assembly.');
 // Unit axis-aligned lattice segments cannot cross or pass through other integer vertices internally.
 return errors;
}
export function feasibility(n:number,e:number):string|null{
 if(!Number.isInteger(n)||!Number.isInteger(e)||n<1||e<0)return 'Enter whole quantities: at least 1 connector and 0 toothpicks.';
 if(n>100)return 'This instrument supports up to 100 connectors. Try a smaller construction.';
 if(e<n-1)return `A connected build needs at least ${n-1} toothpicks for ${n} connectors. Try ${n-1}.`;
 const upper=Math.floor(3*n-3*Math.pow(n,2/3)+1e-8);
 if(e>upper)return `These ${n} lattice connectors can use at most ${upper} toothpicks (a necessary upper bound). Try fewer toothpicks or more connectors.`;
 return null;
}
