/**
 * Laser files. Every panel laid flat at 1 unit = 1 mm, shelf-packed onto a sheet.
 *   SVG: red hairlines cut, blue text engraves (piece numbers, slit numbers).
 *   DXF (R12): outlines on layer CUT as closed polylines, labels on layer ENGRAVE.
 * The assembly guide is a self-contained HTML page: parts list, the labelled sheet, and the build steps.
 */
import type {Design} from './engine';
import type {V2} from './math';

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

const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[ch]!);

export function cutSheetSVG(d: Design, marks: Mark[] = nameMarks(d)): string {
  const {items, width, height} = packSheet(d);
  const byPanel = new Map(items.map(it => [it.id, it]));
  const cuts = items.map(it => `<path d="${loopPath(it.loops, it.x, it.y)}" fill="none" stroke="#ff0000" stroke-width="0.1"/>`).join('\n');
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

/** AutoCAD R12 DXF in millimetres: closed POLYLINEs on CUT, TEXT on ENGRAVE (y up, as DXF expects). */
export function cutSheetDXF(d: Design, marks: Mark[] = nameMarks(d)): string {
  const {items, height} = packSheet(d);
  const byPanel = new Map(items.map(it => [it.id, it]));
  const out: string[] = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  const n = (v: number) => v.toFixed(3);
  for (const it of items) for (const loop of it.loops) {
    out.push('0', 'POLYLINE', '8', 'CUT', '66', '1', '70', '1');
    for (const q of loop) out.push('0', 'VERTEX', '8', 'CUT', '10', n(q[0] + it.x), '20', n(height - (q[1] + it.y)));
    out.push('0', 'SEQEND', '8', 'CUT');
  }
  for (const m of marks) {
    const it = byPanel.get(m.panel);
    if (!it) continue;
    const [x, y] = onSheet(it, m.at);
    out.push('0', 'TEXT', '8', 'ENGRAVE', '10', n(x), '20', n(height - y), '40', n(m.size * 0.7), '1', m.text, '72', '1', '11', n(x), '21', n(height - y));
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n') + '\n';
}

export interface GuideStep {text: string}

export function assemblyGuideHTML(title: string, d: Design, parts: {name: string; count: number}[], steps: GuideStep[], marks: Mark[]): string {
  const svg = cutSheetSVG(d, marks).replace(/^<\?xml[^>]*>\s*/, '').replace(/width="[^"]*mm" height="[^"]*mm"/, 'width="100%"');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · assembly</title>
<style>body{font:14px/1.5 Helvetica,Arial,sans-serif;color:#222;max-width:820px;margin:32px auto;padding:0 16px}h1{font-weight:400;font-size:26px;margin:0 0 4px}.muted{color:#777}h2{font-size:15px;margin:28px 0 8px}ol{padding-left:22px}li{margin:6px 0}table{border-collapse:collapse}td{padding:3px 14px 3px 0}.sheet{border:1px solid #ddd;margin-top:8px}.sheet path{fill:#efe9dc}@media print{.sheet{break-inside:avoid}}</style></head><body>
<h1>${esc(title)}</h1>
<p class="muted">${d.panels.length} pieces · ${d.thickness} mm sheet · slits cut ${(d.thickness + d.clearance).toFixed(2)} mm wide · about ${Math.round(d.size.width)} × ${Math.round(d.size.depth)} × ${Math.round(d.size.height)} mm assembled</p>
<h2>Parts</h2><table>${parts.map(p => `<tr><td>${p.count} ×</td><td>${esc(p.name)}</td></tr>`).join('')}</table>
<h2>Cut sheet</h2><p class="muted">Each piece is engraved with its number; small numbers mark its slits.</p><div class="sheet">${svg}</div>
<h2>Build</h2><ol>${steps.map(s => `<li>${esc(s.text)}</li>`).join('')}</ol>
<p class="muted">Every joint is a snug cross at 90°. Push each slit fully home before adding the next piece. Checked: no two pieces overlap, each slides in on a straight path, and it stands with its centre of mass over its footprint (tips at ${d.support.tipDeg.toFixed(0)}°).</p>
</body></html>
`;
}
