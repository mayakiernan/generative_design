/**
 * Stacked grids (circle kit): what you would build by hand to make a table from discs.
 *
 * Columns of discs stand on a square lattice 2p apart, p being the distance between the centres of two crossed
 * discs. Layer k sits p higher than layer k − 1. In each layer every column disc stands in one vertical plane, and
 * flat discs bridge neighbouring columns along that plane; the next layer turns 90°, its column discs crossing the
 * ones below on vertical slit lines. A layer is a tree, so it goes together piece by piece on the bench; it is then
 * lowered onto the layer below as one unit, every joint between the two sliding straight down together, the way an
 * egg crate goes together. That closes loops of joints through the columns, which is what braces the grid (see
 * hinges.ts): a tree of slit joints is always a mechanism.
 *
 * Slit budget. A column disc needs a slit down (if a layer is below), a slit up (if a layer is above) and one per
 * bridge, at most three in all; the circle kit's pieces cover every such set (C1, C2L, C2I, C3T).
 */
import {childFrame, type Grown, type Piece, type Steer} from './kits.js';
import {frameOf, IDENTITY, type Xf} from './kit.js';
import {makePanel, type Frame} from './panel.js';
import {cross, type Rng, type V3} from './math.js';

export interface StackStep {
  /** Pieces placed in this step: one, or a whole layer lowered as a unit. */
  pieces: number[];
  /** Direction they move, world. */
  travel: V3;
  /** Lowered as a unit after being built raised on the bench. */
  unit: boolean;
  text: string;
}

export interface Stacked extends Grown {steps: StackStep[]; columns: number; layers: number}

export type Site = [number, number];
const key = (s: Site) => `${s[0]},${s[1]}`;

/** A frame putting `piece` at `o` in the plane of axes a, b so its slit mouths point exactly along `mouths`. */
function frameFor(piece: Piece, o: V3, a: V3, b: V3, mouths: V3[]): Frame | null {
  const dirs = piece.slits.map(s => { const l = Math.hypot(s.e[0], s.e[1]); return [s.e[0] / l, s.e[1] / l]; });
  const same = (x: V3, y: V3) => Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]) < 1e-9;
  const neg = (x: V3): V3 => [-x[0], -x[1], -x[2]];
  for (const u of [a, neg(a), b, neg(b)]) for (const v of [a, neg(a), b, neg(b)]) {
    if (Math.abs(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) > 1e-9) continue;
    const world = dirs.map(([x, y]) => [u[0] * x + v[0] * y, u[1] * x + v[1] * y, u[2] * x + v[2] * y] as V3);
    if (world.length === mouths.length && mouths.every(m => world.some(w => same(w, m)))) return {o, u, v, n: cross(u, v)};
  }
  return null;
}

const xfOf = (f: Frame): Xf => ({R: [f.u[0], f.v[0], f.n[0], f.u[1], f.v[1], f.n[1], f.u[2], f.v[2], f.n[2]], t: f.o});

/** Which kit piece has exactly these slit mouths (unit axis directions in one plane). */
function pieceFor(by: Map<string, Piece>, mouths: V3[]): Piece | null {
  const opposite = mouths.length === 2 && mouths[0].every((x, k) => Math.abs(x + mouths[1][k]) < 1e-9);
  const id = mouths.length === 1 ? 'C1' : mouths.length === 2 ? (opposite ? 'C2I' : 'C2L') : mouths.length === 3 ? 'C3T' : null;
  return id ? by.get(id) ?? null : null;
}

const shuffle = <T,>(r: Rng, xs: T[]): T[] => {
  const out = xs.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(r.next() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};

function edgeConnected(sites: Site[]): boolean {
  const has = new Set(sites.map(key)), seen = new Set([key(sites[0])]), todo = [sites[0]];
  while (todo.length) {
    const [i, j] = todo.pop()!;
    for (const n of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]] as Site[]) if (has.has(key(n)) && !seen.has(key(n))) { seen.add(key(n)); todo.push(n); }
  }
  return seen.size === sites.length;
}

