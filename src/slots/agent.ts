/**
 * Designs specified exactly, piece by piece, by Claude in the agent mode (scripts/kit-agent.ts). Nothing is
 * random: the same spec always builds the same design, so the browser rebuilds exactly what the server checked.
 *
 * A spec is one of:
 *  - a tree of slit joints: the pieces in build order, and for each piece after the first the slit it slides onto
 *    a slit of an earlier piece, and which side of that piece it ends up on. It is then stood on its steadiest face.
 *  - a stacked grid (grids.ts) by its layout: column sites, layer count and bridges per layer; optionally with a
 *    cover on top. A cover only ever rests on a grid: a tree of slit joints folds under a load on top (hinges.ts).
 *
 * buildDesign reports, in words Claude can act on, every problem it finds: a joint that names a slit the piece
 * lacks or one already used, two pieces running into each other, a piece whose slide into place is blocked, and
 * then the full engine checks (assembly, standing, parts held, cover). The report lists where every piece ended
 * up, so symmetric and repeated designs can be checked by eye.
 */
import {childFrame, finishPieces, repose, standUp, weakJoint, type Grown, type Piece} from './kits.js';
import {frameOf, IDENTITY, rotate, rotationBetween} from './kit.js';
import {makePanel, panelVertices} from './panel.js';
import {exitDistance, panelDepth, pathBlocker} from './collide.js';
import {scale, type V3} from './math.js';
import {buildGrid, gridProblem, type Site} from './grids.js';
import {coverGrid, finishItem, gridSheetProblem, planDiameter, type Built, type CoverSpec, type GalleryItem} from './gallery.js';

export const DESIGN_PIECES = ['C1', 'C2L', 'C2I', 'C3T', 'H', 'H1'] as const;
export type DesignPiece = (typeof DESIGN_PIECES)[number];
/** The most pieces a spec may have: the checks grow with the square of the count. */
export const MAX_DESIGN_PIECES = 80;

/** Piece `piece` (numbered from 1, in build order) slides its slit `slit` onto slit `ontoSlit` of an earlier piece. */
export interface TreeJoint {piece: number; onto: number; slit: string; ontoSlit: string; side: 'left' | 'right'}
/** Which as-built axis points up once it stands (piece 1 lies flat at the origin as built), or its steadiest face. */
export const UP_CHOICES = ['steadiest', '+x', '-x', '+y', '-y', '+z', '-z'] as const;
export interface GridBridge {layer: number; from: [number, number]; to: [number, number]}

export interface DesignSpec {
  title: string;
  pieceSizeMm: number;
  sheetMm: number;
  tree?: {pieces: DesignPiece[]; joints: TreeJoint[]; up?: (typeof UP_CHOICES)[number]} | null;
  grid?: {columns: [number, number][]; layers: number; bridges: GridBridge[]} | null;
  cover?: CoverSpec | null;
}

export interface DesignReport {
  ok: boolean;
  stands: boolean;
  pieces: number;
  /** Problems found before the engine checks; when there are any, the design was not checked further. */
  problems: string[];
  /** The engine's checks, once the design builds. */
  checks: {label: string; level: string; detail: string}[];
  text: string;
}

const letter = (k: number) => String.fromCharCode(97 + k);
const mm = (x: number) => Math.round(x);
/** Which way a panel faces, in words: lying flat, or upright with its faces toward an axis. */
function facing(n: number[]): string {
  const a = n.map(Math.abs), k = a.indexOf(Math.max(...a));
  if (a[k] < 0.98) return `tilted, normal (${n.map(x => x.toFixed(2)).join(', ')})`;
  return k === 2 ? 'flat' : `upright, faces ±${'xy'[k]}`;
}

/** A world direction as the nearest axis (±x, ±y, ±z), or its components when it lies between axes. */
function axis(v: number[]): string {
  const a = v.map(Math.abs), k = a.indexOf(Math.max(...a));
  return a[k] > 0.98 ? `${v[k] > 0 ? '+' : '-'}${'xyz'[k]}` : `(${v.map(x => x.toFixed(2)).join(', ')})`;
}

