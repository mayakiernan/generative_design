/**
 * Laser files. Every panel laid flat at 1 unit = 1 mm, shelf-packed onto a sheet. Line weights follow the laser lab's
 * rules: 0.072 pt in Illustrator, 0 in AutoCAD.
 *   SVG: red 0.072 pt lines cut, blue text engraves (piece numbers, slit numbers).
 *   DXF (R2000): outlines on layer CUT (red) as closed LWPOLYLINEs, labels on layer ENGRAVE (blue), lineweight 0.
 * The assembly guide is a self-contained HTML page: parts list, the labelled sheet, and the build steps.
 */
import type {Design} from './engine.js';
import type {V2} from './math.js';

export interface SheetItem {id: number; name: string; loops: V2[][]; x: number; y: number; w: number; h: number; x0: number; y1: number}
/** Engraved text on a panel, in that panel's own 2D coordinates. */
export interface Mark {panel: number; at: V2; text: string; size: number}

export function packSheet(d: Design, gap = 12, sheetWidth?: number): {items: SheetItem[]; width: number; height: number} {
  const shapes = d.panels.map(p => {
    const pts = p.loops.flat(), x0 = Math.min(...pts.map(q => q[0])), x1 = Math.max(...pts.map(q => q[0])), y0 = Math.min(...pts.map(q => q[1])), y1 = Math.max(...pts.map(q => q[1]));
    // SVG y runs down: flip so "up" on the panel is up on the sheet.
    return {id: p.id, name: p.name, w: x1 - x0, h: y1 - y0, x0, y1, loops: p.loops.map(l => l.map(q => [q[0] - x0, y1 - q[1]] as V2))};
  });
  const W = sheetWidth ?? Math.max(600, ...shapes.map(s => s.w + 2 * gap));
  const items: SheetItem[] = [];
  let x = gap, y = gap, row = 0;
  for (const s of [...shapes].sort((a, b) => b.h - a.h)) {
    if (x + s.w + gap > W) { x = gap; y += row + gap; row = 0; }
    items.push({...s, x, y});
    x += s.w + gap;
    row = Math.max(row, s.h);
  }
  return {items, width: W, height: y + row + gap};
}

/** Where a panel-local point lands on the sheet. */
export const onSheet = (it: SheetItem, q: V2): V2 => [q[0] - it.x0 + it.x, it.y1 - q[1] + it.y];

export function loopPath(loops: V2[][], dx = 0, dy = 0) {
  return loops.map(l => `M${l.map(q => `${(q[0] + dx).toFixed(2)} ${(q[1] + dy).toFixed(2)}`).join('L')}Z`).join('');
}

/** Default marks: each panel's name at the middle of its bounding box. */
function nameMarks(d: Design): Mark[] {
  return d.panels.map(p => {
    const pts = p.loops.flat(), cx = (Math.min(...pts.map(q => q[0])) + Math.max(...pts.map(q => q[0]))) / 2, cy = (Math.min(...pts.map(q => q[1])) + Math.max(...pts.map(q => q[1]))) / 2;
    return {panel: p.id, at: [cx, cy] as V2, text: p.name, size: Math.max(4, Math.min(12, (Math.max(...pts.map(q => q[0])) - Math.min(...pts.map(q => q[0]))) / 10))};
  });
}

/** Illustrator's laser line weight, 0.072 pt, in the SVG's units (1 unit = 1 mm): 0.072 × 25.4 / 72 = 0.0254. */
export const CUT_STROKE_MM = (0.072 * 25.4) / 72;

const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[ch]!);