const collinear = (sites: Site[]) => sites.every(s => s[0] === sites[0][0]) || sites.every(s => s[1] === sites[0][1]);

/** A grid's columns (lattice sites), layer count and, per layer, the pairs of neighbouring columns bridged. */
export interface GridLayout {sites: Site[]; layers: number; bridges: [Site, Site][][]}
interface Config extends GridLayout {total: number}

/**
 * Why a layout cannot be built, or null. Bridges in even layers (counting from 0) join columns one step apart along
 * x, odd layers along y; each column disc has at most three slits (down, up, one per bridge); every column must be
 * tied to the rest by some bridge; and the columns must not all stand in one line.
 */
export function gridProblem(layout: GridLayout, ok: (id: string) => boolean = () => true): string | null {
  const {sites, layers, bridges} = layout;
  if (sites.length < 3) return 'a grid needs at least three columns';
  if (new Set(sites.map(key)).size !== sites.length) return 'two columns share a site';
  if (collinear(sites)) return 'the columns all stand in one line: a top needs three off a line';
  if (!(layers >= 2 && layers <= 8 && Number.isInteger(layers))) return 'a grid needs 2 to 8 layers';
  if (bridges.length !== layers) return `give one bridge list per layer (${layers}), even if empty`;
  const has = new Set(sites.map(key));
  for (let k = 0; k < layers; k++) for (const [a, b] of bridges[k]) {
    const step: Site = k % 2 === 0 ? [1, 0] : [0, 1];
    if (!has.has(key(a)) || !has.has(key(b))) return `layer ${k + 1}: bridge ${key(a)} to ${key(b)} names a site with no column`;
    if (!((b[0] - a[0] === step[0] && b[1] - a[1] === step[1]) || (a[0] - b[0] === step[0] && a[1] - b[1] === step[1]))) return `layer ${k + 1}: bridges in this layer join neighbours along ${k % 2 === 0 ? 'x' : 'y'}, and ${key(a)} to ${key(b)} does not`;
  }
  for (let k = 0; k < layers; k++) for (const s of sites) {
    const n = (k > 0 ? 1 : 0) + (k < layers - 1 ? 1 : 0) + bridges[k].filter(([a, b]) => key(a) === key(s) || key(b) === key(s)).length;
    if (n > 3) return `layer ${k + 1}: the column at ${key(s)} would need ${n} slits (down, up and one per bridge), more than a disc has`;
    if (n === 0) return `layer ${k + 1}: the column at ${key(s)} joins nothing`;
    if (!ok(n === 1 ? 'C1' : n === 3 ? 'C3T' : 'C2I')) return `layer ${k + 1}: the column at ${key(s)} needs a piece the recipe leaves out`;
  }
  const parent = new Map(sites.map(s => [key(s), key(s)]));
  const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
  for (const layer of bridges) for (const [a, b] of layer) parent.set(find(key(a)), find(key(b)));
  if (new Set(sites.map(s => find(key(s)))).size > 1) return 'every column must be tied to the rest by a bridge in some layer';
  return null;
}

