/**
 * Kit sheet: one laser sheet of loose kit pieces for building many designs, rather than the pieces of one design.
 * Used by the page's Kit sheet tab and by `npm run kit-sheet`.
 *
 * Full discs come in the proportions the generator actually uses (MEASURED_MIX), or any mix given. Half discs are
 * added in back-to-back pairs; round tops on request. Every piece is engraved with its type and slit letters, so
 * any design's build steps ("slit a of piece 3, disc with 3 slits") can be followed with pieces from the pile. A
 * slit-fit test strip goes in the band left at the bottom: slits from sheet − 0.3 to sheet + 0.5 mm, each engraved
 * with its width.
 *
 * Layout: square cells one disc plus a gap wide, filled row by row; a pair of half discs shares a cell; a top takes
 * a block of cells at the bottom right.
 */
import {coverPiece, finishPieces, pieceProblem, type Piece} from './kits.js';
import {gridMaxSheet} from './grids.js';
import {integrity} from './integrity.js';
import {marksFor} from './engrave.js';
import {flatFrame, makePanel} from './panel.js';
import type {SheetLabel} from './svg.js';
import type {V2} from './math.js';

export const FULL_PIECES = ['C2L', 'C2I', 'C3T', 'C1'] as const;
export type FullPiece = (typeof FULL_PIECES)[number];

/**
 * Share of each full disc across designs the generator grows, every form weighted equally (random, sculpture,
 * tower, spread, compact, table, tower and spread with a top): 176 designs at 80 mm discs, 3 mm sheet, 2026-11-19.
 * Half discs never survived the checks, so they are not in the mix. Tables averaged 16–17 discs per top, and their
 * tops were 1.75× (45), 2× (43) and 2.5× (16) the disc size. `npm run kit-sheet -- --measure` measures it again.
 */
export const MEASURED_MIX: Record<FullPiece, number> = {C2L: 0.366, C2I: 0.334, C3T: 0.265, C1: 0.057};

export interface KitSheetOptions {
  /** Disc diameter, mm. */ size: number;
  /** Measured sheet thickness, mm. */ sheet: number;
  /** Slit clearance over the sheet, mm. */ fit: number;
  /** Stock, mm. */ width: number; height: number;
  /** Space between parts, and from the stock's edges, mm. */ gap: number; margin: number;
  /** Half discs (rounded up to pairs). */ halves: number;
  /** Round tops, and their size as a multiple of the disc. */ covers: number; coverScale: number;
  /** Relative weight of each full disc; missing or all zero uses MEASURED_MIX. */ mix?: Partial<Record<FullPiece, number>>;
}

/** 24 × 18 in stock, 3 mm sheet, 80 mm discs, six half discs, no tops. */
export const KIT_SHEET_DEFAULTS: KitSheetOptions = {size: 80, sheet: 3, fit: 0.2, width: 609.6, height: 457.2, gap: 4, margin: 8, halves: 6, covers: 0, coverScale: 2};

export interface KitSheet {
  width: number; height: number;
  /** Closed cut loops and engraved labels, mm, y down. */
  loops: V2[][]; labels: SheetLabel[];
  /** Pieces per type (H counts half discs), and tops. */
  counts: Partial<Record<FullPiece | 'H', number>>; covers: number;
  fitStrip: boolean;
  /** Things the maker should know: what did not fit, tables needing bigger discs, pieces that cannot be cut. */
  warnings: string[];
  /** Plain-text notes to keep with the files. */
  summary: string;
  /** One line for the cut file's header comment. */
  comment: string;
}

const NAMES: Record<FullPiece | 'H', string> = {C2L: 'Disc, 2 slits at 90°', C2I: 'Disc, 2 slits at 180°', C3T: 'Disc, 3 slits', C1: 'Disc, 1 slit', H: 'Half disc, 2 notches'};

