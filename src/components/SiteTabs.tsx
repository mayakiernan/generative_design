// Top-level navigation shared by both pages. Paths are relative so the static build works under any base.
export function SiteTabs({current}:{current:'generator'|'compare'}){
 const tabs=[{key:'generator',label:'GENERATOR',href:current==='compare'?'../':'./'},{key:'compare',label:'MODEL COMPARISON',href:current==='compare'?'./':'./compare/'}];
 return <nav className="site-tabs" aria-label="Site">{tabs.map(t=><a key={t.key} href={t.href} aria-current={t.key===current?'page':undefined}>{t.label}</a>)}</nav>;
}
