# Form atlas: Circular slot-kit tables

2026-11-22 · 80 mm discs, 3 mm sheet, lattice pitch 41.6 mm · seed 1 · 21,096 forms judged in 3162 s.

A **legal table** has a level surface on top (the top is cut to fit; at least three supports off a line), at least 120 mm up; stands as built and tips only past 8°; no part can drop out; no slit joint can swing under its own weight or under weight on top; a group build sequence exists; at most 30 pieces (the top not counted). Half discs are in: H1 sits on the lattice like a one-slit disc; an H sits with its notch line through a lattice point, and is never joined notch to notch with another H.

## How many forms there are

Every connected, overlap-free arrangement of kit pieces (full and half discs), counted once however it is turned or mirrored about the vertical:

| pieces | forms | legal tables |
|---:|---:|---:|
| 1 | 18 | 0 |
| 2 | 84 | 0 |
| 3 | 564 | 0 |
| 4 | 5,092 | 0 |
| 5 | 57,572 | not judged |
| 6 | 707,445 | not judged |

Each disc multiplies the count by about 12, so at 30 discs there are on the order of 10^32 forms: they can only be sampled. The rest of this atlas is a map of that space by form, filled by search.

## Legal tables

- 5,057 legal tables found: 3,860 distinct structures (ignoring spare slits), 3,524 of them not an egg-crate grid layout of any size. They fill 728 of the 2249 cells of the map.
- Fewest pieces: 10.
- Legal tables using half discs: 2,401 of 5,057.
- Loops of joints: legal egg crates 0–6; other legal tables 0–5. A tree (0 loops) can pass only because the floor is modelled as no-slip (see Caveats).

| loops | cells with a legal egg crate | cells with another legal table |
|---|---:|---:|
| 0 | 16 | 244 |
| 1 | 19 | 217 |
| 2 | 18 | 124 |
| 3 | 17 | 44 |
| 4–6 | 13 | 16 |

- loops 0 · height 3 · plan 10×3 · surface 2–4 discs · sym 1 · far: 18 pieces, 0 loops, 125 mm tall, plan 10×3, surface 1.08 dm²
- loops 0 · height 3 · plan 10×3 · surface 2–4 discs · sym 1 · very far: 20 pieces (1 H1), 0 loops, 125 mm tall, plan 10×3, surface 1.08 dm²
- loops 0 · height 3 · plan 10×4 · surface 2–4 discs · sym 1 · very far: 19 pieces, 0 loops, 125 mm tall, plan 10×4, surface 1.08 dm²
- loops 0 · height 3 · plan 10×5 · surface 2–4 discs · sym 1 · far: 21 pieces, 0 loops, 125 mm tall, plan 10×5, surface 1.75 dm²
- loops 0 · height 3 · plan 10×5 · surface 2–4 discs · sym 1 · very far: 23 pieces (1 H1), 0 loops, 125 mm tall, plan 10×5, surface 1.75 dm²
- loops 0 · height 3 · plan 10×5 · surface 4+ discs · sym 1 · far: 24 pieces (1 H1), 0 loops, 125 mm tall, plan 10×5, surface 2.13 dm²
- loops 0 · height 3 · plan 10×5 · surface 4+ discs · sym 1 · very far: 25 pieces (1 H1), 0 loops, 125 mm tall, plan 10×5, surface 2.58 dm²
- loops 0 · height 3 · plan 10×6 · surface 2–4 discs · sym 1 · very far: 21 pieces (1 H1), 0 loops, 125 mm tall, plan 10×6, surface 1.75 dm²
- loops 0 · height 3 · plan 10×6 · surface 4+ discs · sym 1 · far: 25 pieces (2 H1), 0 loops, 125 mm tall, plan 10×6, surface 2.58 dm²
- loops 0 · height 3 · plan 10×6 · surface 4+ discs · sym 1 · very far: 27 pieces (1 H1), 0 loops, 125 mm tall, plan 10×6, surface 2.58 dm²
- loops 0 · height 3 · plan 10×7 · surface 4+ discs · sym 1 · very far: 27 pieces (2 H1), 0 loops, 125 mm tall, plan 10×7, surface 2.58 dm²
- loops 0 · height 3 · plan 11×3 · surface 2–4 discs · sym 1 · very far: 18 pieces, 0 loops, 125 mm tall, plan 11×3, surface 1.08 dm²

## Structural novelty

Ranked by **novel** (each cell keeps the structure least like the legal tables seen); parents seven times in ten the most novel of four legal tables, else from a uniform cell; grafts and prunes on; rare-motif discs off.

A structure's fingerprint counts its joint motifs (Weisfeiler–Lehman, two rounds); novelty is the mean fingerprint distance to the 15 most similar legal tables, distance from an egg crate the distance to the nearest gallery grid's fingerprint (two different grids are typically about 0.5 apart).

