# Possible Pieces

A locally runnable procedural construction instrument. React, TypeScript, Vite, Three.js, React Three Fiber and Drei. No external services, accounts or model library.

## Run

Install Node.js 20.19+ (or 22.12+), then in this folder:

```sh
npm install
npm run dev
```

Open the printed localhost URL. `npm run build` creates `dist/`; `npm run preview` serves that build. `npm test` runs the automated geometry tests. A pnpm lockfile is also included for reproducible installation with `pnpm install --frozen-lockfile`.

## Use

Enter toothpick and connector quantities and press Generate. The viewport alone darkens and assembles a numbered connected graph, then becomes a physical object. Drag to orbit, scroll to zoom, right-drag to pan. Pause, skip, replay, switch construction/object view or reset the camera. Select a gallery alternative or regenerate a new collection. Export Design saves the selected graph, seed, millimeter lattice spacing and scores as JSON.

## Physical model

`src/engine/physical.ts` holds configurable dimensions, in millimeters. Rod length is 63.5; diameter 2; connector arm reach 8; outer arm radius 2.8; bore radius 1.15; insertion depth 5. Connector-center spacing is `rodLength + 2 × (armReach − insertionDepth) = 69.5 mm`. The exposed rod is 53.5 mm. The procedural connector has six orthogonal tubular arms, recessed insertion stops, rounded lips and a rounded center. Rods penetrate the bores rather than ending at arbitrary connector centers. All connectors share the same orientation in this prototype.

## Architecture

- `engine/generate.ts`: seeded weighted connected lattice growth; tree plus cycle closure; support-oriented rotations; canonical signatures; descriptor-based diverse selection.
- `engine/validate.ts`: exact counts, lattice positions, unique occupancy, unit axial edges, socket reuse and connectivity. On a unit cubic lattice, distinct unit axial segments cannot intersect internally or pass through another integer lattice vertex. Component radii are much smaller than lattice spacing.
- `engine/scoring.ts`: support convex hull, weighted center of mass, ground contacts, proportions and graph descriptors. These are heuristics, not structural certification.
- `engine/worker.ts`: bounded candidate search off the UI thread; newer requests terminate prior workers.
- `components/Connector.tsx`: shared procedural hollow six-socket geometry.
- `components/Viewer.tsx`: physical rods, construction dots/labels, orbit camera, shadows and camera orientation.
- `components/Thumbnail.tsx`: lightweight isometric SVG previews of the actual graph; the main viewer uses full 3D geometry.

The default search evaluates 650 attempts and selects up to nine unique designs, aiming for seven estimated freestanding and two experimental where the pool permits. For dense or small sets, fewer results may exist or be found. The UI reports this instead of filling slots with duplicates. A finite failed search is reported as search exhaustion, not proof of impossibility. Basic feasibility checks use connectivity and the cubic-lattice edge-isoperimetric upper bound; these are necessary, not sufficient. Max 100 connectors keeps prototype search/memory bounded.

The assembly sequence grows a connected tree before closing loops. It explains graph construction; it does not guarantee a physical insertion order. Some builds require temporary support. Actual friction, joint stiffness, material weights, ground contact deformation and strength are not simulated.

## Design

White page, orange component controls, isolated product illustrations and a neutral studio viewport. Only the viewport darkens during construction. Responsive two-column desktop and stacked mobile layout. No remote fonts or assets. The supplied briefs referenced images that were not included as image attachments; this implementation follows their written specifications.

## Freestanding and shape controls

Freestanding Only defaults on and filters every gallery candidate using the same stability assessment. Turning it off targets a seven/two freestanding/experimental mix when candidates permit. Desired Shape recognizes chair, table, bridge, tree, tower, arch, house, cube and staircase, plus tall, wide, narrow, low, symmetric, asymmetric, branching, dense, open, stepped and spiral modifiers. Unsupported words are reported; this is an extensible rule parser, not arbitrary language understanding. Procedural per-candidate occupancy fields guide lattice growth, and shape scores affect ranking. Shape prompts are visual approximations, not functional furniture. Small budgets retain exact counts and simplify the result; search exhaustion never silently relaxes freestanding filtering.

The assessed orientation is retained for shape objectives; unprompted candidates explore axial resting orientations. The renderer places the floor at the lowest downward socket tip. Ground support uses an eight-point approximation to each downward socket's circular contact rim. Equal connector masses and rods weighing 0.35 connector units yield the projected center of mass. Signed distance to the support hull must exceed the configurable `STABILITY.margin`; a continuous score accounts for clearance, footprint, height, cantilever, loops and leaf joints. Thresholds live in `engine/scoring.ts`. Narrow supports and cantilevers can pass, but friction, elastic buckling, joint rotation and stiffness are only approximated by geometric risk penalties. These estimates are not engineering verification.

`GenerationOptions` carries both counts, freestandingOnly, shapePrompt and seed through the worker. Regenerate reads the same controls and changes only the seed. Each design/export carries shapeSimilarity, stabilityScore and its experimental classification. The bounded seeded attempt count makes identical options reproducible.

## Model comparison

Run the same design brief against Claude Sonnet 5.5, Opus 5.5 and Fable 5.2, then check every answer with this project's own geometry and stability code.

1. Put your Anthropic API key in `.env.local` (gitignored) as `ANTHROPIC_API_KEY=...`, or export it in your shell.
2. Run a brief:

```sh
npm run compare -- briefs/bridge-6in.json
npm run compare -- briefs/bridge-6in.json --dry-run          # print prompts and a cost estimate, call nothing
npm run compare -- briefs/bridge-6in.json --models opus,fable --runs 3
npm run compare -- --prompt "Make me a chair" --max-connectors 20 --freestanding
```

3. Open the comparison page at `/compare/` (linked as **Model comparison** in the generator footer). It shows the brief, a scoreboard and a 3D viewer for each model's design. Pick a saved run from the menu, and click a model to watch its build.

A brief file holds the text sent to the models and the constraints the checker enforces: `maxConnectors`, `maxRods`, `gapMm` and `freestanding`. Every model gets the same system prompt (`systemPrompt()` in `src/engine/compare.ts`), the same effort (`--effort`, default `high`) and the same repair policy. If a design misses the brief, the checker's report goes back to the model for up to `--repairs` more turns (default 2). The table reports first-try and final results separately. Server-side refusal fallbacks are off, so a design is always credited to the model that produced it.

The gap check looks along x and z for the widest band of ground with no contact at any depth and contacts on both sides. Its clear width is `D × 69.5 − 2 × 2.8` mm, where D is the lattice distance across the band. Results are saved to `results/<brief id>/<timestamp>.json`, including the prompt, every turn, token usage and estimated cost at list prices. `npm run check` typechecks the app and the runner.