/** A random column layout, layer count and set of bridges, with roughly `count` pieces. */
function pickConfig(r: Rng, count: number, ok: (id: string) => boolean, layerChoices: number[]): Config | null {
  const tolerance = Math.max(3, Math.round(0.25 * count));
  for (let attempt = 0; attempt < 200; attempt++) {
    // Column layout: a 2×2 to 3×3 block with up to a few sites left out (L, T, S, U and plus shapes), as long as
    // the columns stay edge-connected and not all in one line (the cover needs three tops off a line).
    const nx = r.pick([2, 2, 3]), ny = r.pick([2, 3]);
    let sites: Site[] = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) sites.push([i, j]);
    for (let drop = r.pick([0, 0, 1, 1, 2, 4]); drop > 0 && sites.length > 3; drop--) {
      const gone = r.pick(sites), rest = sites.filter(x => x !== gone);
      if (edgeConnected(rest) && !collinear(rest)) sites = rest;
    }
    const layers = r.pick(layerChoices), has = new Set(sites.map(key));
    if (layers * sites.length > 30) continue;
    const bridges: [Site, Site][][] = [];
    let total = layers * sites.length;
    const q = r.range(0.55, 1);
    for (let k = 0; k < layers; k++) {
      const budget = 3 - (k > 0 ? 1 : 0) - (k < layers - 1 ? 1 : 0), used = new Map<string, number>();
      const step: Site = k % 2 === 0 ? [1, 0] : [0, 1];
      const pairs = shuffle(r, sites.map(s => [s, [s[0] + step[0], s[1] + step[1]]] as [Site, Site]).filter(([, b]) => has.has(key(b))));
      const chosen: [Site, Site][] = [];
      for (const [a, b] of pairs) {
        if ((used.get(key(a)) ?? 0) >= budget || (used.get(key(b)) ?? 0) >= budget) continue;
        if (chosen.length && r.next() > q) continue;
        chosen.push([a, b]);
        used.set(key(a), (used.get(key(a)) ?? 0) + 1); used.set(key(b), (used.get(key(b)) ?? 0) + 1);
      }
      bridges.push(chosen);
      total += chosen.length;
    }
    if (total > 30) continue;
    // Every column must be tied to the rest by some bridge, in some layer.
    const parent = new Map(sites.map(s => [key(s), key(s)]));
    const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
    for (const layer of bridges) for (const [a, b] of layer) parent.set(find(key(a)), find(key(b)));
    if (new Set(sites.map(s => find(key(s)))).size > 1) continue;
    const needs = new Set(['C2I']);
    for (let k = 0; k < layers; k++) for (const s of sites) {
      const n = (k > 0 ? 1 : 0) + (k < layers - 1 ? 1 : 0) + bridges[k].filter(([a, b]) => key(a) === key(s) || key(b) === key(s)).length;
      needs.add(n === 1 ? 'C1' : n === 3 ? 'C3T' : 'C2*');
    }
    if (![...needs].every(id => id === 'C2*' ? ok('C2I') || ok('C2L') : ok(id))) continue;
    // Any layout within a quarter of the count will do: taking the closest every time shows the same few.
    if (Math.abs(total - count) <= tolerance) return {sites, layers, bridges, total};
  }
  return null;
}

interface Spec {piece: Piece; frame: Frame; layer: number; site?: string}

/** The slit of `sp` whose mouth points along m (world), or −1. */
function slitTo(sp: Spec, m: V3): number {
  const f = sp.frame;
  return sp.piece.slits.findIndex(sl => {
    const l = Math.hypot(sl.e[0], sl.e[1]), x = sl.e[0] / l, y = sl.e[1] / l;
    return [0, 1, 2].every(k => Math.abs(f.u[k] * x + f.v[k] * y - m[k]) < 1e-9);
  });
}

/**
 * The thickest sheet a grid of these discs allows. A bridge disc lies flat at its columns' centre height; the next
 * layer's column disc, crossing the column above, reaches down to p − R above that height (p: centre spacing of
 * crossed discs, R: radius), right beside the bridge's slit. The bridge's top face, half a sheet up, must stay under
 * it: t ≤ 2(p − R). With slits half the radius deep (less a little) that is about 0.04 × the disc size, so a grid
 * needs discs at least 25 sheet thicknesses across.
 */
export function gridMaxSheet(pieces: Piece[]): number {
  const C2I = pieces.find(p => p.id === 'C2I');
  if (!C2I) return 0;
  const p = Math.hypot(...frameOf(childFrame(IDENTITY, C2I, 0, C2I, 0, Math.PI / 2)).o), R = Math.max(...C2I.outline.map(q => Math.hypot(q[0], q[1])));
  return 2 * (p - R);
}

