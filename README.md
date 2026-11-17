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
