import './SiteTabs.css';
// Top-level navigation shared by every page. Paths are relative so the static build works under any base.
export type SitePage='generator'|'compare'|'slots';
export function SiteTabs({current}:{current:SitePage}){
 const root=current==='generator'?'./':'../';
 const tabs:{key:SitePage;label:string;href:string}[]=[{key:'generator',label:'GENERATOR',href:root},{key:'compare',label:'MODEL COMPARISON',href:`${root}compare/`},{key:'slots',label:'SLOT KITS',href:`${root}slots/`}];
 return <nav className="site-tabs" aria-label="Site">{tabs.map(t=><a key={t.key} href={t.key===current?'./':t.href} aria-current={t.key===current?'page':undefined}>{t.label}</a>)}</nav>;
}
