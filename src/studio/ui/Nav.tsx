import {Mark} from './Shapes';

/** The mark home, and the other pages. Links are relative so they work at the site root and under /studio/. */
export function StudioNav({current}: {current: 'atlas' | 'forms' | 'blog'}) {
  const pages = [{id: 'atlas', label: 'Atlas', href: '../atlas/'}, {id: 'forms', label: 'Form counts', href: '../forms/'}, {id: 'blog', label: 'Blog', href: '../blog/'}] as const;
  return (
    <nav className="st-nav" aria-label="Probable Pieces">
      <a className="pa-home" href="../" aria-label="Probable Pieces home"><Mark /></a>
      <span className="st-links">
        {pages.map(p => <a key={p.id} href={p.id === current ? './' : p.href} aria-current={p.id === current ? 'page' : undefined}>{p.label}</a>)}
      </span>
    </nav>
  );
}
