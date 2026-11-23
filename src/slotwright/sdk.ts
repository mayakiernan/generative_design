/**
 * Slotlayer: slot-kit builds written as code, for Slotwright (scripts/slotwright.ts). It plays the part BrickLayer
 * plays for BrickWright: a build is a short program that places pieces on a grid, joints are found from where the
 * pieces sit (as LEGO studs couple wherever two bricks meet), and the same engine that builds it checks it.
 *
 * The grid is the form atlas's lattice (src/slots/atlas/lattice.ts): disc centres one pitch p apart (p = 2R − 2ℓ,
 * 41.6 mm for 80 mm discs), every disc square to an axis. A disc's plane is fixed by its cell. Starting from a flat
 * disc at the origin, the planes that can join it, and the ones that can join those, depend only on the parity of
 * the cell's coordinates:
 *
 *   flat (normal z):              x, y, z all even, or all odd
 *   upright, faces ±y (plane xz): x odd and y, z even, or x even and y, z odd
 *   upright, faces ±x (plane yz): y odd and x, z even, or y even and x, z odd
 *   no disc:                      z odd and x, y even, or z even and x, y odd
 *
 * In this sublattice any two discs in neighbouring cells cross square along the line between them, so they must be
 * slotted together: a joint. A disc's slits are therefore its joints, its kit piece follows from them (C1, C2L,
 * C2I, C3T), and no slit is left unjoined. A disc with four neighbours in its plane would need four slits, which no
 * piece has. The half disc H1 (one slit) joins only the neighbour its slit faces.
 *
 * World frame: z up, as built; whatever sits lowest rests on the floor.
 */
import {findAssembly, type BuildStep} from '../slots/atlas/assembly.js';
import {cellKey, connected, DIRS, Form, looseDiscs, makeKit, mouths, opposite, overlaps, pieceId, pieceMix, step, type Axis, type Cell, type Kit, type PieceId, type Pose} from '../slots/atlas/lattice.js';
import {panelBox} from '../slots/collide.js';
import {hingeModes} from '../slots/hinges.js';
import {panelCentroid, type Panel} from '../slots/panel.js';
import {groundSupport} from '../slots/stability.js';

export const AXIS_NAMES = ['x', 'y', 'z'] as const;
export type AxisName = (typeof AXIS_NAMES)[number];
export const DIR_NAMES = ['+x', '-x', '+y', '-y', '+z', '-z'] as const;
export type DirName = (typeof DIR_NAMES)[number];

/** Least tip angle for a build to count as standing, degrees: it survives a small knock. */
export const MIN_TIP_DEG = 5;
/** The assembly search handles at most 30 discs (bitmask sets); its node budget. */
export const MAX_ASSEMBLY_DISCS = 30, ASSEMBLY_BUDGET = 20000;

const mod2 = (k: number) => ((k % 2) + 2) % 2;

/** The axis a disc at this cell is square to, or null where no disc can sit. */
export function normalAt(c: Cell): Axis | null {
  const pz = mod2(c[2]), qx = mod2(c[0]) ^ pz, qy = mod2(c[1]) ^ pz;
  return !qx && !qy ? 2 : qx && !qy ? 1 : !qx && qy ? 0 : null;
}

const dirIndex = (d: DirName | string): number => {
  const k = (DIR_NAMES as readonly string[]).indexOf(d.replace('−', '-'));
  if (k < 0) throw new Error(`"${d}" is not a direction; use one of ${DIR_NAMES.join(', ')}`);
  return k;
};
export const fmtCell = (c: Cell) => `(${c.join(', ')})`;
const isCell = (c: unknown): c is Cell => Array.isArray(c) && c.length === 3 && c.every(k => Number.isInteger(k));

export interface DiscOptions {name?: string; color?: string}
interface Item {c: Cell; a: Axis; half?: {toward: number}; name?: string; color?: string}

