# Form atlas: Circular slot-kit tables

2026-11-22 · 80 mm discs, 3 mm sheet, lattice pitch 41.6 mm · seed 1 · 165,792 forms judged in 1533 s.

A **legal table** has a level surface on top (the top is cut to fit; at least three supports off a line), at least 120 mm up; stands as built and tips only past 8°; no part can drop out; no slit joint can swing under its own weight or under weight on top; a group build sequence exists; at most 30 pieces (the top not counted). Half discs are in: H1 sits on the lattice like a one-slit disc; an H sits with its notch line through a lattice point, and is never joined notch to notch with another H.

## How many forms there are

Every connected, overlap-free arrangement of kit pieces (full and half discs), counted once however it is turned or mirrored about the vertical:

| pieces | forms | legal tables |
|---:|---:|---:|
| 1 | 22 | 0 |
| 2 | 116 | 0 |
| 3 | 955 | 0 |
| 4 | 10,363 | 0 |
| 5 | 138,608 | 0 |

Each disc multiplies the count by about 13, so at 30 discs there are on the order of 10^33 forms: they can only be sampled. The rest of this atlas is a map of that space by form, filled by search.

## Legal tables

- 4,584 legal tables found: 3,743 distinct structures (ignoring spare slits), 3,471 of them not an egg-crate grid layout of any size. They fill 697 of the 2363 cells of the map.
- Fewest pieces: 9.
- Legal tables using half discs: 3,042 of 4,584.
- Loops of joints: legal egg crates 0–6; other legal tables 0–5. A tree (0 loops) can pass only because the floor is modelled as no-slip (see Caveats).

| loops | cells with a legal egg crate | cells with another legal table |
|---|---:|---:|
| 0 | 17 | 241 |
| 1 | 19 | 229 |
| 2 | 15 | 93 |
| 3 | 14 | 46 |
| 4–6 | 10 | 13 |

- loops 0 · height 3 · plan 10×10 · surface 1–2 discs · sym 1 · very far: 26 pieces (3 H), 0 loops, 125 mm tall, plan 10×10, surface 0.89 dm²
- loops 0 · height 3 · plan 10×2 · surface 1–2 discs · sym 1 · very far: 18 pieces (1 H, 1 H1), 0 loops, 125 mm tall, plan 10×2, surface 0.89 dm²
- loops 0 · height 3 · plan 10×3 · surface 2–4 discs · sym 1 · very far: 22 pieces (2 H1), 0 loops, 125 mm tall, plan 10×3, surface 1.38 dm²
- loops 0 · height 3 · plan 10×4 · surface 1–2 discs · sym 1 · very far: 22 pieces (2 H1), 0 loops, 125 mm tall, plan 10×4, surface 0.87 dm²
- loops 0 · height 3 · plan 10×4 · surface 2–4 discs · sym 1 · very far: 24 pieces (3 H1), 0 loops, 125 mm tall, plan 10×4, surface 1.38 dm²
- loops 0 · height 3 · plan 10×4 · surface 4+ discs · sym 1 · very far: 26 pieces (3 H1), 0 loops, 125 mm tall, plan 10×4, surface 2.24 dm²
- loops 0 · height 3 · plan 10×5 · surface 1–2 discs · sym 1 · very far: 22 pieces (2 H), 0 loops, 125 mm tall, plan 10×5, surface 0.89 dm²
- loops 0 · height 3 · plan 10×6 · surface 1–2 discs · sym 1 · very far: 22 pieces, 0 loops, 125 mm tall, plan 10×6, surface 0.89 dm²
- loops 0 · height 3 · plan 10×6 · surface 2–4 discs · sym 1 · very far: 22 pieces (1 H1), 0 loops, 125 mm tall, plan 10×6, surface 1.38 dm²
- loops 0 · height 3 · plan 10×6 · surface 4+ discs · sym 1 · very far: 23 pieces (1 H1), 0 loops, 125 mm tall, plan 10×6, surface 2.29 dm²
- loops 0 · height 3 · plan 10×7 · surface 1–2 discs · sym 1 · very far: 23 pieces (1 H), 0 loops, 125 mm tall, plan 10×7, surface 0.89 dm²
- loops 0 · height 3 · plan 10×7 · surface 2–4 discs · sym 1 · very far: 25 pieces (2 H), 0 loops, 125 mm tall, plan 10×7, surface 1.74 dm²

## Structural novelty

Ranked by **novel** (each cell keeps the structure least like the legal tables seen); parents seven times in ten the most novel of four legal tables, else from a uniform cell; grafts and prunes on; rare-motif discs off.

A structure's fingerprint counts its joint motifs (Weisfeiler–Lehman, two rounds); novelty is the mean fingerprint distance to the 15 most similar legal tables, distance from an egg crate the distance to the nearest gallery grid's fingerprint (two different grids are typically about 0.5 apart).

| distance from an egg crate | legal structures |
|---|---:|
| egg crate | 272 |
| close | 1 |
| apart | 152 |
| far | 912 |
| very far | 2,406 |