export function kitSheet(o: KitSheetOptions): KitSheet {
  const {size, sheet: t, fit, width: W, height: H, gap, margin} = o, warnings: string[] = [];
  const given = FULL_PIECES.reduce((s, id) => s + Math.max(0, o.mix?.[id] ?? 0), 0);
  const mix: Record<FullPiece, number> = given > 0 ? Object.fromEntries(FULL_PIECES.map(id => [id, Math.max(0, o.mix?.[id] ?? 0) / given])) as Record<FullPiece, number> : MEASURED_MIX;
  const pieces = finishPieces('circle', size, t, fit), byId = new Map<string, Piece>(pieces.map(p => [p.id, p]));
  for (const p of pieces) { const why = pieceProblem(p); if (why) warnings.push(why); }
  if (t > gridMaxSheet(pieces) + 1e-6) warnings.push(`${size} mm discs are too small for tables in ${t} mm sheet: a grid needs discs at least 25 sheets across (${Math.ceil(25 * t)} mm).`);

  // Square cells, one disc each; a top takes a block of cells at the bottom right; the band left below holds the strip.
  const P = size + gap, cols = Math.max(0, Math.floor((W - 2 * margin + gap) / P)), rows = Math.max(0, Math.floor((H - 2 * margin + gap) / P));
  if (!cols || !rows) warnings.push(`The stock is too small for one ${size} mm disc with ${margin} mm margins.`);
  const top = coverPiece('circle', size * o.coverScale, t, fit), coverCells = Math.ceil((size * o.coverScale + gap) / P);
  const taken = new Set<string>(), covers: [number, number][] = [];
  for (let k = 0; k < o.covers; k++) {
    const c0 = cols - coverCells * (k + 1), r0 = rows - coverCells;
    if (c0 < 0 || r0 < 0) { warnings.push(`Only ${covers.length} of ${o.covers} tops fit.`); break; }
    covers.push([c0, r0]);
    for (let i = 0; i < coverCells; i++) for (let j = 0; j < coverCells; j++) taken.add(`${c0 + i},${r0 + j}`);
  }
  const cells: [number, number][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (!taken.has(`${c},${r}`)) cells.push([c, r]);

  // Half discs first, a back-to-back pair per cell; then full discs by largest remainder, at least two of each used.
  const halfCells = Math.min(Math.ceil(Math.max(0, o.halves) / 2), cells.length), discCells = cells.length - halfCells;
  if (halfCells < Math.ceil(Math.max(0, o.halves) / 2)) warnings.push(`Only ${2 * halfCells} of ${o.halves} half discs fit.`);
  const want = FULL_PIECES.map(id => ({id, cells: mix[id] > 0 ? Math.max(Math.min(2, discCells), mix[id] * discCells) : 0}));
  const alloc = new Map<FullPiece | 'H', number>(want.map(w => [w.id, Math.floor(w.cells)]));
  alloc.set('H', halfCells);
  let left = cells.length - [...alloc.values()].reduce((a, b) => a + b, 0);
  for (const w of [...want].filter(w => w.cells > 0).sort((a, b) => (b.cells % 1) - (a.cells % 1))) if (left > 0) { alloc.set(w.id, alloc.get(w.id)! + 1); left--; }
  while (left < 0) { const most = [...alloc.entries()].filter(([id]) => id !== 'H').sort((a, b) => b[1] - a[1])[0]; alloc.set(most[0], most[1] - 1); left++; }

  // Each piece: its cut loops, its type where a design's piece number would go, and its slit letters.
  const loops: V2[][] = [], labels: SheetLabel[] = [];
  const place = (p: Piece, cx: number, cy: number, turn = 0, label = p.id) => {
    const c = Math.cos(turn), s = Math.sin(turn), at = (q: V2): V2 => [cx + q[0] * c - q[1] * s, cy - (q[0] * s + q[1] * c)];
    for (const l of integrity(makePanel(0, p.id, 'module', p.outline, flatFrame([0, 0, 0]), t, p.cuts)).loops) loops.push(l.map(at));
    for (const m of marksFor([p.id], new Map(byId).set(p.id, p), size)) {
      const slit = /^[a-c]$/.test(m.text);
      labels.push({at: at(m.at), text: slit ? m.text : label, size: slit ? m.size : Math.min(m.size, size * (label.length > 2 ? 0.065 : 0.09))});
    }
  };
  const counts: KitSheet['counts'] = {};
  let n = 0;
  for (const id of [...FULL_PIECES, 'H' as const]) for (let k = 0; k < alloc.get(id)!; k++) {
    const [c, r] = cells[n++], cx = margin + c * P + size / 2, cy = margin + r * P + size / 2;
    if (id === 'H') {
      // Back to back, flat edges half a gap apart: three quarters of a gap clear of the discs above and below.
      place(byId.get('H')!, cx, cy + gap / 4); place(byId.get('H')!, cx, cy - gap / 4, Math.PI);
      counts.H = (counts.H ?? 0) + 2;
    } else { place(byId.get(id)!, cx, cy); counts[id] = (counts[id] ?? 0) + 1; }
  }
  for (const [c0, r0] of covers) {
    const span = coverCells * P - gap;
    place(top, margin + c0 * P + span / 2, margin + r0 * P + span / 2, 0, `top ${o.coverScale}×`);
  }

  // Fit strip in the band below the last row, if it is tall enough.
  const band = H - margin - (margin + rows * P - gap);
  const widths = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4, 0.5].map(dw => Math.round((t + dw) * 100) / 100);
  const stripH = Math.min(22, band - 2 * gap), pitch = 16, stripW = pitch * (widths.length + 1);
  const fitStrip = rows > 0 && stripH >= 14 && stripW <= W - 2 * margin;
  if (fitStrip) {
    const x0 = margin, y0 = margin + rows * P - gap + (band - stripH) / 2, depth = stripH * 0.5;
    const strip: V2[] = [[x0, y0 + stripH], [x0 + stripW, y0 + stripH], [x0 + stripW, y0]];
    for (let k = widths.length - 1; k >= 0; k--) {
      const x = x0 + pitch * (k + 1), w = widths[k];
      strip.push([x + w / 2, y0], [x + w / 2, y0 + depth], [x - w / 2, y0 + depth], [x - w / 2, y0]);
      labels.push({at: [x, y0 + depth + (stripH - depth) / 2], text: w.toFixed(1), size: 3.2});
    }
    strip.push([x0, y0]);
    loops.push(strip);
    if (W - 2 * margin - stripW > 180) labels.push({at: [(x0 + stripW + W - margin) / 2, y0 + stripH / 2], text: `Slot kit · ${size} mm discs · ${t} mm sheet · slits ${(t + fit).toFixed(2)} mm`, size: 4});
  } else if (rows > 0) warnings.push('No room for the slit-fit strip below the last row: make the stock a little taller, or cut a strip separately.');

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const comment = `Slot kit sheet: ${Object.entries(counts).map(([k, v]) => `${v} × ${k}`).join(', ')}${covers.length ? `, ${covers.length} round tops ${size * o.coverScale} mm` : ''}; ${size} mm discs, ${t} mm sheet, slits ${(t + fit).toFixed(2)} mm, stock ${W} × ${H} mm.`;
  const summary = [
    'Slot kit sheet',
    '',
    `Stock ${W} × ${H} mm (${(W / 25.4).toFixed(1)} × ${(H / 25.4).toFixed(1)} in), ${t} mm sheet. Discs ${size} mm across, slits ${(t + fit).toFixed(2)} mm wide (sheet ${t} + fit ${fit}).`,
    '',
    'Per sheet:',
    ...[...FULL_PIECES, 'H' as const].filter(id => counts[id]).map(id => `  ${String(counts[id]).padStart(3)} × ${id.padEnd(4)} ${NAMES[id]}${id === 'H' ? '   (extra: the generator keeps none; for hand-built and Opus designs)' : `   (${Math.round(mix[id] * 100)}% of the full discs)`}`),
    ...(covers.length ? [`  ${String(covers.length).padStart(3)} × top  Round top, ${size * o.coverScale} mm`] : []),
    `  ${String(total).padStart(3)} pieces${covers.length ? ` and ${covers.length} top${covers.length === 1 ? '' : 's'}` : ''}${fitStrip ? ', plus a slit-fit test strip' : ''}`,
    '',
    `${given > 0 ? 'The full discs follow the mix entered.' : 'The full discs follow how often each appears in designs the generator grows, every form weighted equally.'} Each piece is engraved with its type and its slit letters, matching the build steps.`,
    '',
    fitStrip ? `Before cutting a batch: cut the strip, push an offcut of the same sheet into each slit, and take the snuggest width that still goes in by hand. If it is not ${(t + fit).toFixed(1)} mm, set the sheet and fit to match and generate again (and use the same in the gallery).` : '',
    ...warnings.map(w => `Note: ${w}`),
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  return {width: W, height: H, loops, labels, counts, covers: covers.length, fitStrip, warnings, summary, comment};
}