/** One placed piece, once the build is resolved. Numbers (#) count from 1 in the order pieces were added. */
export interface PlacedPiece {
  index: number;
  name: string;
  cell: Cell;
  /** The axis it is square to: 'z' lies flat, 'x' and 'y' stand upright facing that way. */
  normal: AxisName;
  piece: PieceId | null;
  /** Directions its slits open toward (each one a joint). */
  slits: DirName[];
  /** Numbers of the pieces it is slotted into. */
  joins: number[];
  color?: string;
  /** Centre of its material, mm (z up, floor at 0). */
  centreMm: [number, number, number];
  bottomMm: number;
  topMm: number;
  touchesFloor: boolean;
  /** Bounding box, mm (floor at z = 0). */
  boxMm: {lo: number[]; hi: number[]};
}

export interface CheckResult {name: string; passed: boolean; detail: string | null}

export interface Resolved {
  kit: Kit;
  form: Form;
  pieces: PlacedPiece[];
  /** Problems that stop the build being a kit design at all (each names the piece and cell). */
  problems: string[];
  panels: Panel[];
}

/** The build's view for custom checks in runTests(model, t). */
export class Model {
  readonly pieces: PlacedPiece[];
  readonly kit: Kit;
  constructor(r: Resolved) { this.pieces = r.pieces; this.kit = r.kit; }
  get count() { return this.pieces.length; }
  /** Pitch: centre spacing of neighbouring cells, mm. */
  get pitchMm() { return this.kit.p; }
  get discMm() { return this.kit.size; }
  /** Overall size, mm: x (length), y (width), z (height). */
  get sizeMm(): {x: number; y: number; z: number} {
    const span = (k: number) => round1(Math.max(...this.pieces.map(p => p.boxMm.hi[k])) - Math.min(...this.pieces.map(p => p.boxMm.lo[k])));
    return {x: span(0), y: span(1), z: span(2)};
  }
  named(name: string): PlacedPiece {
    const p = this.pieces.find(q => q.name === name);
    if (!p) throw new Error(`no piece named "${name}"`);
    return p;
  }
  /** Pieces whose names start with `prefix`. */
  group(prefix: string): PlacedPiece[] { return this.pieces.filter(p => p.name.startsWith(prefix)); }
  at(cell: Cell): PlacedPiece | undefined { return this.pieces.find(p => p.cell.every((k, i) => k === cell[i])); }
  floorPieces(): PlacedPiece[] { return this.pieces.filter(p => p.touchesFloor); }
  mix(): Record<PieceId, number> { const out: Record<string, number> = {C1: 0, C2L: 0, C2I: 0, C3T: 0, H: 0, H1: 0}; for (const p of this.pieces) if (p.piece) out[p.piece]++; return out as Record<PieceId, number>; }
}

/** Custom checks, as BrickWright's TestContext. */
export class Tests {
  readonly results: CheckResult[] = [];
  check(name: string, ok: unknown, detail?: string): CheckResult {
    const r = {name, passed: !!ok, detail: ok ? null : detail ?? null};
    this.results.push(r);
    return r;
  }
}

export class SlotBuild {
  readonly discMm: number;
  readonly sheetMm: number;
  readonly clearance: number;
  private items: Item[] = [];

  /** discMm: disc diameter (40 to 600); sheetMm: sheet thickness; clearance: slit fit beyond the sheet. */
  constructor(o: {discMm?: number; sheetMm?: number; clearance?: number} = {}) {
    this.discMm = o.discMm ?? 80;
    this.sheetMm = o.sheetMm ?? 3;
    this.clearance = o.clearance ?? 0.2;
    if (!(this.discMm >= 40 && this.discMm <= 600)) throw new Error('discMm must be 40 to 600');
    if (!(this.sheetMm >= 1 && this.sheetMm <= 20)) throw new Error('sheetMm must be 1 to 20');
    if (this.discMm < 12 * this.sheetMm) throw new Error(`a ${this.discMm} mm disc is too small for ${this.sheetMm} mm sheet (keep it at least 12 sheets across)`);
  }

  /** The axis a disc at `cell` would face ('z' = flat), or null if no disc can sit there. */
  normalAt(cell: Cell): AxisName | null { const a = normalAt(cell); return a === null ? null : AXIS_NAMES[a]; }
  /** Can a piece go here: a disc cell that is empty? */
  isFree(cell: Cell): boolean { return normalAt(cell) !== null && !this.items.some(it => cellKey(it.c) === cellKey(cell)); }
  get count() { return this.items.length; }

