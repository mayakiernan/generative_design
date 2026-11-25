import {Mark} from './Shapes';

/** The mark home, and the other pages. Links are relative so they work at the site root and under /studio/. */
export function StudioNav({current}: {current: 'home' | 'atlas' | 'forms' | 'blog'}) {
  const home = current === 'home' ? './' : '../';
  const pages = [
    {id: 'home', label: 'Home', href: home},
    {id: 'blog', label: 'Blog', href: `${home}blog/`},
    {id: 'atlas', label: 'Projects', href: `${home}atlas/`},
  ] as const;
  return (
    <nav className="st-nav" aria-label="Probable Pieces">
      <a className="st-home" href={home} aria-label="Probable Pieces home"><Mark /></a>
      <span className="st-links">
        {pages.map(p => <a key={p.id} href={p.href} aria-current={p.id === current ? 'page' : undefined}>{p.label}</a>)}
      </span>
    </nav>
  );
}