- Distinct two-step joint motifs across all legal tables: 4,327.
- Legal tables that are not egg crates: median distance from an egg crate 0.89.

Most novel legal tables (one per cell):

- novelty 0.93, very far from an egg crate (1.13): 13 pieces (1 H), 0 loops, 125 mm tall, plan 5×5, surface 0.69 dm²
- novelty 0.93, very far from an egg crate (1.09): 13 pieces (1 H), 0 loops, 125 mm tall, plan 7×2, surface 0.69 dm²
- novelty 0.91, very far from an egg crate (1.13): 13 pieces (1 H, 1 H1), 0 loops, 125 mm tall, plan 6×3, surface 0.69 dm²
- novelty 0.89, very far from an egg crate (1.06): 20 pieces (4 H, 1 H1), 1 loops, 125 mm tall, plan 7×4, surface 0.69 dm²
- novelty 0.89, very far from an egg crate (1.10): 20 pieces (2 H), 2 loops, 125 mm tall, plan 7×5, surface 0.73 dm²
- novelty 0.88, very far from an egg crate (1.13): 15 pieces (1 H), 0 loops, 125 mm tall, plan 6×5, surface 0.89 dm²
- novelty 0.88, very far from an egg crate (1.16): 12 pieces (1 H), 0 loops, 125 mm tall, plan 6×2, surface 0.69 dm²
- novelty 0.87, very far from an egg crate (1.18): 13 pieces (1 H, 1 H1), 0 loops, 125 mm tall, plan 5×4, surface 0.69 dm²
- novelty 0.87, very far from an egg crate (1.14): 17 pieces (2 H, 1 H1), 0 loops, 125 mm tall, plan 7×5, surface 1.22 dm²
- novelty 0.87, very far from an egg crate (0.98): 18 pieces (2 H), 0 loops, 166 mm tall, plan 6×3, surface 0.89 dm²

## Near misses

Forms that fail exactly one check:

| only fails | forms | best example |
|---|---:|---|
| tips too easily | 205 | 18 pieces (1 H), 3 loops, 166 mm tall, plan 4×4, surface 0.89 dm² |
| a part can drop out | 237 | 17 pieces (1 H), 1 loops, 125 mm tall, plan 5×5, surface 1.08 dm² |
| sags under its own weight | 2,532 | 9 pieces, 0 loops, 125 mm tall, plan 3×3, surface 0.73 dm² |
| folds under weight on top | 640 | 10 pieces (1 H), 0 loops, 125 mm tall, plan 4×2, surface 0.89 dm² |
| no flat surface on top | 2,169 | 6 pieces (1 H), 0 loops, 121 mm tall, plan 3×2, surface 0 dm² |
| too low | 316 | 1 pieces (1 H1), 0 loops, 6 mm tall, plan 1×1, surface 0.79 dm² |

Most common combinations of failures:

| fails | forms |
|---|---:|
| tips too easily · sags under its own weight · folds under weight on top · no flat surface on top | 54,883 |
| tips too easily · sags under its own weight · no flat surface on top | 34,410 |
| tips too easily · no flat surface on top | 13,809 |
| tips too easily · sags under its own weight · folds under weight on top · no flat surface on top · too low | 8,490 |
| tips too easily · a part can drop out · sags under its own weight · folds under weight on top · no flat surface on top | 7,480 |
| tips too easily · a part can drop out · sags under its own weight · no flat surface on top · too low | 6,616 |
| tips too easily · sags under its own weight · no flat surface on top · too low | 5,941 |
| **legal** | 4,584 |
| tips too easily · a part can drop out · sags under its own weight · no flat surface on top | 4,185 |
| tips too easily · a part can drop out · sags under its own weight · folds under weight on top · no flat surface on top · too low | 4,097 |
| sags under its own weight | 2,532 |
| no flat surface on top | 2,169 |

## Search

- Seeds: 413 distinct gallery grids (from 3000 draws) and 362 grown trees. Then 20,000 changes (add a disc, take one off, add or remove a slit, graft a branch from another elite, prune a branch).
- 15,841 forms judged by the search in 203 s (12.8 ms each).
- Ground truth: of the 111 cells the forms of up to 5 discs fall in, the search had reached 37 (33%) with forms of up to 5 discs before they were added.
- Build search budget reached on 0 elites ("no build sequence found" there means "not found in budget").

## Caveats

- "No build sequence found" is not proof none exists: the search tries single discs, clusters beyond a level along an axis, and jointed pairs.
- Bracing follows hinges.ts: slit joints are frictionless hinges, but floor contacts do not slip. Every legal table with 0 loops (a tree) passes only because of that no-slip floor; on a slick floor or under a side push it may fold. That is a finding of the model, and it disagrees with the README, which says a covered design must be a braced grid. Strength is not modelled, and the top only rests.
- One piece per lattice point: two half discs back to back at one point (a full disc in two halves) are not considered.

Files: atlas.json in this folder holds every cell's best legal table and closest near miss (canonical lattice key, build steps, top), and an example of every failure combination. `atlasDesign` in src/slots/atlas/view.ts rebuilds any of them as an engine design for the build scene.