| distance from an egg crate | legal structures |
|---|---:|
| egg crate | 336 |
| close | 0 |
| apart | 206 |
| far | 1,659 |
| very far | 1,659 |

- Distinct two-step joint motifs across all legal tables: 4,032.
- Legal tables that are not egg crates: median distance from an egg crate 0.79.

Most novel legal tables (one per cell):

- novelty 0.89, very far from an egg crate (1.07): 14 pieces (2 H1), 0 loops, 125 mm tall, plan 4×4, surface 1.08 dm²
- novelty 0.86, very far from an egg crate (0.96): 22 pieces (1 H1), 1 loops, 166 mm tall, plan 5×4, surface 1.54 dm²
- novelty 0.85, very far from an egg crate (0.91): 28 pieces, 0 loops, 208 mm tall, plan 7×5, surface 2.2 dm²
- novelty 0.83, very far from an egg crate (0.91): 24 pieces (1 H1), 1 loops, 208 mm tall, plan 4×3, surface 1.08 dm²
- novelty 0.83, very far from an egg crate (0.92): 23 pieces (2 H1), 1 loops, 121 mm tall, plan 6×5, surface 0.8 dm²
- novelty 0.82, very far from an egg crate (1.04): 16 pieces (2 H1), 0 loops, 125 mm tall, plan 6×4, surface 1.08 dm²
- novelty 0.82, very far from an egg crate (1.08): 16 pieces (1 H1), 0 loops, 125 mm tall, plan 5×5, surface 1.08 dm²
- novelty 0.82, very far from an egg crate (0.92): 23 pieces (2 H1), 0 loops, 168 mm tall, plan 6×3, surface 1.52 dm²
- novelty 0.80, very far from an egg crate (1.11): 26 pieces (2 H1), 0 loops, 125 mm tall, plan 9×5, surface 1.97 dm²
- novelty 0.79, very far from an egg crate (0.95): 14 pieces (1 H1), 0 loops, 121 mm tall, plan 4×4, surface 0.8 dm²

## Near misses

Forms that fail exactly one check:

| only fails | forms | best example |
|---|---:|---|
| tips too easily | 102 | 16 pieces (2 H1), 0 loops, 166 mm tall, plan 3×3, surface 1.08 dm² |
| a part can drop out | 82 | 14 pieces (1 H1), 0 loops, 121 mm tall, plan 5×4, surface 1.31 dm² |
| sags under its own weight | 1,950 | 16 pieces (1 H1), 0 loops, 121 mm tall, plan 5×3, surface 0.93 dm² |
| folds under weight on top | 1,095 | 8 pieces (1 H1), 0 loops, 121 mm tall, plan 3×3, surface 0.79 dm² |
| no flat surface on top | 1,417 | 6 pieces (2 H1), 0 loops, 122 mm tall, plan 3×2, surface 0 dm² |
| too low | 1,674 | 3 pieces (2 H1), 0 loops, 62 mm tall, plan 3×1, surface 0.79 dm² |

Most common combinations of failures:

| fails | forms |
|---|---:|
| **legal** | 5,057 |
| no flat surface on top · too low | 2,057 |
| sags under its own weight | 1,950 |
| too low | 1,674 |
| sags under its own weight · folds under weight on top | 1,647 |
| no flat surface on top | 1,417 |
| tips too easily · too low | 1,339 |
| sags under its own weight · no flat surface on top | 1,257 |
| folds under weight on top | 1,095 |
| sags under its own weight · folds under weight on top · no flat surface on top | 775 |
| tips too easily · no flat surface on top | 722 |
| tips too easily · sags under its own weight · folds under weight on top | 435 |

## Search

- Seeds: 413 distinct gallery grids (from 3000 draws) and 387 grown trees. Then 20,000 changes (add a disc, take one off, add or remove a slit, graft a branch from another elite, prune a branch).
- 15,414 forms judged by the search in 2800 s (181.7 ms each).
- Ground truth: of the 47 cells the forms of up to 4 discs fall in, the search had reached 24 (51%) with forms of up to 4 discs before they were added.
- Build search budget reached on 0 elites ("no build sequence found" there means "not found in budget").

## Caveats

- "No build sequence found" is not proof none exists: the search tries single discs, clusters beyond a level along an axis, and jointed pairs.
- Bracing follows hinges.ts: slit joints are frictionless hinges, but floor contacts do not slip. Every legal table with 0 loops (a tree) passes only because of that no-slip floor; on a slick floor or under a side push it may fold. That is a finding of the model, and it disagrees with the README, which says a covered design must be a braced grid. Strength is not modelled, and the top only rests.
- One piece per lattice point: two half discs back to back at one point (a full disc in two halves) are not considered.

Files: atlas.json in this folder holds every cell's best legal table and closest near miss (canonical lattice key, build steps, top), and an example of every failure combination. `atlasDesign` in src/slots/atlas/view.ts rebuilds any of them as an engine design for the build scene.
