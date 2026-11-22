# Function spec: what a design is for

Spec for the design site built on the Circular slot kit. The user gives:

1. **Material**: a number of circles and a diameter, or (toggle) the size of the raw sheet.
2. **Purpose**: free text ("coffee table", "shelf for records", "chair").
3. **Stable or not**.

The purpose compiles to a **function spec**: a list of requirements drawn from a small set of reusable
**checks**. "Table", "shelf" and "chair" are combinations of checks, not separate judges. The search (MAP-Elites
with structural novelty, `src/slots/atlas/explore.ts`) uses the spec as its pass bar, and ranks what passes by
novelty. This document defines the checks, the spec format, the purpose library and how text becomes a spec.

## Fixed for the site

| | Value | Why |
|---|---|---|
| Sheet | 1/4 in plywood, 6.35 mm nominal | One material; not a user input. Real sheets run 5.2–6.35 mm, so every cut sheet keeps the slit-fit test strip. |
| Fit | Snug press fit, tapped in with a mallet: slit about 0.1–0.15 mm under the measured sheet | Stiffer joints. The checks still treat slit joints as hinges (friction is not counted on). |
| Exposed slits | **None.** Every slit cut is a slit used (check `closed`). | Finish: no open slots on the made object. |
| Lattice | Planes square to the axes, pitch p from `makeKit` (about 0.52 × diameter) | As in the atlas. A back is therefore upright (90°); nothing reclines. |

All lengths in a spec are millimetres at the user's diameter. The archive is stored in disc units (layers of p);
a spec converts to layers at query time.

## The checks

Each check has a **gate** (pass or fail), and a **score** in [0, 1] for how well it is met: 1 when the target is
met with margin, falling to 0 at the gate. The score is what the "function" side of the function/exploration blend
uses. Every check runs and is recorded, so a near miss says everything it misses.

### 1. `surface`: a level place to put things

Finds every level region a load could rest on, at any height, not only the top.

- **Kinds of surface.**
  - *Fitted board*: a cut-to-fit board seated level on three or more supports off a line (`fittedCover` +
    `findCoverSpot`, as now). Costs sheet material (counts against the sheet in material mode).
  - *Disc*: a flat (horizontal) disc in the structure. Free, but at most π(D/2)², and usually less: the upright
    discs it is slotted onto stick up through it at its joints, so only the part with clear headroom counts.
  - Only the top surface may be a fitted board. Every surface below it is a flat disc: no boards are slid in
    under the top, so the build search needs no new kind of step.
- **Gate.** The surface's height above the floor is within `[minH, maxH]`; its area ≥ `minArea`; its least width
  (`minWidth`) ≥ `minWidth`; and nothing of the design is above it within `headroom` over at least `minArea` of it.
- **Score.** Height within the band (1 at the target, falling to the band's edges), area over the minimum, the share
  of the surface over its supports (`safeFrac`).
- **Reuses.** `fittedCover`, `findCoverSpot`, `minWidth`, `coverReport`. **New**: surfaces below the top, the
  headroom test, flat discs as surfaces.

### 1b. `knee`: room under the top

For dining tables and desks: the headroom test turned upside down.

- **Gate.** A box with nothing of the design in it, from the floor up to `height`, at least `width` wide along
  one edge of the top and reaching `depth` in under it from that edge.
- **Score.** How far the clear box exceeds the minimum, and whether there is one on more than one side (seats on
  both sides of a dining table).

### 2. `stack`: surfaces above one another

For shelves.

- **Gate.** At least `count` surfaces (check 1), each pair one above the next by at least `spacing`, and their
  plans overlapping by at least `overlap` (a share of the smaller one), so it is a shelf unit and not a staircase.
  Set `overlap: 0` to allow stepped shelves.
- **Score.** How many surfaces beyond the minimum, spacing evenness.

### 3. `back`: something to lean on

For chairs and benches with backs.

- **Gate.** For the seat (the surface with role `seat`): upright pieces rise along one side of it, within `offset`
  of its edge, reaching between `minH` and `maxH` above the seat, across at least `width` along that edge. Nothing
  else rises above the seat (headroom on the other sides).
- **Load.** A horizontal push of `pushKg` at the back's top, away from the seat, must neither tip the design nor
  fold a hinge (`groundSupport`, `hingeModes`, with this load added).
- **Score.** Back height in the band, width over the seat width.
- **New.** Everything: the upright region test and the horizontal load case.

### 4. `stands`: it stands on its own

The current atlas gates, unchanged:

- `falls`: tip angle ≥ `minTip` (8° for tables), counting any boards.
- `loose`: no part can drop out.
- `sags`: no hinge mode lowers the centre of mass under its own weight.
- `build`: a group build sequence exists. With a press fit, the sequence prefers steps that engage one or two
  slits at once, and marks steps that need a mallet.

### 5. `holds`: it takes the load it is for

- **Gate.** With `kg` on each surface (at its centre, and at the worst point of its safe area), no hinge folds
  (`folds`) and it does not tip. The current judge loads the top with the design's own weight; a spec gives the
  real load, since a chair's 100 kg does not scale with the disc size.
- **Not yet checked.** Whether the plywood tabs and slit roots are strong enough. That needs a strength check per
  joint at the real size and load. Until it exists the site says plainly that the load is checked for balance,
  not strength (decided).

### 6. `closed`: no exposed slits

Every slit cut into a piece is engaged by another piece's slit.

- **Repair first, then gate.** On the lattice a disc's mouths `m` can include slits nothing joins (the atlas
  ignores these as "spare slits"). Before judging, each full disc is swapped for the kit piece whose slits are
  exactly its joined ones (`pieceOf(a, joinedMask)`): a T with one slit free becomes an L or an I, an L with one
  free becomes a C1. This always succeeds for full discs, since every non-empty subset of a T, L or I is a kit
  piece.
