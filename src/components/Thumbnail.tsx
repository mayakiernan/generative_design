import type {Design} from '../engine/physical';
// Lightweight isometric render of the same graph; avoids eight extra WebGL contexts.
export function Thumbnail({design}:{design:Design}){
 const ps=design.nodes.map(([x,y,z])=>[(x-z)*.86,(x+z)*.38-y]);const min=[0,1].map(a=>Math.min(...ps.map(p=>p[a]))),max=[0,1].map(a=>Math.max(...ps.map(p=>p[a])));const s=132/Math.max(2,...max.map((v,i)=>v-min[i]));const p=ps.map(v=>[90+(v[0]-(min[0]+max[0])/2)*s,90+(v[1]-(min[1]+max[1])/2)*s]);
 return <svg viewBox="0 0 180 180" role="img" aria-label={`Structure using ${design.edges.length} toothpicks and ${design.nodes.length} connectors`}><ellipse cx="90" cy="155" rx="47" ry="5" fill="#deddd8" opacity=".35"/>{design.edges.map(([a,b],i)=><g key={i}><line x1={p[a][0]} y1={p[a][1]+1} x2={p[b][0]} y2={p[b][1]+1} stroke="#c9c5ba" strokeWidth="2.2"/><line x1={p[a][0]} y1={p[a][1]} x2={p[b][0]} y2={p[b][1]} stroke="#ece9df" strokeWidth="1.4"/></g>)}{p.map(([x,y],i)=><g key={i} stroke="#c7c6bf" strokeWidth="3" strokeLinecap="round"><path d={`M${x-3},${y-1.4}l6,2.8M${x+3},${y-1.4}l-6,2.8M${x},${y-3.4}v6.8`}/><circle cx={x} cy={y} r="1.6" fill="#eeede7" stroke="none"/></g>)}</svg>;
}
