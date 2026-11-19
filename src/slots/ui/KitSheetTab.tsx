/** The Kit sheet tab: a laser sheet of loose kit pieces to build many designs from, set up and downloaded here. */
import {useEffect, useMemo, useState} from 'react';
import {FULL_PIECES, KIT_SHEET_DEFAULTS, kitSheet, MEASURED_MIX, type FullPiece, type KitSheetOptions} from '../kitSheet';
import {loopPath, sheetDXF, sheetSVG} from '../svg';
import {download, NumberField} from './shared';

/** Common laser stock, inches → mm. */
const STOCK: [string, number, number][] = [['24 × 18 in', 609.6, 457.2], ['24 × 12 in', 609.6, 304.8], ['32 × 18 in', 812.8, 457.2], ['36 × 24 in', 914.4, 609.6], ['12 × 12 in', 304.8, 304.8]];
const PIECE_NAME: Record<FullPiece, string> = {C2L: 'Disc, 2 slits at 90°', C2I: 'Disc, 2 slits at 180°', C3T: 'Disc, 3 slits', C1: 'Disc, 1 slit'};
const STORE = 'slot-kit-sheet';
const percent = (mix: Record<FullPiece, number>) => Object.fromEntries(FULL_PIECES.map(id => [id, Math.round(mix[id] * 100)])) as Record<FullPiece, number>;

/** Settings are remembered in this browser only (a convenience: the page works the same without them). */
function load(): KitSheetOptions & {mix: Record<FullPiece, number>} {
  const start = {...KIT_SHEET_DEFAULTS, mix: percent(MEASURED_MIX)};
  try { return {...start, ...JSON.parse(localStorage.getItem(STORE) ?? '{}')}; } catch { return start; }
}