  /** A full disc at `cell`; its plane follows from the cell and its slits from its neighbours. Returns its number. */
  disc(cell: Cell, o: DiscOptions = {}): number {
    const a = this.place(cell, 'disc');
    this.items.push({c: [...cell] as Cell, a, name: o.name, color: o.color});
    return this.items.length;
  }

  /**
   * The half disc H1 at `cell`, slotted into the neighbour toward `toward` (a direction in its plane). Its
   * material is the half on that side; its straight edge runs through the cell, facing away.
   */
  half(cell: Cell, toward: DirName, o: DiscOptions = {}): number {
    const a = this.place(cell, 'half disc'), d = dirIndex(toward);
    if (d >> 1 === a) throw new Error(`half disc at ${fmtCell(cell)} lies in the ${['yz', 'xz', 'xy'][a]} plane; it cannot face ${toward}. Use ${DIR_NAMES.filter(n => dirIndex(n) >> 1 !== a).join(', ')}`);
    this.items.push({c: [...cell] as Cell, a, half: {toward: d}, name: o.name, color: o.color});
    return this.items.length;
  }

  /** Remove the piece at a cell, by name, or by number. */
  remove(which: Cell | string | number): void {
    const k = typeof which === 'number' ? which - 1 : typeof which === 'string' ? this.items.findIndex(it => it.name === which) : this.items.findIndex(it => cellKey(it.c) === cellKey(which));
    if (!(k >= 0 && k < this.items.length)) throw new Error(`no piece ${JSON.stringify(which)} to remove`);
    this.items.splice(k, 1);
  }

  /**
   * Mirror every piece across the plane through cell coordinate `at` square to `axis` (y = 0 by default): adds the
   * mirror image of each piece off that plane, unless its cell is taken. Names get `suffix` (or, for names ending in
   * "-l"/"-r" and so on, the opposite ending).
   */
  mirror(axis: AxisName = 'y', at = 0, suffix = '-m'): void {
    const k = AXIS_NAMES.indexOf(axis);
    if (k < 0) throw new Error(`mirror axis must be x, y or z, not ${axis}`);
    for (const it of [...this.items]) {
      if (it.c[k] === at) continue;
      const c = [...it.c] as Cell;
      c[k] = 2 * at - c[k];
      if (!this.isFree(c)) continue;
      const a = normalAt(c);
      if (a === null) throw new Error(`mirror of ${fmtCell(it.c)} lands on ${fmtCell(c)}, where no disc can sit: mirror about a plane with an even ${axis}`);
      const flip = (d: number) => (d >> 1 === k ? opposite(d) : d);
      this.items.push({...it, c, a, half: it.half ? {toward: flip(it.half.toward)} : undefined, name: it.name ? mirrorName(it.name, suffix) : undefined});
    }
  }

  private place(cell: Cell, what: string): Axis {
    if (!isCell(cell)) throw new Error(`${what}: cell must be three integers [x, y, z], not ${JSON.stringify(cell)}`);
    const a = normalAt(cell);
    if (a === null) {
      const near = DIRS.map((d, k) => [step(cell, k), DIR_NAMES[k]] as const).filter(([c]) => normalAt(c) !== null).map(([c]) => fmtCell(c));
      throw new Error(`no disc can sit at ${fmtCell(cell)}: in the joint lattice, cells with z odd and x, y even (or z even and x, y odd) hold none. Neighbouring disc cells: ${near.join(' ')}`);
    }
    if (this.items.some(it => cellKey(it.c) === cellKey(cell))) throw new Error(`${what}: cell ${fmtCell(cell)} already holds piece #${this.items.findIndex(it => cellKey(it.c) === cellKey(cell)) + 1}`);
    return a;
  }

