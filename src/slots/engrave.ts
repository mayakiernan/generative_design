/**
 * Engraving: each piece's number and a letter at each slit, placed so no label crosses a cut.
 */
import type {Piece} from './kits.js';
import type {V2} from './math.js';
import {convexOverlap, pointInPolygon} from './poly2d.js';
import type {Mark} from './svg.js';

/** Rough box an engraved label occupies: about 0.62 em per character, one em tall. */
export function labelBox(at: V2, text: string, size: number): V2[] {
  const hw = 0.31 * size * text.length + 0.12 * size, hh = 0.5 * size;
  return [[at[0] - hw, at[1] - hh], [at[0] + hw, at[1] - hh], [at[0] + hw, at[1] + hh], [at[0] - hw, at[1] + hh]];
}

const segDist = (q: V2, a: V2, b: V2) => {
  const ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1, u = Math.max(0, Math.min(1, ((q[0] - a[0]) * ex + (q[1] - a[1]) * ey) / l2));
  return Math.hypot(a[0] + ex * u - q[0], a[1] + ey * u - q[1]);
};

/**
 * Engraving that never crosses a cut: the piece number goes at the point of the piece farthest from every edge
 * and slit (grid search), shrinking until its box fits; each slit's letter goes just past the slit's end or
 * beside it, whichever box clears the outline, every cut and the labels already placed.
 */
export function marksFor(types: string[], pieces: Map<string, Piece>, size: number): Mark[] {
  const marks: Mark[] = [];
  const cache = new Map<string, Omit<Mark, 'panel'>[]>();
  types.forEach((id, k) => {
    if (!cache.has(id)) {
      const p = pieces.get(id)!, placed: V2[][] = [], local: Omit<Mark, 'panel'>[] = [];
      const fits = (box: V2[]) => box.every(q => pointInPolygon(p.outline, q)) && !p.cuts.some(c => convexOverlap(box, c, 0)) && !placed.some(b => convexOverlap(box, b, 0));
      const segs = [p.outline, ...p.cuts].flatMap(poly => poly.map((a, i) => [a, poly[(i + 1) % poly.length]] as [V2, V2]));
      const xs = p.outline.map(q => q[0]), ys = p.outline.map(q => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      let best: V2 = [(x0 + x1) / 2, (y0 + y1) / 2], clear = -1;
      for (let i = 1; i < 40; i++) for (let j = 1; j < 40; j++) {
        const q: V2 = [x0 + ((x1 - x0) * i) / 40, y0 + ((y1 - y0) * j) / 40];
        if (!pointInPolygon(p.outline, q) || p.cuts.some(c => pointInPolygon(c, q))) continue;
        const dmin = Math.min(...segs.map(([a, b]) => segDist(q, a, b)));
        if (dmin > clear) { clear = dmin; best = q; }
      }
      const num = String(k + 1);
      for (let sz = Math.max(5, size * 0.09); sz >= 2.5; sz *= 0.85) {
        const box = labelBox(best, num.length > 1 ? num : '00', sz);
        if (fits(box)) { local.push({at: best, text: '#', size: sz}); placed.push(box); break; }
      }
      p.slits.forEach(({e, d}, si) => {
        const q: V2 = [-d[1], d[0]], text = String.fromCharCode(97 + si);
        for (let sz = Math.max(3.5, size * 0.05); sz >= 2; sz *= 0.85) {
          const candidates: V2[] = [2, 4, 7].map(gap => [e[0] + d[0] * (p.len + gap + sz * 0.6), e[1] + d[1] * (p.len + gap + sz * 0.6)] as V2)
            .concat([1, -1].map(side => [e[0] + d[0] * p.len * 0.55 + q[0] * side * (p.w / 2 + sz * 0.9), e[1] + d[1] * p.len * 0.55 + q[1] * side * (p.w / 2 + sz * 0.9)] as V2));
          const at = candidates.find(c => fits(labelBox(c, text, sz)));
          if (at) { local.push({at, text, size: sz}); placed.push(labelBox(at, text, sz)); return; }
        }
      });
      cache.set(id, local);
    }
    for (const m of cache.get(id)!) marks.push({...m, panel: k, text: m.text === '#' ? String(k + 1) : m.text});
  });
  return marks;
}