- **Gate.** After the repair, no piece has an unjoined slit or notch. Half discs (H, H1) are fixed pieces and
  cannot be reduced, so an H1 or H with a free slit or notch fails `closed`.
- **Hidden is still exposed.** A slit covered by a board, or otherwise out of sight, still fails: every slit
  cut must be engaged by another piece's slit.
- **Effect on the search.** None on structure: the atlas already counts structures with spare slits ignored, so
  every legal structure has a closed version. The search can still grow from spare slits; the repair runs before
  the judge and the stored form is the closed one. Cut sheets get fewer slits.

### 7. `fits`: material and size

- **Gate.** Pieces ≤ budget, counting a half disc as half a circle. In material mode, the pieces *and* every board
  fit the sheet in `kitSheet.ts`'s layout (square cells one disc plus a gap wide, half discs back-to-back in a
  cell, a board in a block of cells). Plan size ≤ `maxPlan` when the purpose has one.
- **Diameter.** No smaller than the smallest disc a 1/4 in slit leaves enough tab on (to be set by a cut test;
  about 60–80 mm).

## Strict and exploratory

| Check | Stable (strict) | Not stable (exploratory) |
|---|---|---|
| `closed` | gate | gate |
| `fits` | gate | gate |
| `build`, no overlap, connected | gate | gate |
| `surface`, `stack`, `back`, `knee` | gate | scored only; at least one surface of the right role must exist |
| `falls`, `loose`, `sags` | gate | scored only |
| `holds` | gate | scored only |

Each mode has its own archive. The novelty ablation showed novelty must be measured among forms that pass, so
the exploratory archive is searched with its own looser pass bar, not filtered from the strict one.

## The spec format

```ts
interface FunctionSpec {
  purpose: string;               // "chair", as understood
  heard: string[];               // the words that set something, for the UI ("dining" → height 740)
  surfaces: SurfaceReq[];
  stack?: {count: number; spacing: number; overlap: number};
  back?: {seat: string; minH: number; maxH: number; offset: number; width: number; pushKg: number};
  knee?: {height: number; width: number; depth: number; sides: number};
  stands: {minTip: number};
  maxPlan?: [number, number];    // mm
}
interface SurfaceReq {
  role: 'top' | 'seat' | 'shelf';
  count: number;                 // how many surfaces of this kind
  minH: number; maxH: number;    // mm above the floor
  target: number;                // mm; where the score peaks
  minArea: number;               // mm²
  minWidth: number;              // mm
  headroom: number;              // mm clear above
  kg: number;                    // load each must hold
  kinds: ('fitted' | 'disc')[];   // 'fitted' only for the topmost surface
}
```

Material, diameter, piece budget and the stable toggle are not in the spec: they come from the other inputs.

## Purpose library

Starting values, in millimetres. The archive slice is the layers these heights need at the user's diameter.