/**
 * Build a stacked grid of about `count` pieces from the circle kit, or null if the kit or weights rule it out.
 * `layerChoices`: layer counts drawn from (repeats weight them); fewer layers spread the same pieces wider.
 */
export function growStacked(pieces: Piece[], count: number, t: number, r: Rng, steer: Steer = {}, layerChoices = [2, 3, 3, 4]): Stacked | null {
  const by = new Map(pieces.filter(p => (steer.weights?.[p.id] ?? 1) > 0).map(p => [p.id, p]));
  if (!by.has('C2I')) return null;
  const cfg = pickConfig(r, count, id => by.has(id), layerChoices);
  return cfg && buildGrid(pieces, cfg, t, steer);
}

/** Build the grid a layout describes (check it with gridProblem first), numbered in build order with its steps. */
export function buildGrid(pieces: Piece[], cfg: GridLayout, t: number, steer: Steer = {}): Stacked | null {
  const by = new Map(pieces.filter(p => (steer.weights?.[p.id] ?? 1) > 0).map(p => [p.id, p]));
  const C2I = pieces.find(p => p.id === 'C2I');
  if (!C2I || !by.has('C2I')) return null;
  const p = Math.hypot(...frameOf(childFrame(IDENTITY, C2I, 0, C2I, 0, Math.PI / 2)).o);
  const R = Math.max(...C2I.outline.map(q => Math.hypot(q[0], q[1])));
  const X: V3 = [1, 0, 0], Y: V3 = [0, 1, 0], Z: V3 = [0, 0, 1], neg = (v: V3): V3 => [-v[0], -v[1], -v[2]];
  const specs: Spec[] = [];
  const spec = (o: V3, a: V3, b: V3, mouths: V3[], layer: number, site?: string) => {
    const piece = pieceFor(by, mouths), frame = piece && frameFor(piece, o, a, b, mouths);
    if (!piece || !frame) return -1;
    specs.push({piece, frame, layer, site});
    return specs.length - 1;
  };
  // Build plan in spec indices: per layer, units; per unit, pieces in order with the piece each slides onto.
  type Move = {s: number; onto: number; dir: V3};
  const plan: {layer: number; units: Move[][]}[] = [];
  const colAt: Map<string, number>[] = [];
  for (let k = 0; k < cfg.layers; k++) {
    const z = R + k * p, along = k % 2 === 0 ? X : Y, top = k === cfg.layers - 1, bridges = cfg.bridges[k];
    const col = new Map<string, number>();
    for (const st of cfg.sites) {
      const mouths: V3[] = [];
      if (k > 0) mouths.push(neg(Z));
      if (!top) mouths.push(Z);
      for (const [a, b] of bridges) { if (key(a) === key(st)) mouths.push(along); if (key(b) === key(st)) mouths.push(neg(along)); }
      const i = spec([2 * p * st[0], 2 * p * st[1], z], along, Z, mouths, k, key(st));
      if (i < 0) return null;
      col.set(key(st), i);
    }
    colAt.push(col);
    const flats = bridges.map(([a, b]) => ({i: spec([2 * p * a[0] + p * along[0], 2 * p * a[1] + p * along[1], z], X, Y, [neg(along), along], k), a: col.get(key(a))!, b: col.get(key(b))!}));
    if (flats.some(f => f.i < 0)) return null;
    // Units: columns joined by this layer's bridges. Each is a path, built from one column outward.
    const left = new Set(cfg.sites.map(st => col.get(key(st))!)), units: Move[][] = [];
    while (left.size) {
      const first = left.values().next().value as number, unit: Move[] = [{s: first, onto: -1, dir: [0, 0, -1]}];
      left.delete(first);
      for (let n = 0; n < unit.length; n++) for (const f of flats) {
        const here = unit[n].s, other = f.a === here ? f.b : f.b === here ? f.a : -1;
        if (other < 0 || unit.some(m => m.s === f.i)) continue;
        const toHere = f.a === here ? neg(along) : along; // the way the flat slides to reach `here`
        unit.push({s: f.i, onto: here, dir: toHere}, {s: other, onto: f.i, dir: toHere});
        left.delete(other);
      }
      units.push(unit);
    }
    plan.push({layer: k, units});
  }
  // Number the pieces in build order.
  const order = plan.flatMap(l => l.units.flatMap(u => u.map(m => m.s))), id = new Map(order.map((s, n) => [s, n]));
  const g: Stacked = {types: [], X: [], joints: [], travel: [], panels: [], steps: [], columns: cfg.sites.length, layers: cfg.layers};
  for (const s of order) {
    const sp = specs[s], n = id.get(s)!;
    g.types.push(sp.piece.id); g.X.push(xfOf(sp.frame)); g.travel.push(null);
    g.panels.push(makePanel(n, String(n + 1), 'module', sp.piece.outline, sp.frame, t, sp.piece.cuts));
  }
  const L = (k: number) => String.fromCharCode(97 + k), num = (s: number) => id.get(s)! + 1, name = (s: number) => specs[s].piece.name.toLowerCase();
  for (const {layer: k, units} of plan) {
    for (const unit of units) {
      const lifted = k > 0;
      // A lone disc needs no bench: it is simply lowered onto the column below.
      for (const m of lifted && unit.length === 1 ? [] : unit) {
        const sp = specs[m.s];
        let text: string;
        if (m.onto < 0) {
          text = lifted
            ? `Layer ${k + 1}, built on the bench: hold piece ${num(m.s)} (${name(m.s)}) upright with slit ${L(slitTo(sp, neg(Z)))} facing down.`
            : unit === units[0]
              ? `Bottom layer: stand piece ${num(m.s)} (${name(m.s)}) on its rim with slit ${L(slitTo(sp, Z))} facing up, and prop it upright (a helper, or a book either side). The bottom layer only stands by itself once layer 2 crosses it.`
              : `Stand piece ${num(m.s)} (${name(m.s)}) on its rim with slit ${L(slitTo(sp, Z))} facing up, propped like piece ${num(units[0][0].s)}.`;
        } else {
          const cs = slitTo(sp, m.dir), ps = slitTo(specs[m.onto], neg(m.dir));
          g.joints.push({child: id.get(m.s)!, parent: id.get(m.onto)!, childSlit: cs, parentSlit: ps});
          g.travel[id.get(m.s)!] = m.dir;
          text = `Piece ${num(m.s)} (${name(m.s)}): slit ${L(cs)} onto slit ${L(ps)} of piece ${num(m.onto)}.`;
        }
        g.steps.push({pieces: [id.get(m.s)!], travel: m.onto < 0 ? [0, 0, -1] : m.dir, unit: false, text});
      }
      if (!lifted) continue;
      const discs = unit.filter(m => specs[m.s].site !== undefined).map(m => m.s);
      const lows = discs.map(s => colAt[k - 1].get(specs[s].site!)!);
      discs.forEach((s, n) => {
        g.joints.push({child: id.get(s)!, parent: id.get(lows[n])!, childSlit: slitTo(specs[s], neg(Z)), parentSlit: slitTo(specs[lows[n]], Z)});
        g.travel[id.get(s)!] = [0, 0, -1];
      });
      const list = (xs: number[]) => xs.map(num).join(', ');
      g.steps.push({pieces: unit.map(m => id.get(m.s)!), travel: [0, 0, -1], unit: true,
        text: unit.length === 1
          ? `Piece ${num(discs[0])} (${name(discs[0])}): lower it so slit ${L(slitTo(specs[discs[0]], neg(Z)))} drops onto slit ${L(slitTo(specs[lows[0]], Z))} of piece ${num(lows[0])}.`
          : `Lower layer ${k + 1} as one unit: the bottom slits of pieces ${list(discs)} drop onto the top slits of pieces ${list(lows)} together.`});
    }
  }
  return g;
}
