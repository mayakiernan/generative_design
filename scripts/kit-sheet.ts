// npm run kit-sheet -- [options]: the Kit sheet tab's cut sheet from the command line (src/slots/kitSheet.ts).
//
// Writes out/kit-sheet/kit-sheet.svg (Illustrator: red 0.072 pt cuts), kit-sheet.dxf (AutoCAD R2000: lineweight 0,
// layer CUT red; layer ENGRAVE blue with --engrave) and kit-sheet.txt (the counts and notes).
//
// Options (mm): --size 80 disc diameter, --sheet 3 measured thickness, --fit 0.2 slit clearance, --width 609.6
// --height 457.2 stock (24 × 18 in), --gap 4, --margin 8, --halves 6 notched half discs, --half-slits 4 half discs with one slit, --plain 4 plain discs (no slits), --covers 0,
// --cover-scale 2, --engrave to engrave types, slit letters and fit widths (outlines only without it), --measure to
// measure the mix of slotted discs again from designs the generator grows (a few minutes).
import {mkdirSync, writeFileSync} from 'node:fs';
import {gallery, type GalleryItem} from '../src/slots/gallery.js';
import {FULL_PIECES, KIT_SHEET_DEFAULTS, kitSheet, type FullPiece} from '../src/slots/kitSheet.js';
import {sheetDXF, sheetSVG} from '../src/slots/svg.js';

const arg = (name: string, fallback: number) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : fallback; };
const d = KIT_SHEET_DEFAULTS;
const o = {size: arg('size', d.size), sheet: arg('sheet', d.sheet), fit: arg('fit', d.fit), width: arg('width', d.width), height: arg('height', d.height),
  gap: arg('gap', d.gap), margin: arg('margin', d.margin), halves: arg('halves', d.halves), halfSlits: arg('half-slits', d.halfSlits), plain: arg('plain', d.plain), covers: arg('covers', d.covers), coverScale: arg('cover-scale', d.coverScale),
  engrave: process.argv.includes('--engrave')};

/** Share of each full disc in designs grown in every form, each form weighted equally. */
function measure(): Record<FullPiece, number> {
  const forms = [['random'], ['any'], ['tower'], ['spread'], ['compact'], ['table'], ['tower', 'top'], ['spread', 'top']] as const;
  const share = Object.fromEntries(FULL_PIECES.map(p => [p, 0])) as Record<FullPiece, number>;
  for (const [intent, top] of forms) {
    const per: Record<string, number> = {};
    let discs = 0;
    for (const seed of [1, 2]) for (const count of [12, 18]) for (const x of gallery({kit: 'circle', intent, count, size: o.size, t: o.sheet, clearance: o.fit, seed, designs: 4, attempts: 80, footprint: 4 * o.size, cover: top ? {shape: 'round', minMm: 0} : undefined})) {
      if (!('design' in x) || !(x as GalleryItem).stands) continue;
      for (const p of (x as GalleryItem).parts) if ((FULL_PIECES as readonly string[]).includes(p.id)) { per[p.id] = (per[p.id] ?? 0) + p.count; discs += p.count; }
    }
    for (const id of FULL_PIECES) share[id] += (per[id] ?? 0) / Math.max(1, discs) / forms.length;
    console.log(`  ${[intent, top].filter(Boolean).join(' + ').padEnd(14)} ${FULL_PIECES.map(id => `${id} ${per[id] ?? 0}`).join('  ')}`);
  }
  return share;
}

const sheet = kitSheet({...o, mix: process.argv.includes('--measure') ? measure() : undefined});
const dir = 'out/kit-sheet';
mkdirSync(dir, {recursive: true});
writeFileSync(`${dir}/kit-sheet.svg`, sheetSVG(sheet.loops, sheet.labels, sheet.width, sheet.height, sheet.comment));
writeFileSync(`${dir}/kit-sheet.dxf`, sheetDXF(sheet.loops, sheet.labels, sheet.width, sheet.height));
writeFileSync(`${dir}/kit-sheet.txt`, `${sheet.summary}\n`);
console.log(sheet.summary);
console.log(`\nWrote ${dir}/kit-sheet.svg, kit-sheet.dxf, kit-sheet.txt (${sheet.loops.length} cut loops, ${sheet.labels.length} engraved labels).`);