/** Where every piece is (centre, mm), how it faces, and which way each of its free slits opens. */
function placement(g: Grown, byId: Map<string, Piece>): string {
  const used = g.panels.map(() => new Set<number>());
  for (const j of g.joints) { used[j.child].add(j.childSlit); used[j.parent].add(j.parentSlit); }
  return g.panels.map((p, k) => {
    const piece = byId.get(g.types[k]), free = piece ? piece.slits.map((sl, q) => ({q, sl})).filter(({q}) => !used[k].has(q)) : [];
    const opens = free.map(({q, sl}) => `${letter(q)} opens ${axis(scale(rotate(g.X[k], [sl.d[0], sl.d[1], 0]), -1))}`);
    return `  ${k + 1} ${g.types[k]}: centre (${p.frame.o.map(mm).join(', ')}), ${facing(p.frame.n)}${opens.length ? `; free slits: ${opens.join(', ')}` : piece?.slits.length ? '; no free slits' : ''}`;
  }).join('\n');
}

/** Build a tree from its joints, checking each piece against those placed before it. */
function buildTree(pieces: Piece[], spec: NonNullable<DesignSpec['tree']>, t: number): {g: Grown; problems: string[]} {
  const byId = new Map(pieces.map(p => [p.id, p])), problems: string[] = [];
  const kinds = spec.pieces.map((id, k) => byId.get(id) ?? (problems.push(`piece ${k + 1}: no piece "${id}" in the kit`), byId.get('C1')!));
  const first = kinds[0];
  const g: Grown = {types: [first.id], X: [IDENTITY], joints: [], travel: [null], panels: [makePanel(0, '1', 'module', first.outline, frameOf(IDENTITY), t, first.cuts)]};
  const used = kinds.map(() => new Set<number>());
  const byPiece = new Map<number, TreeJoint>();
  for (const j of spec.joints) {
    if (byPiece.has(j.piece)) problems.push(`piece ${j.piece} has two joints; each piece after the first slides onto exactly one earlier piece`);
    byPiece.set(j.piece, j);
  }
  for (let k = 1; k < kinds.length; k++) {
    const j = byPiece.get(k + 1);
    if (!j) { problems.push(`piece ${k + 1} has no joint: say which earlier piece it slides onto`); break; }
    const at = j.onto - 1, Q = kinds[k], P = kinds[at];
    if (!(at >= 0 && at < k)) { problems.push(`piece ${k + 1} slides onto piece ${j.onto}, which is not an earlier piece`); break; }
    const i = j.ontoSlit.charCodeAt(0) - 97, s = j.slit.charCodeAt(0) - 97;
    if (!(i >= 0 && i < P.slits.length)) { problems.push(`piece ${j.onto} (${P.id}) has slits ${P.slits.map((_, q) => letter(q)).join(', ')}; there is no slit ${j.ontoSlit}`); break; }
    if (!(s >= 0 && s < Q.slits.length)) { problems.push(`piece ${k + 1} (${Q.id}) has slits ${Q.slits.map((_, q) => letter(q)).join(', ')}; there is no slit ${j.slit}`); break; }
    if (used[at].has(i)) { problems.push(`slit ${j.ontoSlit} of piece ${j.onto} is already used`); break; }
    if (weakJoint(P, Q)) { problems.push(`piece ${k + 1}: two half discs cannot join notch to notch (the joint barely engages)`); break; }
    used[at].add(i); used[k].add(s);
    const X = childFrame(g.X[at], P, i, Q, s, j.side === 'left' ? Math.PI / 2 : (3 * Math.PI) / 2);
    const panel = makePanel(k, String(k + 1), 'module', Q.outline, frameOf(X), t, Q.cuts);
    const hits = g.panels.map((q, m) => ({m, d: panelDepth(panel, q)})).filter(h => h.d > 0);
    for (const h of hits) problems.push(`piece ${k + 1} runs into piece ${h.m + 1} (${h.d.toFixed(1)} mm deep)`);
    const dir = rotate(g.X[at], [P.slits[i].d[0], P.slits[i].d[1], 0]), back = scale(dir, -1);
    if (!hits.length) {
      const blocker = pathBlocker(panel, scale(back, exitDistance(panel, g.panels, back)), g.panels);
      if (blocker !== null) problems.push(`piece ${k + 1} cannot slide into place: piece ${blocker + 1} is in the way`);
    }
    g.joints.push({child: k, parent: at, childSlit: s, parentSlit: i});
    g.types.push(Q.id); g.X.push(X); g.travel.push(dir); g.panels.push(panel);
  }
  return {g, problems};
}

