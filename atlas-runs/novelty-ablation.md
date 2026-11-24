# Structural novelty in the form atlas: what helps

2026-11-22 · full discs only (before half discs) · 80 mm discs, 3 mm sheet · 20,000 changes per run from the same seeds (413 gallery grids, 394 grown trees) · seed 1 unless marked. "Structures" counts distinct joined structures (spare slits ignored); "very far" is fingerprint distance ≥ 0.85 from the nearest gallery grid (two different grids are about 0.5 apart); motifs are distinct two-step joint motifs across all legal tables.

| run | parents | cell keeps | grafts | rare motifs | legal tables | structures not egg crates | very far | motifs |
|---|---|---|---|---|---:|---:|---:|---:|
| useful | any square, uniform | most usable top | – | – | 581 | 160 | 12 | 647 |
| v1-replace | any square, uniform | most novel | – | – | 533 | 158 | 16 | 631 |
| novel (first try) | most novel of 4 elites of any kind | most novel | ✓ | (no-op) | 316 | 37 | 8 | 387 |
| v6-legal-useful | most usable of 4 legal tables | most usable top | – | – | 3,846 | 1,770 | 336 | 1,249 |
| v6, seed 2 | | | | | 3,833 | 1,771 | 217 | 1,144 |
| v7-legal-useful-graft | most usable of 4 legal tables | most usable top | ✓ | – | 4,306 | 2,381 | 413 | 1,040 |
| v2-legalsel | most novel of 4 legal tables | most novel | – | – | 5,011 | 3,421 | 1,520 | 2,604 |
| **v3-graft (default)** | most novel of 4 legal tables | most novel | ✓ | – | 4,708 | 3,408 | 2,089 | 3,091 |
| v3, seed 2 | | | | | 4,432 | 3,094 | 1,921 | 2,290 |
| v4-motif | most novel of 4 legal tables | most novel | ✓ | ✓ | 4,465 | 2,915 | 1,825 | 2,654 |
| v5-both | most novel of 4 legal tables | novelty × usable | ✓ | – | 4,697 | 3,295 | 2,095 | 3,407 |

Parents are chosen this way seven times in ten; otherwise from a square picked uniformly.

What it shows:

- **Where parents come from is what matters.** Picking parents from any square sends most of the effort to near-miss towers and sprawls. Drawing them from legal tables alone gives about 11× more structures that are not egg crates.
- **Novelty, on top of that, roughly doubles the new structures** and gives 5–9× more forms very far from an egg crate than choosing the most useful legal table. The seed-2 repeats agree.
- **Novelty has to be measured among forms that work.** Choosing the most novel elite of any kind, with near misses scored against legal tables, picks the least table-like forms, and the search found fewer new structures than the plain baseline. Hence the "minimal criterion".
- **What a square keeps barely matters** (v1 ≈ baseline, v5 ≈ v3).
- **Grafts and prunes help:** more very-far forms and more motifs with novelty, and more structures even when ranking by usefulness.
- **The rare-motif bias** (grow from the slit whose disc becomes the rarest motif) did not help beyond seed noise, so it is off by default. A first version that weighted the new disc's own pose did nothing at all: a new disc usually joins by one slit, so every pose has the same motif.

Default from here: `--rank novel`, parents `novel-legal`, grafts on, rare motifs off. `npm run atlas -- --rank useful` gives the baseline; `--select`, `--graft`, `--motif` and `--tag` reproduce each row.
