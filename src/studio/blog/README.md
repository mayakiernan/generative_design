# Blog posts

Each Markdown file in `posts/` is one post on the site's Blog page (`/blog/`). There are none yet.

To add a post, create `posts/<address>.md`. The file name becomes the post's address: `posts/first-cuts.md` is at `/blog/?p=first-cuts`. Start the file with front matter:

```
---
title: First cuts
date: 2026-11-30
summary: One line shown in the list of posts.
author: Optional
cover: Optional image URL, shown above the post and in the list
---

The post itself, in Markdown.
```

Posts are listed newest first by `date`. The Markdown supported: `#` headings, paragraphs, `-` and `1.` lists, `>` quotes, `**bold**`, `*italic*`, `` `code` `` and fenced code blocks, `[links](url)`, `![images](url)` and `---` rules. Images can go in `studio/blog/` next to the page and be linked as `./name.jpg`.

Then rebuild and deploy (`npm run studio:deploy`).