  /** Find joints and pieces, and say what keeps it from being a kit design. */
  resolve(): Resolved {
    const kit = makeKit(this.discMm, this.sheetMm, this.clearance);
    const at = new Map(this.items.map((it, i) => [cellKey(it.c), i]));
    const problems: string[] = [];
    const label = (i: number) => `#${i + 1}${this.items[i].name ? ` "${this.items[i].name}"` : ''} at ${fmtCell(this.items[i].c)}`;
    // A neighbour along d accepts a slit from that side unless it is a half disc facing another way.
    const accepts = (j: number, d: number) => !this.items[j].half || this.items[j].half!.toward === d;
    const masks = this.items.map((it, i) => {
      if (it.half) {
        const j = at.get(cellKey(step(it.c, it.half.toward)));
        if (j === undefined) problems.push(`half disc ${label(i)} faces ${DIR_NAMES[it.half.toward]}, but no piece is there to slot into`);
        else if (this.items[j].half && this.items[j].half!.toward !== opposite(it.half.toward)) problems.push(`half disc ${label(i)} faces ${label(j)}, a half disc facing elsewhere: two half discs only join slit to slit`);
        return 1 << it.half.toward;
      }
      let m = 0;
      for (let d = 0; d < 6; d++) {
        if (d >> 1 === it.a) continue;
        const j = at.get(cellKey(step(it.c, d)));
        if (j !== undefined && accepts(j, opposite(d))) m |= 1 << d;
      }
      return m;
    });
    this.items.forEach((it, i) => {
      if (it.half) return;
      const n = mouths(masks[i]).length;
      if (n === 0) problems.push(`disc ${label(i)} has no neighbour to slot into (neighbouring disc cells are one step along an axis in its plane)`);
      if (n > 3) problems.push(`disc ${label(i)} has ${n} neighbours (${mouths(masks[i]).map(d => DIR_NAMES[d]).join(', ')}), so it would need ${n} slits; kit discs have at most 3. Remove or move one`);
    });
    const poses: Pose[] = this.items.map((it, i) => (it.half ? {c: it.c, a: it.a, m: masks[i], k: 'H1'} : {c: it.c, a: it.a, m: masks[i]}));
    const form = new Form(poses);
    // A disc no piece fits (no slits, or four) is drawn as the nearest piece so a broken build can still be shown.
    const drawn = poses.map(p => {
      if (pieceId(p)) return p;
      const ds = mouths(p.m), m = ds.length ? ds.slice(0, 3).reduce((s, d) => s | (1 << d), 0) : 1 << [0, 1, 2, 3, 4, 5].find(d => d >> 1 !== p.a)!;
      return {...p, m};
    });
    const panels = new Form(drawn).panels(kit);
    const z0 = panels.length ? Math.min(...panels.map(p => panelBox(p).lo[2])) : 0;
    const joinsOf = (i: number) => mouths(masks[i]).map(d => [at.get(cellKey(step(this.items[i].c, d))), d] as const).filter(([j, d]) => j !== undefined && !!(masks[j] & (1 << opposite(d)))).map(([j]) => j!);
    const pieces = this.items.map((it, i): PlacedPiece => {
      const box = panelBox(panels[i]), c = panelCentroid(panels[i]);
      return {
        index: i + 1, name: it.name ?? `#${i + 1}`, cell: it.c, normal: AXIS_NAMES[it.a], piece: pieceId(poses[i]),
        slits: mouths(masks[i]).map(d => DIR_NAMES[d]), joins: joinsOf(i).map(j => j + 1), color: it.color,
        centreMm: [round1(c[0]), round1(c[1]), round1(c[2] - z0)], bottomMm: round1(box.lo[2] - z0), topMm: round1(box.hi[2] - z0), touchesFloor: box.lo[2] <= z0 + 0.05,
        boxMm: {lo: [box.lo[0], box.lo[1], box.lo[2] - z0], hi: [box.hi[0], box.hi[1], box.hi[2] - z0]},
      };
    });
    return {kit, form, pieces, problems, panels};
  }
}

const round1 = (x: number) => Math.round(x * 10) / 10;
function mirrorName(name: string, suffix: string): string {
  const swaps: [RegExp, string][] = [[/-l$/, '-r'], [/-r$/, '-l'], [/-left$/, '-right'], [/-right$/, '-left'], [/-front$/, '-back'], [/-back$/, '-front'], [/-fl$/, '-fr'], [/-fr$/, '-fl'], [/-rl$/, '-rr'], [/-rr$/, '-rl']];
  for (const [re, to] of swaps) if (re.test(name)) return name.replace(re, to);
  return name + suffix;
}

