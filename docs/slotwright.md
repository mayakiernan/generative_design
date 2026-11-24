# BrickWright, reviewed, and Slotwright, its slot-kit version

Reviewed: [AvaLovelace1/brickwright](https://github.com/AvaLovelace1/brickwright) at the head of `main` (shallow clone,
2026-11-23): about 18,700 lines of Python source in two packages, plus tests.

## 1. What BrickWright is

BrickWright gets a general coding agent to produce LEGO builds that are physically valid, from a text or image prompt.
Its central idea: **the build is a program, and validity is enforced outside the model.** The agent never emits parts
directly. It edits one file, `build.py`, which defines `create_build()` (returns a `LegoBuild`) and `run_tests()`
(returns check results). A harness runs that file in a fresh process and checks the result. The paper reports
validity rising from 9–69% for bare agents to 100% on 512 prompts, with prompt adherence kept.

Two packages:

| package | role | main parts |
|---|---|---|
| `bricklayer` (~13k lines) | SDK: parts, geometry, checks, I/O | `parts/` catalog and search over the LDraw library; `geometry/` connectors (stud/antistud, pin, axle, clip/bar, ball), FCL collision meshes, directed support graph; `modeling/build.py` `LegoBuild` (add, stack, connect, named sub-models, steps, joints with motion ranges); `construction/` helpers (fills, walls, slopes, minifigures); `io/` LDraw and USD; `docs/compilation.py` builds the API reference from module docstrings |
| `brickwright` (~5k lines) | the agent harness | `driver/loop.py` builder pass and critique loop; `tools/` registry, edit tools, `validate`, `explore`, `render`, `finalize`, `dispatch_subagents`; `record.py` records and snapshots; `cli.py` API mode and an external-agent mode |

### The loop (`driver/loop.py`)

1. The system prompt is short general instructions (`prompts/general_instructions.md`: requirements, the
   `build.py` template, a working method) plus the API reference compiled from bricklayer's docstrings. The
   reference and the code are the same text, so they cannot drift apart.
2. Builder pass: call the model (litellm, so any provider) with the tools; run each tool call; repeat until
   `finalize` succeeds, the model stops, or a budget runs out (turns 200, validations 50, cost $5, unknown cost
   stops at once). A turn cut off at the output limit gets up to three nudges.
3. Tools: `read/write/insert/edit/multi_edit_build`; `validate` (build plus checks, JSON report); `explore` (run a
   snippet against the catalog or the built model; `build` is only built if the snippet reads it, found by walking
   the AST, so catalog lookups still work while `build.py` is broken); `render` (four-view contact sheet, or one
   angle; the image comes back as the next user turn); `finalize` (writes `.ldr`, ends the pass); and optionally
   `dispatch_subagents` (parallel workers in isolated records, on cheaper model tiers, which return text).
4. Critique loop, only for image prompts: a viewpoint agent searches for the camera angle that matches the reference
   photo, then a separate critic compares that render with the photo and returns `{differences, done}`. The builder
   re-enters with the differences, either in the same conversation or a fresh one seeded with the current file.

### Validation (`tools/validation.py`, `tools/testing.py`)

- `build_and_validate` imports the file, builds once, runs `run_tests()`, then runs `check_no_floating` and
  `check_no_collisions` itself and **overrides any custom check of the same name**. The model cannot pass by deleting
  or faking the physical checks; only connectivity is left to `run_tests`, so a scene of separate objects can set
  its own count.
- Collisions: FCL on part meshes with a small inset. Floating: a directed support graph from mated connectors and
  downward-facing surface contacts. Motion: optional sampling of declared joint ranges.
- Every run happens in a spawned child process with a timeout; stdout is captured and capped at 10,000 characters.
- `save_validation` hashes the source before and after, rejects the result if the file changed during
  validation, snapshots source and report, and records the validated hash, so outputs are always tied to a source
  that was actually checked.

### What is good in it

- **Hard checks the model cannot edit.** This is the single biggest reason for the validity numbers.
- **Code as the representation.** Loops, helpers and named sub-models make symmetry and repetition cheap and
  exact; a 300-part build is a 100-line program.
