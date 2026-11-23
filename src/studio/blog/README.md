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

Posts are listed newest first by `date`. The Markdown supported: `#` headings, paragraphs, `-` and `1.` lists, `>` quotes, `**bold**`, `*italic*`, `` `code` `` and fenced code blocks, `[links](url)`, `![images](url)` and `---` rules.

A post's images and videos go in a folder named after it, `posts/<address>/`, and are linked as `./<address>/name.jpg` (the cover too). The build bundles them. An `![image](...)` whose file is `.mp4` or `.webm` plays on its own as a muted, looping video with controls.

Then rebuild and deploy (`npm run studio:deploy`).