export interface Verdict {
  ok: boolean;
  /** Problems found before the engine checks: when there are any, nothing else ran. */
  problems: string[];
  checks: CheckResult[];
  steps: BuildStep[];
  tipDeg: number;
  model: Model | null;
}

/**
 * The hard checks, enforced on every build whatever its runTests says (as BrickWright enforces no floating parts
 * and no collisions): pieces are kit pieces, nothing overlaps, it is one piece, a build order exists, it stands
 * (tips only past MIN_TIP_DEG), gravity pulls no piece out, and no slit joint can swing so it sags.
 */
export function hardChecks(r: Resolved): Verdict {
  const {kit, form, panels, pieces} = r;
  if (r.problems.length) return {ok: false, problems: r.problems, checks: [], steps: [], tipDeg: 0, model: null};
  if (!form.size) return {ok: false, problems: ['the build has no pieces'], checks: [], steps: [], tipDeg: 0, model: null};
  const name = (i: number) => `#${i + 1}${pieces[i].name !== `#${i + 1}` ? ` "${pieces[i].name}"` : ''} ${fmtCell(pieces[i].cell)}`;
  const checks: CheckResult[] = [];
  const add = (n: string, ok: boolean, detail: string) => checks.push({name: n, passed: ok, detail: ok ? null : detail});

  const hits: string[] = [];
  for (let i = 0; i < form.size; i++) for (let j = i + 1; j < form.size; j++) if (overlaps(kit, form.discs[i], form.discs[j])) hits.push(`${name(i)} runs into ${name(j)}`);
  add('no_collisions', !hits.length, `${hits.length} overlapping pair(s): ${hits.slice(0, 20).join('; ')}`);

  const joints = form.joints();
  if (!connected(form, joints)) {
    const parent = form.discs.map((_, i) => i), find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const {i, j} of joints) parent[find(i)] = find(j);
    const groups = new Map<number, number[]>();
    form.discs.forEach((_, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), i]));
    const parts = [...groups.values()].sort((a, b) => b.length - a.length);
    add('connected', false, `${parts.length} separate parts; the main one has ${parts[0].length} pieces; the others: ${parts.slice(1).map(g => g.map(name).join(', ')).join(' | ')}`);
  } else add('connected', true, '');

  let steps: BuildStep[] = [];
  if (form.size <= MAX_ASSEMBLY_DISCS) {
    const a = findAssembly(kit, form, ASSEMBLY_BUDGET);
    steps = a.steps;
    add('buildable', a.ok, a.exhausted ? `the build-order search ran out of budget (${a.nodes} nodes) without finding a sequence; simplify loops of joints` : 'no build order: every piece or group slides in along its slit lines, and here some piece or closed loop cannot get in. Break a loop of joints, or make sure each loop can be built on the bench and slid in along one axis');
  } else add('buildable', false, `${form.size} pieces; the build-order search handles at most ${MAX_ASSEMBLY_DISCS}`);

  const sup = groundSupport(panels);
  add('stands', sup.margin > 0 && sup.tipDeg >= MIN_TIP_DEG, sup.margin <= 0
    ? `its centre of mass (${sup.com.slice(0, 2).map(x => Math.round(x)).join(', ')} mm) is not over the footprint on the floor (pieces touching the floor: ${pieces.filter(p => p.touchesFloor).map(p => `#${p.index}`).join(', ') || 'none'}); it falls over`
    : `tips at only ${sup.tipDeg.toFixed(1)}°; it needs ${MIN_TIP_DEG}°. Widen its footprint or lower its weight`);

  const loose = looseDiscs(kit, form, panels);
  add('no_loose', !loose.length, `gravity can pull out ${loose.map(name).join(', ')}: a piece held by one slit with nothing under it slides off along that slit. Give it a second joint, or set it so its slit opens upward`);

  const hinge = hingeModes(panels);
  add('braced', !hinge.sags, `slit joints act as hinges, and this can fold under its own weight: ${hinge.swinging.map(name).join(', ')} can swing. Close a loop of joints or add floor contacts to brace it`);

  return {ok: checks.every(c => c.passed), problems: [], checks, steps, tipDeg: sup.tipDeg, model: new Model(r)};
}

export {pieceMix};
