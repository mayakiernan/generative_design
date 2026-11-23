import {useEffect, useMemo, useState, type MouseEvent} from 'react';
import {longDate, parsePost, type Post} from '../blog/markdown';
import {StudioNav} from './Nav';

// Every Markdown file in src/studio/blog/posts/ is a post; its file name (without .md) is its address (?p=name).
const FILES = import.meta.glob('/src/studio/blog/posts/*.md', {query: '?raw', import: 'default', eager: true}) as Record<string, string>;
const POSTS: Post[] = Object.entries(FILES)
  .map(([path, raw]) => parsePost(path.split('/').pop()!.replace(/\.md$/, ''), raw))
  .sort((a, b) => b.date.localeCompare(a.date));

const current = () => new URLSearchParams(location.search).get('p');

/** The blog: newest posts first; one post at ?p=its-file-name. */
export function Blog() {
  const [slug, setSlug] = useState(current);
  useEffect(() => { const back = () => setSlug(current()); addEventListener('popstate', back); return () => removeEventListener('popstate', back); }, []);
  const post = useMemo(() => POSTS.find(p => p.slug === slug) ?? null, [slug]);
  useEffect(() => { document.title = post ? `${post.title} · Probable Pieces` : 'Blog · Probable Pieces'; scrollTo(0, 0); }, [post]);
  const open = (s: string | null) => (e: MouseEvent) => {
    e.preventDefault();
    history.pushState(null, '', s ? `?p=${encodeURIComponent(s)}` : './');
    setSlug(s);
  };

  return (
    <div className="st pb">
      <StudioNav current="blog" />
      {post ? (
        <article className="pb-post">
          <a className="pb-back" href="./" onClick={open(null)}>Blog</a>
          <h1>{post.title}</h1>
          <p className="pb-date">{longDate(post.date)}{post.author ? ` · ${post.author}` : ''}</p>
          {post.cover && <img className="pb-cover" src={post.cover} alt="" />}
          <div className="pb-body" dangerouslySetInnerHTML={{__html: post.html}} />
        </article>
      ) : (
        <>
          <h1 className="pb-head">Blog</h1>
          {slug && <p className="pb-empty">That post is not here.</p>}
          {POSTS.length ? (
            <ul className="pb-list">
              {POSTS.map(p => (
                <li key={p.slug}>
                  <a href={`?p=${encodeURIComponent(p.slug)}`} onClick={open(p.slug)}>
                    {p.cover && <img src={p.cover} alt="" loading="lazy" />}
                    <span className="pb-date">{longDate(p.date)}</span>
                    <b>{p.title}</b>
                    {p.summary && <span className="pb-summary">{p.summary}</span>}
                  </a>
                </li>
              ))}
            </ul>
          ) : <p className="pb-empty">No posts yet.</p>}
        </>
      )}
    </div>
  );
}