export function KitSheetTab() {
  const [o, setO] = useState(load);
  const set = (patch: Partial<typeof o>) => setO(x => ({...x, ...patch}));
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch { /* storage off: nothing to remember */ } }, [o]);
  const measured = FULL_PIECES.every(id => o.mix[id] === percent(MEASURED_MIX)[id]);
  // The measured mix goes in exact (the fields show it rounded to whole percent).
  const sheet = useMemo(() => kitSheet({...o, mix: measured ? undefined : o.mix}), [o, measured]);
  const stock = STOCK.find(([, w, h]) => Math.abs(w - o.width) < 0.05 && Math.abs(h - o.height) < 0.05)?.[0] ?? 'custom';
  const name = `slot-kit-sheet-${o.size}mm-discs-${o.sheet}mm`;
  const total = Object.values(sheet.counts).reduce((a, b) => a + (b ?? 0), 0);
  return (
    <div className="kg ks">
      <section className="kg-intro">
        <h1>Kit sheet</h1>
        <p>One laser sheet of loose kit pieces to build many designs from, rather than the pieces of one design. The full discs come in the proportions the generator actually uses, measured over 176 designs of every form; half discs are extra, in back-to-back pairs. Every piece is engraved with its type and slit letters, so any design's build steps can be followed with pieces from the pile, and a slit-fit strip along the bottom tells you the fit to use. Cut lines are 0.072 pt in the SVG (Illustrator) and lineweight 0 in the DXF (AutoCAD).</p>
      </section>

      <div className="kg-controls">
        <label>Stock
          <select value={stock} onChange={e => { const s = STOCK.find(([n]) => n === e.target.value); if (s) set({width: s[1], height: s[2]}); }}>
            {STOCK.map(([n]) => <option key={n} value={n}>{n}</option>)}
            <option value="custom" disabled>Custom</option>
          </select>
        </label>
        <label>Width <span className="unit"><NumberField label="Stock width in mm" value={o.width} min={100} max={1500} step={1} onCommit={v => set({width: v})} />mm</span></label>
        <label>Height <span className="unit"><NumberField label="Stock height in mm" value={o.height} min={100} max={1500} step={1} onCommit={v => set({height: v})} />mm</span></label>
        <label>Sheet <span className="unit"><NumberField label="Measured sheet thickness in mm" value={o.sheet} min={1} max={20} step={0.1} onCommit={v => set({sheet: v})} />mm</span></label>
        <label>Fit <span className="unit">+<NumberField label="Slit clearance in mm" value={o.fit} min={0} max={1} step={0.05} onCommit={v => set({fit: v})} />mm</span></label>
        <label>Disc <span className="unit"><NumberField label="Disc diameter in mm" value={o.size} min={40} max={300} step={5} onCommit={v => set({size: v})} />mm</span></label>
      </div>
      <div className="kg-controls">
        <label>Half discs <span className="unit"><NumberField label="Half discs, in pairs" value={o.halves} min={0} max={60} step={2} onCommit={v => set({halves: v})} /></span></label>
        <label>Round tops <span className="unit"><NumberField label="Round tops" value={o.covers} min={0} max={6} step={1} onCommit={v => set({covers: v})} /></span></label>
        {o.covers > 0 && <label>Top size <span className="unit"><NumberField label="Top diameter as a multiple of the disc" value={o.coverScale} min={1} max={3} step={0.25} onCommit={v => set({coverScale: v})} />× disc</span></label>}
        <label>Gap <span className="unit"><NumberField label="Space between parts in mm" value={o.gap} min={1} max={20} step={0.5} onCommit={v => set({gap: v})} />mm</span></label>
        <label>Margin <span className="unit"><NumberField label="Margin from the stock's edges in mm" value={o.margin} min={0} max={50} step={1} onCommit={v => set({margin: v})} />mm</span></label>
      </div>
      <div className="kg-controls ks-mix">
        <span className="mono label">MIX OF FULL DISCS</span>
        {FULL_PIECES.map(id => <label key={id} title={PIECE_NAME[id]}>{id} <span className="unit"><NumberField label={`${PIECE_NAME[id]}, share in percent`} value={o.mix[id]} min={0} max={100} step={1} onCommit={v => set({mix: {...o.mix, [id]: v}})} />%</span></label>)}
        <button type="button" disabled={measured} onClick={() => set({mix: percent(MEASURED_MIX)})}>{measured ? 'Measured mix' : 'Back to measured mix'}</button>
      </div>

      {sheet.warnings.length > 0 && <ul className="ks-warn">{sheet.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
      <div className="ks-out">
        <p className="ks-counts">{FULL_PIECES.filter(id => sheet.counts[id]).map(id => <span key={id}><b>{sheet.counts[id]}</b> {id}</span>)}{sheet.counts.H ? <span><b>{sheet.counts.H}</b> half</span> : null}{sheet.covers ? <span><b>{sheet.covers}</b> top{sheet.covers === 1 ? '' : 's'}</span> : null}<span className="muted">{total} pieces{sheet.fitStrip ? ' + fit strip' : ''} · slits {(o.sheet + o.fit).toFixed(2)} mm</span></p>
        <div className="downloads">
          <button type="button" className="primary" disabled={!total} onClick={() => download(`${name}.svg`, sheetSVG(sheet.loops, sheet.labels, sheet.width, sheet.height, sheet.comment), 'image/svg+xml')}>Cut sheet · SVG</button>
          <button type="button" disabled={!total} onClick={() => download(`${name}.dxf`, sheetDXF(sheet.loops, sheet.labels, sheet.width, sheet.height), 'application/dxf')}>Cut sheet · DXF</button>
          <button type="button" disabled={!total} onClick={() => download(`${name}.txt`, `${sheet.summary}\n`, 'text/plain')}>Notes · TXT</button>
        </div>
      </div>
      <svg className="sheet ks-preview" viewBox={`0 0 ${sheet.width} ${sheet.height}`} role="img" aria-label={`Kit sheet preview: ${total} pieces on ${o.width} × ${o.height} mm stock`}>
        <rect width={sheet.width} height={sheet.height} className="ks-stock" />
        {sheet.loops.map((l, i) => <path key={i} d={loopPath([l])} />)}
        {sheet.labels.map((m, i) => <text key={i} x={m.at[0]} y={m.at[1]} fontSize={m.size} textAnchor="middle" dominantBaseline="central">{m.text}</text>)}
      </svg>
      <p className="muted small">Preview only: lines are drawn thicker here than in the files. Cut the fit strip first, push an offcut of the same sheet into each slit, and set Sheet and Fit so their sum is the snuggest slit that still goes in by hand; use the same numbers in the gallery.</p>
    </div>
  );
}