- **Errors that point at the fix.** Every failure names parts and positions (`Brick 2 x 4 @ Position(2, 1, 3)`).
- **Rendering in the loop** plus the rule "do not remove requested features merely to pass checks". Validity
  alone produces safe, dull builds.
- **External-agent mode.** The same tools as CLI subcommands, so Claude Code or Codex can drive it with no API key
  in the harness.
- Docs compiled from docstrings; records with snapshots; strict budgets; careful provider quirks (`completion.py`).

### Weak spots I would watch

- **Text prompts get no independent critic.** The critique loop needs a reference image; for "a lighthouse" the
  builder judges its own renders. A second model looking at the render against the text would catch more.
- **No stability or tipping check** ("sliding and tipping are not checked"). Stud clutch makes this mostly fine
  for LEGO, but a top-heavy model passes.
- **No assembly-order check.** Snapping bricks top-down almost always works; it is not checked.
- `build_and_validate` replaces `create_build` with a function that returns the cached build, so a `run_tests`
  that mutates its build changes what the physical checks see. Rare, and subtle when it happens.
- `explore` runs arbitrary code in a child process with no filesystem isolation (same for `build.py`). Fine
  locally; not for a hosted service.
- Cost control depends on litellm's price data; an unpriced model stops the run.

## 2. From LEGO to the slot kit

Most of BrickWright transfers. What does not is the catalog: LEGO has thousands of parts and many joint types; the
Circular kit has six pieces of one size and one joint (a snug 90° cross slit). That removes the need for catalog
search, `explore` and subagents, and adds physics LEGO never needs.

| BrickWright | Slotwright | note |
|---|---|---|
| `LegoBuild`, `Element(part, color)`, grid `add` | `SlotBuild`, `disc(cell)`, `half(cell, toward)` | lattice cells instead of stud positions |
| stud coupling detected from position | slits inferred from neighbouring cells | see the parity rule below |
| `connect()` for pins, clips, SNOT | none needed | one joint type |
| part catalog and `explore` | none | the piece type follows from the joints |
| `check_no_collisions` | `no_collisions` | SAT on the exact cut shapes (slits included) |
| `check_connected` | `connected` | |
| `check_no_floating` | `stands`, `no_loose`, `braced` | stricter: a slit joint is a hinge and a slit is a slide, so a piece can fall out, a frame can fold, and the whole thing can tip |
| (none) | `buildable` | slot kits must be assembled along slit lines; loops need bench-built groups |
| render via LDraw library | `src/slotwright/render.ts` | dependency-free z-buffer renderer, PNG via `node:zlib` |
| `finalize` → `.ldr` | `finalize` → cut sheet SVG/DXF, assembly guide, renders | through the existing atlas → engine → exporters path |
| image critique, subagents | not built | text prompts only for now |

**The parity rule.** On the form atlas's lattice, a joint between discs at neighbouring cells along axis k needs
both discs square to each other and to k. Starting from one flat disc, that fixes every reachable disc's plane by
the parity of its cell: flat when x, y, z are all even or all odd; facing ±y when x alone differs; facing ±x when y
alone differs; and no disc can sit where z alone differs. Two consequences make the SDK simple: any two discs in
neighbouring cells are necessarily slotted together (they would otherwise interpenetrate), and a disc can only have
neighbours in its own plane. So, as with LEGO studs, joints come from position alone; each disc's slits are exactly
its joints, and its kit piece (C1, C2L, C2I, C3T) follows. No slit is ever left open, which also meets the design
site's rule. A test checks the rule over a 7 × 7 × 7 block.

## 3. What was built

- `src/slotwright/sdk.ts`: `SlotBuild`, slit inference, `hardChecks` (built from the atlas primitives:
  `overlaps`, `connected`, `findAssembly`, `groundSupport`, `looseDiscs`, `hingeModes`), `Model` and `Tests` for
  the build's own checks.
- `src/slotwright/render.ts`: renderer and contact sheet.
- `src/slotwright/INSTRUCTIONS.md`: the model's instructions (kit, grid, SDK, requirements, working method); also
  printed by `instructions` for external agents.