/** Build and check a spec. The item is the gallery card when it builds (whether or not every check passes). */
export function buildDesign(spec: DesignSpec, clearance = 0.2): {item: GalleryItem | null; report: DesignReport} {
  const size = spec.pieceSizeMm, t = spec.sheetMm, stock = {kit: 'circle' as const, size, t, clearance};
  const pieces = finishPieces('circle', size, t, clearance), byId = new Map(pieces.map(p => [p.id, p]));
  const fail = (problems: string[], g?: Grown): {item: null; report: DesignReport} => ({item: null, report: {ok: false, stands: false, pieces: g?.panels.length ?? 0, problems, checks: [],
    text: `"${spec.title}" does not build:\n${problems.map(p => `- ${p}`).join('\n')}${g ? `\nPieces placed so far (as built, piece 1 lying flat at the origin, mm):\n${placement(g, byId)}` : ''}`}});
  if (!(size >= 40 && size <= 600)) return fail(['pieceSizeMm must be 40 to 600']);
  if (!(t >= 1 && t <= 20)) return fail(['sheetMm must be 1 to 20']);
  if (!!spec.tree === !!spec.grid) return fail(['give either a tree or a grid, not both or neither']);
  if (spec.cover && spec.tree) return fail(['a cover needs a grid: a tree of slit joints folds under weight on top']);
  let built: Built;
  if (spec.tree) {
    if (spec.tree.pieces.length < 2 || spec.tree.pieces.length > MAX_DESIGN_PIECES) return fail([`a tree needs 2 to ${MAX_DESIGN_PIECES} pieces`]);
    const {g, problems} = buildTree(pieces, spec.tree, t);
    if (problems.length) return fail(problems, g);
    // Stand it with the axis asked for pointing up, or on its steadiest face (one with none that stands is laid
    // on the best and marked).
    const up = spec.tree.up ?? 'steadiest';
    if (up === 'steadiest') standUp(g, 'any', undefined, true);
    else {
      const k = 'xyz'.indexOf(up[1]), v: V3 = [0, 0, 0];
      v[k] = up[0] === '+' ? 1 : -1;
      repose(g, rotationBetween(v, [0, 0, 1]));
    }
    built = {g};
  } else {
    const grid = spec.grid!;
    const layout = {sites: grid.columns as Site[], layers: grid.layers, bridges: Array.from({length: grid.layers}, (_, k) => grid.bridges.filter(b => b.layer === k + 1).map(b => [b.from, b.to] as [Site, Site]))};
    const bad = gridProblem(layout) ?? gridSheetProblem(pieces, size, t) ?? (grid.bridges.some(b => !(b.layer >= 1 && b.layer <= grid.layers)) ? 'a bridge names a layer the grid does not have (layers are numbered from 1)' : null);
    if (bad) return fail([bad]);
    const stacked = buildGrid(pieces, layout, t);
    if (!stacked) return fail(['the grid could not be built from the kit pieces']);
    if (stacked.panels.length > MAX_DESIGN_PIECES) return fail([`the grid has ${stacked.panels.length} pieces; at most ${MAX_DESIGN_PIECES}`]);
    if (spec.cover) {
      const covered = coverGrid(stacked, stock, spec.cover);
      if ('why' in covered) return fail([`the cover will not rest: ${covered.why}`], stacked);
      built = covered;
    } else built = {g: stacked, stacked};
  }
  const item = finishItem(built, {...stock, title: spec.title, id: `agent-${spec.title}`, seed: 0, spec: spec.cover ?? undefined});
  if ('why' in item) return fail([item.why], built.g);
  const d = item.design, checks = d.checks.map(c => ({label: c.label, level: c.level, detail: c.detail}));
  const ok = d.ok && item.stands, n = built.g.panels.length;
  const vs = built.g.panels.flatMap(panelVertices), span = (k: number) => mm(Math.max(...vs.map(v => v[k])) - Math.min(...vs.map(v => v[k])));
  const text = [
    `"${spec.title}": ${n} pieces${built.cover ? ' including the cover' : ''}, ${span(0)} × ${span(1)} mm in plan (fits a ${mm(planDiameter(built.g.panels))} mm circle), ${span(2)} mm tall. ${item.stands ? `Stands; tips at ${d.support.tipDeg.toFixed(1)}°.` : 'Does NOT stand on any face: it would need propping.'}`,
    `${ok ? 'Passes every check.' : 'Fails:'}`,
    ...checks.map(c => `- ${c.level === 'ok' ? 'ok' : c.level.toUpperCase()} ${c.label}: ${c.detail}`),
    `Pieces (standing, mm, z up):`,
    placement(built.g, byId),
  ].join('\n');
  return {item, report: {ok, stands: item.stands, pieces: n, problems: [], checks, text}};
}