| Purpose | Surfaces | Other | Load |
|---|---|---|---|
| side table | 1 top, 450–600 (520), ≥ 300 wide | | 15 kg |
| coffee table | 1 top, 380–480 (420), ≥ 400 wide | | 25 kg |
| dining table | 1 top, 720–760 (740), ≥ 750 wide | `knee` 620 high × 500 wide × 350 deep, 2 sides | 50 kg |
| desk | 1 top, 720–760 (740), ≥ 500 deep | `knee` 620 high × 550 wide × 400 deep, 1 side | 40 kg |
| stool | 1 seat, 430–480 (450), ≥ 280 wide, disc or fitted | | 100 kg |
| bench | 1 seat, 420–460 (440), ≥ 800 long, ≥ 280 deep | | 2 × 100 kg |
| plant stand | 1 top, 300–900 (600), ≥ pot diameter (default 250) | | 15 kg |
| shelf | 2+ shelves, top one counts (fitted), lower ones flat discs; ≥ 150 deep, headroom 200 | `stack` spacing ≥ 220, overlap 0.6 | 10 kg each |
| chair | 1 seat, 420–480 (450), ≥ 380 × 380 | `back` 300–450 above seat, offset ≤ 60, width ≥ 0.6 × seat, push 25 kg | 100 kg |

Words modify these: "tall", "low", a number with a unit ("60 cm tall"), a count ("three shelves", "two pots"),
"small", "wide". `src/slots/prompt.ts` already parses sizes, units and counts and has table presets; it gains
shelf, chair, stool and bench, and returns a `FunctionSpec`.

**Text the rules do not know.** An optional LLM step maps it to the nearest purpose plus changes, returning JSON
that is checked against the format above. It never returns geometry. Anything it cannot map becomes the generic
spec: one surface at a height it names, or at 1.5 disc diameters if it names none.

## When the purpose cannot be reached

Before searching, compare the spec with the material:

- **Too low.** The needed height is more layers than the piece budget can stack (a column of n discs reaches
  about n × p). Say so, and give the smallest diameter (or, in material mode, the sheet) that reaches it.
- **Too small.** The surface needs more area than the boards the sheet leaves room for, or a lower shelf needs
  more depth than the clear part of a disc gives. Say so the same way.
- In exploratory mode, still show the nearest forms, labelled with what they miss.

## What the archive maps

The atlas's map axes now are loops, height (layers), plan, surface area, symmetry and distance from an egg crate.
Per purpose:

- tables, stools, plant stands: as now.
- shelf: number of surfaces replaces surface area.
- chair, bench: back height (layers above the seat) replaces symmetry; seat area as surface.

Piece count is added as an axis for every purpose, so the budget is a slice.

## Claude as an advisor

Claude is optional at every point below, and never the last word: anything it proposes is a spec or a design
that goes through the same checks as everything else. It never writes geometry the site shows unchecked.

| When | What Claude does | Output | Checked by |
|---|---|---|---|
| Purpose typed, rules do not understand it | Maps the text to the nearest purpose plus changes ("a stand for my record player" → plant stand, top ≥ 450 × 350, 10 kg) | A `FunctionSpec` as structured JSON, plus the words it acted on | Schema validation; the user sees what was understood and can edit it |
| The purpose cannot be reached | Explains why in plain terms and suggests the smallest change that would work: bigger discs, more pieces, a lower target, or switching to not stable | Suggestions as buttons | Each suggestion is re-run as a query before it is offered |
| Few or no designs found | Proposes seed designs in the agent spec format (`src/slots/agent.ts`: a tree of slit joints or a stacked grid) for the refinement search to start from | 1–5 `DesignSpec`s | `buildDesign` and the function spec, like any other design; failures go back to Claude once with the report |
| The user opens a design and asks | Answers questions about it ("why does this one need a mallet at step 4?", "which piece carries the most load?") from its verdict, metrics and build steps | Text | Nothing to check: it only reads the stored verdict |
| Curating the atlas (optional) | Writes a one-line name and description per design shown ("three-legged stool with a braced ring") | Short text per design | None needed; labels only, the ranking stays λ × function + (1 − λ) × novelty |

Rules for all of these:

- **Calls happen only at those points**, never per form judged in the search. The search runs without Claude.
- **Claude gets the verdict, not the mesh**: piece list, joints, metrics, failures and the spec. These are small
  and exact; it does not need to see renders to reason about them.
- **Model**: Claude Opus 5.5 (`claude-opus-5-5`) through the Anthropic TypeScript SDK, with structured outputs
  for the spec and seed designs, called from the site's server (the key stays off the browser).
- **Failure is quiet**: if a call fails or Claude is off, the site falls back to the rule-based parser and the
  archive alone.

## Decided

- **Loads** as in the purpose library, and the site says loads are checked for balance, not strength, until a
  joint strength check exists.
- **Knee room** for dining tables and desks (check `knee`).
- **No boards below the top.** Lower shelves are flat discs, so a shelf is only as deep as the clear part of a
  disc, and the diameter sets the shelf depth.
- **No exposed slits**, including hidden ones (check `closed`).
- **Claude as an optional advisor** at the points above.