- `scripts/slotwright/`: `record.ts` (records under `slotwright-runs/`), `ops.ts` (validate, render, finalize),
  `worker.ts` and `run.ts` (child process with timeout), `png.ts`, `agent.ts` (the Claude loop).
- `scripts/slotwright.ts`: the CLI, `npm run slotwright`.
- Tests: `src/slots/slotwright.test.ts`, `scripts/slotwright.test.ts`.

## 4. First runs

- **"make a car"** (Claude Opus 5.5, effort high): finalized in 5 turns, 2 validations, 2 renders, 114 s, $0.34.
  29 pieces (6 C1, 8 C2L, 7 C2I, 8 C3T), 371 × 246 × 163 mm from 80 mm discs and 3 mm sheet: two red side rails
  joined by cross pieces, a hood, four black wheels hung from fender discs, and a blue cabin with a flat roof. It
  added its own checks (four wheels, only wheels on the floor, longer than 1.4 × its width, cabin highest). The
  engine's independent verdict at finalize (`evaluate`, in `out/design.json`) agrees: no interference, panels
  intact, a group build sequence of 25 steps, tips at 46.6°, all parts held.
- **"make a giraffe"** (run after the instructions' examples were made object-neutral): finalized in 8 turns,
  6 validations, 3 renders, 281 s, $0.83. 30 pieces, about 50 cm tall: four legs on dark hooves, a short spine, a
  neck rising from the shoulders, a head facing forward with dark ossicones, painted tan with brown spots. It tried
  crossbars between the legs to brace them, then found by validating that the hooves on the floor brace it, and
  spent the freed pieces on a longer neck. The engine's verdict agrees. Like the car's wheels, its four hooves hang
  from vertical slits and drop out when it is lifted.
- **The car is a sculpture of a car.** The wheels do not turn, and each hangs from a vertical slit that opens upward, so
  **all four wheels drop out when it is picked up** (the hold test with nothing grounded; the same is true of the
  hand-built car). The checks judge it standing on the floor, as the kit gallery does. A wheel joined along a
  horizontal slit line to a flat rail at its own height would stay on; a `lifts` check for things meant to be
  picked up would push the agent there.

## 5. Limits and next steps

- **Lattice only.** The rule-free atlas's placements (pieces resting on others, clipped onto plain edges, off
  pitch) would allow far more shapes; they are not in the SDK yet.
- **No notched half disc (H) and no cut-to-fit top.** Tables, chairs and shelves need a surface; the atlas's
  `fittedCover` and the judge's surface checks could be exposed as `b.top()` with a load check.
- **At most 30 pieces**, the assembly search's bitmask limit.
- **One disc size.** Representation is necessarily abstract; that is the medium.
- **No independent critic for text prompts**, the gap noted in BrickWright too. A cheap second model shown the
  plain render and the prompt, asked "what is this?", would be a good stop condition.
- **Lifting.** Add an optional `lifts` check (nothing drops out with nothing grounded) for toys and vehicles.
- **Slot Studio agent mode** (added 2026-11-23): the Atlas page has an Atlas search / Agent switch. The browser runs
  the loop and the model's code (Web Worker); `/api/slotwright` makes one Claude call per turn. The first attempt at
  high effort spent 37k output tokens (about 7 minutes) thinking before its first draft, too long for a 300 s
  function, so studio turns run at medium effort with a note to draft early: the next car took 52 s and 5 turns
  (turns of 2 to 36 s), about $0.21.
- The first live run froze the page. The finished design was built on the main thread, and for a car with
  half-disc hood and trunk the engine's assembly planner (`src/slots/plan.ts`, `liftUnit`) recursed forever: two
  height levels within its 1 mm tolerance made the "unit above" every remaining piece. Fixed there (a unit must
  leave a piece behind; regression test added), and the finished design is now built in the worker. When Claude
  ends with a summary instead of calling finalize, the page finalizes a build that last validated ok, or asks it to
  keep going (twice at most).
- The site's "Designed by Opus" kit-gallery mode does a similar job with JSON specs and text-only reports; it could
  move to Slotwright's code, renders and checks.