export function cutSheetSVG(d: Design, marks: Mark[] = nameMarks(d)): string {
  const {items, width, height} = packSheet(d);
  const byPanel = new Map(items.map(it => [it.id, it]));
  const cuts = items.map(it => `<path d="${loopPath(it.loops, it.x, it.y)}" fill="none" stroke="#ff0000" stroke-width="${CUT_STROKE_MM.toFixed(4)}"/>`).join('\n');
  const text = marks.map(m => {
    const it = byPanel.get(m.panel);
    if (!it) return '';
    const [x, y] = onSheet(it, m.at);
    return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="Helvetica, Arial, sans-serif" font-size="${m.size.toFixed(1)}" fill="#0000ff" text-anchor="middle" dominant-baseline="central">${esc(m.text)}</text>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(1)}mm" height="${height.toFixed(1)}mm" viewBox="0 0 ${width.toFixed(1)} ${height.toFixed(1)}">
<!-- ${esc(d.title)}: ${d.panels.length} pieces, ${d.thickness} mm sheet, slits ${(d.thickness + d.clearance).toFixed(2)} mm wide. Red = cut, blue = engrave. -->
<g id="engrave">
${text}
</g>
<g id="cut">
${cuts}
</g>
</svg>
`;
}

/**
 * DXF R2000 (AC1015) in millimetres: closed LWPOLYLINEs on layer CUT (red), TEXT on layer ENGRAVE (blue),
 * every entity and both layers at lineweight 0 (code 370, hundredths of a millimetre). R12 has no lineweights, so
 * this follows the documented R2000 minimum (not yet opened in AutoCAD): HEADER ($ACADVER, $HANDSEED), empty CLASSES, the nine tables with their required
 * entries, the *Model_Space and *Paper_Space blocks, ENTITIES, and OBJECTS with the root dictionary and ACAD_GROUP.
 * Every object has a handle (5) and its owner's handle (330). y runs up, as DXF expects.
 */
export function cutSheetDXF(d: Design, marks: Mark[] = nameMarks(d)): string {
  const {items, width, height} = packSheet(d);
  const byPanel = new Map(items.map(it => [it.id, it]));
  const n = (v: number) => v.toFixed(3);
  let next = 1;
  const handle = () => (next++).toString(16).toUpperCase();
  const H = {blockRecords: handle(), layers: handle(), styles: handle(), ltypes: handle(), views: handle(), ucs: handle(), vports: handle(), appids: handle(), dimstyles: handle(), model: handle(), paper: handle(), root: handle(), groups: handle()};
  const out: (string | number)[] = [];
  const tag = (...pairs: (string | number)[]) => { out.push(...pairs); };
  const table = (name: string, h: string, entries: () => void, count: number, extra: (string | number)[] = []) => {
    tag(0, 'TABLE', 2, name, 5, h, 330, 0, 100, 'AcDbSymbolTable', 70, count, ...extra);
    entries();
    tag(0, 'ENDTAB');
  };
  const record = (type: string, owner: string, subclass: string, name: string, ...rest: (string | number)[]) =>
    tag(0, type, type === 'DIMSTYLE' ? 105 : 5, handle(), 330, owner, 100, 'AcDbSymbolTableRecord', 100, subclass, 2, name, 70, 0, ...rest);
  const entities: (string | number)[] = [];
  const entity = (type: string, layer: string, ...rest: (string | number)[]) => entities.push(0, type, 5, handle(), 330, H.model, 100, 'AcDbEntity', 8, layer, 370, 0, ...rest);
  for (const it of items) for (const loop of it.loops) {
    entity('LWPOLYLINE', 'CUT', 100, 'AcDbPolyline', 90, loop.length, 70, 1, ...loop.flatMap(q => [10, n(q[0] + it.x), 20, n(height - (q[1] + it.y))]));
  }
  for (const m of marks) {
    const it = byPanel.get(m.panel);
    if (!it) continue;
    const [x, y] = onSheet(it, m.at);
    // Centred on the point both ways (72 = 1 centre, 73 = 2 middle), as the SVG's text is.
    entity('TEXT', 'ENGRAVE', 100, 'AcDbText', 10, n(x), 20, n(height - y), 30, 0, 40, n(m.size * 0.7), 1, m.text, 72, 1, 11, n(x), 21, n(height - y), 31, 0, 100, 'AcDbText', 73, 2);
  }
  const blocks: (string | number)[] = [];
  for (const [name, owner, paper] of [['*Model_Space', H.model, false], ['*Paper_Space', H.paper, true]] as const) {
    blocks.push(0, 'BLOCK', 5, handle(), 330, owner, 100, 'AcDbEntity', ...(paper ? [67, 1] : []), 8, 0, 100, 'AcDbBlockBegin', 2, name, 70, 0, 10, 0, 20, 0, 30, 0, 3, name, 1, '');
    blocks.push(0, 'ENDBLK', 5, handle(), 330, owner, 100, 'AcDbEntity', ...(paper ? [67, 1] : []), 8, 0, 100, 'AcDbBlockEnd');
  }
  // Tables, in the order AutoCAD writes them. Entry handles are drawn as they are written.
  const tables: (string | number)[] = [];
  const at = out.length;
  table('VPORT', H.vports, () => {}, 0);
  table('LTYPE', H.ltypes, () => {
    for (const [name, text] of [['ByBlock', ''], ['ByLayer', ''], ['Continuous', 'Solid line']]) record('LTYPE', H.ltypes, 'AcDbLinetypeTableRecord', name, 3, text, 72, 65, 73, 0, 40, 0);
  }, 3);
  table('LAYER', H.layers, () => {
    record('LAYER', H.layers, 'AcDbLayerTableRecord', '0', 62, 7, 6, 'Continuous', 370, -3);
    record('LAYER', H.layers, 'AcDbLayerTableRecord', 'CUT', 62, 1, 6, 'Continuous', 370, 0);
    record('LAYER', H.layers, 'AcDbLayerTableRecord', 'ENGRAVE', 62, 5, 6, 'Continuous', 370, 0);
  }, 3);
  table('STYLE', H.styles, () => record('STYLE', H.styles, 'AcDbTextStyleTableRecord', 'Standard', 40, 0, 41, 1, 50, 0, 71, 0, 42, 2.5, 3, 'txt', 4, ''), 1);
  table('VIEW', H.views, () => {}, 0);
  table('UCS', H.ucs, () => {}, 0);
  table('APPID', H.appids, () => record('APPID', H.appids, 'AcDbRegAppTableRecord', 'ACAD'), 1);
  table('DIMSTYLE', H.dimstyles, () => record('DIMSTYLE', H.dimstyles, 'AcDbDimStyleTableRecord', 'Standard'), 1, [100, 'AcDbDimStyleTable', 71, 0]);
  table('BLOCK_RECORD', H.blockRecords, () => {
    tag(0, 'BLOCK_RECORD', 5, H.model, 330, H.blockRecords, 100, 'AcDbSymbolTableRecord', 100, 'AcDbBlockTableRecord', 2, '*Model_Space');
    tag(0, 'BLOCK_RECORD', 5, H.paper, 330, H.blockRecords, 100, 'AcDbSymbolTableRecord', 100, 'AcDbBlockTableRecord', 2, '*Paper_Space');
  }, 2);
  tables.push(...out.splice(at));
  const objects = [0, 'DICTIONARY', 5, H.root, 330, 0, 100, 'AcDbDictionary', 281, 1, 3, 'ACAD_GROUP', 350, H.groups,
    0, 'DICTIONARY', 5, H.groups, 330, H.root, 100, 'AcDbDictionary', 281, 1];
  const header = [9, '$ACADVER', 1, 'AC1015', 9, '$HANDSEED', 5, next.toString(16).toUpperCase(), 9, '$INSUNITS', 70, 4, 9, '$MEASUREMENT', 70, 1,
    9, '$EXTMIN', 10, 0, 20, 0, 30, 0, 9, '$EXTMAX', 10, n(width), 20, n(height), 30, 0];
  const section = (name: string, body: (string | number)[]) => [0, 'SECTION', 2, name, ...body, 0, 'ENDSEC'];
  return [...section('HEADER', header), ...section('CLASSES', []), ...section('TABLES', tables), ...section('BLOCKS', blocks), ...section('ENTITIES', entities), ...section('OBJECTS', objects), 0, 'EOF'].join('\n') + '\n';
}

export interface GuideStep {text: string}

export function assemblyGuideHTML(title: string, d: Design, parts: {name: string; count: number}[], steps: GuideStep[], marks: Mark[]): string {
  const svg = cutSheetSVG(d, marks).replace(/^<\?xml[^>]*>\s*/, '').replace(/width="[^"]*mm" height="[^"]*mm"/, 'width="100%"');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · assembly</title>
<style>body{font:14px/1.5 Helvetica,Arial,sans-serif;color:#222;max-width:820px;margin:32px auto;padding:0 16px}h1{font-weight:400;font-size:26px;margin:0 0 4px}.muted{color:#777}h2{font-size:15px;margin:28px 0 8px}ol{padding-left:22px}li{margin:6px 0}table{border-collapse:collapse}td{padding:3px 14px 3px 0}.sheet{border:1px solid #ddd;margin-top:8px}.sheet path{fill:#efe9dc;stroke-width:1px;vector-effect:non-scaling-stroke}@media print{.sheet{break-inside:avoid}}</style></head><body>
<h1>${esc(title)}</h1>
<p class="muted">${d.panels.length} pieces · ${d.thickness} mm sheet · slits cut ${(d.thickness + d.clearance).toFixed(2)} mm wide · about ${Math.round(d.size.width)} × ${Math.round(d.size.depth)} × ${Math.round(d.size.height)} mm assembled</p>
<h2>Parts</h2><table>${parts.map(p => `<tr><td>${p.count} ×</td><td>${esc(p.name)}</td></tr>`).join('')}</table>
<h2>Cut sheet</h2><p class="muted">Each piece is engraved with its number; small numbers mark its slits.</p><div class="sheet">${svg}</div>
<h2>Build</h2><ol>${steps.map(s => `<li>${esc(s.text)}</li>`).join('')}</ol>
<p class="muted">Every joint is a snug cross at 90°. Push each slit fully home before adding the next piece. Checked: no two pieces overlap, each slides in on a straight path, and it stands with its centre of mass over its footprint (tips at ${d.support.tipDeg.toFixed(0)}°).</p>
</body></html>
`;
}
