/**
 * A small Markdown reader for the blog: front matter, headings, paragraphs, lists, block quotes, images, code
 * blocks, rules, and inline bold, italic, code and links. Text is escaped before any markup is added, so a post can
 * only produce these elements.
 */

export interface Post {slug: string; title: string; date: string; summary: string; author?: string; cover?: string; thumbnail?: string; html: string}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Only web and relative links: no javascript: or data: URLs. */
const safeUrl = (u: string) => (/^(https?:\/\/|\/|\.{0,2}\/|#)/i.test(u) || !/^[a-z]+:/i.test(u) ? u : '#');

/** Maps a URL written in a post (such as `./my-post/photo.jpg`) to the one the page serves. */
export type MediaUrl = (url: string) => string;
const VIDEO = /\.(mp4|webm|mov)$/i;

function inline(s: string, media: MediaUrl): string {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  // An image whose file is a video plays inline like a GIF: on its own, muted and looping, with controls.
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => {
    const src = esc(safeUrl(media(url)));
    return VIDEO.test(url)
      ? `<video src="${src}" aria-label="${alt}" controls muted loop playsinline autoplay></video>`
      : `<img src="${src}" alt="${alt}" loading="lazy" />`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
    const href = safeUrl(url), external = /^https?:\/\//.test(href);
    return `<a href="${esc(href)}"${external ? ' target="_blank" rel="noopener"' : ''}>${text}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  return out;
}

export function renderMarkdown(src: string, media: MediaUrl = u => u): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n'), out: string[] = [];
  let para: string[] = [], list: {tag: 'ul' | 'ol'; items: string[]} | null = null, quote: string[] = [];
  const flush = () => {
    if (para.length) { out.push(`<p>${inline(para.join(' '), media)}</p>`); para = []; }
    if (list) { out.push(`<${list.tag}>${list.items.map(i => `<li>${inline(i, media)}</li>`).join('')}</${list.tag}>`); list = null; }
    if (quote.length) { out.push(`<blockquote><p>${inline(quote.join(' '), media)}</p></blockquote>`); quote = []; }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { flush(); const n = Math.min(4, h[1].length + 1); out.push(`<h${n}>${inline(h[2], media)}</h${n}>`); continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { flush(); out.push('<hr />'); continue; }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) { if (para.length || list) flush(); quote.push(q[1]); continue; }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line), ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      const tag = ul ? 'ul' : 'ol';
      if (para.length || quote.length || (list && list.tag !== tag)) flush();
      list ??= {tag, items: []};
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
    if (list || quote.length) flush();
    para.push(line.trim());
  }
  flush();
  return out.join('\n');
}

/** A post file: `---` front matter (title, date as YYYY-MM-DD, summary, optional author, cover and thumbnail) then Markdown. */
export function parsePost(slug: string, raw: string, media: MediaUrl = u => u): Post {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw.replace(/\r\n/g, '\n'));
  const meta: Record<string, string> = {};
  for (const line of (m?.[1] ?? '').split('\n')) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
  }
  return {slug, title: meta.title ?? slug, date: meta.date ?? '', summary: meta.summary ?? '', author: meta.author, cover: meta.cover && media(meta.cover), thumbnail: meta.thumbnail && media(meta.thumbnail), html: renderMarkdown(m?.[2] ?? raw, media)};
}

/** "22 November 2026" from "2026-11-22". */
export function longDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric'});
}
