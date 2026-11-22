import {useEffect, useMemo, useState} from 'react';
import type {V2, V3} from '../math';
import {DIRS, fromKey, makeKit, mouths} from '../atlas/lattice';
import {FAIL_TEXT} from '../atlas/judge';
import {atlasItem, type AtlasEntry, type AtlasRun} from '../atlas/item';
import type {GalleryItem} from '../gallery';
import {DesignDetail} from './KitGallery';

/* ---------- form atlas ---------- */

// Saved runs of `npm run atlas`, as asset URLs (each is several MB, so it is fetched only when shown).
const RUNS = import.meta.glob('/atlas-runs/*/atlas.json', {query: '?url', import: 'default', eager: true}) as Record<string, string>;
const RUN_IDS = Object.keys(RUNS).sort().reverse();
/** "2026-11-22 04:39 · halves" from atlas-runs/2026-11-22T04-39-10-halves/atlas.json (the folder's tag, if any). */
const stampOf = (id: string) => {
  const m = /(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-\d\d(?:-([\w-]+))?/.exec(id);
  return m ? `${m[1]} ${m[2]}:${m[3]}${m[4] ? ` · ${m[4]}` : ''}` : id;
};
const RANKED: Record<string, string> = {novel: 'ranked by novelty', useful: 'ranked by usefulness', both: 'ranked by novelty × usefulness'};
const LOOPS = ['0', '1', '2', '3', '4–6', '7–10', '11+'];
const CRATE = ['egg crate', 'close', 'apart', 'far', 'very far'];
const FILL = '#8082a3', TOP_FILL = '#ece3d0';
type Show = 'legal' | 'near' | 'all';
type Crates = 'all' | 'new' | 'crates';
type Across = 'loops' | 'crate';
type Order = 'novel' | 'useful';
interface Shown {e: AtlasEntry; legal: boolean}

/** Axonometric drawing straight from the lattice: each disc a shaded circle with its slits, the top last. */
function FormThumb({e, pitch, R}: {e: AtlasEntry; pitch: number; R: number}) {
  const view = useMemo(() => {
    const az = -0.65, el = 0.5, dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const r: V3 = [Math.cos(az), Math.sin(az), 0], w: V3 = [Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)];
    const u: V3 = [w[1] * r[2] - w[2] * r[1], w[2] * r[0] - w[0] * r[2], w[0] * r[1] - w[1] * r[0]], light: V3 = [0.35, -0.55, 0.76];
    const flat = (P: V3): V2 => [dot(P, r), -dot(P, u)];
    const shapes = fromKey(e.key).discs.map(p => {
      const o: V3 = [p.c[0] * pitch, p.c[1] * pitch, p.c[2] * pitch], [i, j] = [0, 1, 2].filter(k => k !== p.a);
      const at = (s: number, c: number): V3 => { const q: V3 = [...o]; q[i] += s; q[j] += c; return q; };
      // A half disc keeps the half on its material side: an H1's slit side, an H's side s.
      const side = p.k === 'H1' ? mouths(p.m)[0] : p.k === 'H' ? p.s! : -1;
      const phi = side < 0 ? 0 : Math.atan2(DIRS[side][j], DIRS[side][i]);
      const ring = side < 0
        ? Array.from({length: 28}, (_, k) => flat(at(R * Math.cos((k / 28) * 2 * Math.PI), R * Math.sin((k / 28) * 2 * Math.PI))))
        : Array.from({length: 15}, (_, k) => { const th = phi - Math.PI / 2 + (k / 14) * Math.PI; return flat(at(R * Math.cos(th), R * Math.sin(th))); });
      const slits = mouths(p.m).map(d => [flat([o[0] + DIRS[d][0] * R, o[1] + DIRS[d][1] * R, o[2] + DIRS[d][2] * R]), flat([o[0] + DIRS[d][0] * 0.52 * R, o[1] + DIRS[d][1] * 0.52 * R, o[2] + DIRS[d][2] * 0.52 * R])]);
      const n: V3 = [0, 0, 0];
      n[p.a] = 1;
      return {ring, slits, depth: dot(o, w), shade: 0.62 + 0.38 * Math.abs(dot(n, light)), top: false};
    }).sort((a, b) => a.depth - b.depth);
    if (e.top) {
      const {o, u: fu, v: fv} = e.top.frame;
      shapes.push({ring: e.top.outline.map(q => flat([o[0] + fu[0] * q[0] + fv[0] * q[1], o[1] + fu[1] * q[0] + fv[1] * q[1], o[2] + fu[2] * q[0] + fv[2] * q[1]])), slits: [], depth: Infinity, shade: 1, top: true});
    }
    const pts = shapes.flatMap(s => s.ring), x0 = Math.min(...pts.map(q => q[0])), x1 = Math.max(...pts.map(q => q[0])), y0 = Math.min(...pts.map(q => q[1])), y1 = Math.max(...pts.map(q => q[1]));
    const pad = 0.06 * Math.max(x1 - x0, y1 - y0);
    return {shapes, box: `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`};
  }, [e, pitch, R]);
  const tone = (hex: string, k: number) => `rgb(${[1, 3, 5].map(i => Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k))).join(',')})`;
  const path = (pts: V2[]) => `M${pts.map(q => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join('L')}Z`;
  return (
    <svg className="thumb" viewBox={view.box} aria-hidden>
      {view.shapes.map((s, k) => (
        <g key={k}>
          <path d={path(s.ring)} fill={s.top ? TOP_FILL : tone(FILL, s.shade)} fillOpacity={s.top ? 0.82 : 1} stroke="#25252e" strokeOpacity={0.7} strokeWidth={0.9} vectorEffect="non-scaling-stroke" />
          {s.slits.map(([a, b], i) => <path key={i} d={`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`} stroke="#fff" strokeWidth={1.6} vectorEffect="non-scaling-stroke" />)}
        </g>
      ))}
    </svg>
  );
}

export function AtlasTab() {
  const [runId, setRunId] = useState(RUN_IDS[0] ?? '');
  const [run, setRun] = useState<AtlasRun | null>(null);
  const [error, setError] = useState('');
  const [show, setShow] = useState<Show>('legal');
  const [crates, setCrates] = useState<Crates>('all');
  const [across, setAcross] = useState<Across>('loops');
  const [order, setOrder] = useState<Order>('novel');
  const [pick, setPick] = useState<{col: string; height: number} | null>(null);
  const [limit, setLimit] = useState(48);
  const [open, setOpen] = useState<{e: AtlasEntry; n: number} | null>(null);
  useEffect(() => {
    if (!runId) return;
    let live = true;
    setRun(null); setError(''); setPick(null); setOpen(null);
    fetch(RUNS[runId]).then(r => r.json()).then(j => { if (live) setRun(j as AtlasRun); }, e => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [runId]);

  const kit = useMemo(() => (run ? makeKit(run.params.size, run.params.sheet, run.params.clearance) : null), [run]);
  const all: Shown[] = useMemo(() => (run ? run.cells.flatMap(c => [c.legal && {e: c.legal, legal: true}, c.near && {e: c.near, legal: false}].filter((x): x is Shown => !!x)) : []), [run]);
  const kept = all.filter(s => (show === 'all' || (show === 'legal') === s.legal) && (crates === 'all' || (crates === 'crates') === s.e.grid));
  // Runs from before novelty have no fingerprint scores: only the loops axis and the usefulness order apply.
  const scored = !!run && all.some(s => typeof s.e.novelty === 'number');
  const ax: Across = scored ? across : 'loops', by: Order = scored ? order : 'useful';
  const colOf = (e: AtlasEntry) => (ax === 'loops' ? e.features.loops : e.features.crate ?? '');
  const COLS = ax === 'loops' ? LOOPS : CRATE;
  const inPick = (s: Shown) => !pick || (colOf(s.e) === pick.col && s.e.features.height === pick.height);
  // Legal tables: most novel structure first, or most usable surface (the part of the top over its supports) per
  // disc. Near misses: fewest failures first, merely-too-low ones after the rest (a single flat disc is a level
  // surface too), then most novel or biggest top.
  const nearRank = (e: AtlasEntry) => e.failing.length + (e.failing.includes('short') ? 0.5 : 0);
  const usable = (e: AtlasEntry) => (e.metrics.surface * e.metrics.safeFrac) / e.metrics.discs;
  const value = (e: AtlasEntry) => (by === 'novel' ? e.novelty ?? 0 : usable(e));
  const list = kept.filter(inPick).sort((a, b) => (a.legal !== b.legal ? (a.legal ? -1 : 1)
    : a.legal ? value(b.e) - value(a.e)
    : nearRank(a.e) - nearRank(b.e) || (by === 'novel' ? (b.e.novelty ?? 0) - (a.e.novelty ?? 0) : b.e.metrics.surface - a.e.metrics.surface) || b.e.discs - a.e.discs));
  const heights = [...new Set(kept.map(s => s.e.features.height))].sort((a, b) => b - a);
  const square = (col: string, height: number) => kept.filter(s => colOf(s.e) === col && s.e.features.height === height);
  const most = Math.max(1, ...heights.flatMap(h => COLS.map(l => square(l, h).length)));
  const item: GalleryItem | null = useMemo(() => (open && kit && run ? atlasItem(kit, open.e, run.params.rules, `Atlas form ${open.n}`) : null), [open, kit, run]);
  useEffect(() => setLimit(48), [show, crates, pick, order]);
  useEffect(() => setPick(null), [across]);

  const chips = <T extends string>(label: string, value: T, set: (v: T) => void, options: [T, string, number][]) => (
    <div className="kg-filter" role="radiogroup" aria-label={label}>
      <span className="mono label">{label}</span>
      {options.map(([id, text, n]) => <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? 'on' : ''} onClick={() => set(id)}>{text} <span className="muted">{n}</span></button>)}
    </div>
  );
  const count = (f: (s: Shown) => boolean) => all.filter(s => (crates === 'all' || (crates === 'crates') === s.e.grid) && f(s)).length;
  const countC = (f: (s: Shown) => boolean) => all.filter(s => (show === 'all' || (show === 'legal') === s.legal) && f(s)).length;
  const rules = run?.params.rules;

  return (
    <div className="kg atlas">
      <section className="kg-intro">
        <h1>Form atlas</h1>
        <p>Every kind of form the Circular kit's pieces make (full discs and both half discs), mapped by shape, legal tables and not. A table here has a level surface on top (the top is cut to fit, on three or more supports off a line) at least {rules ? rules.height : 120} mm up, stands as built and tips only past {rules ? rules.minTip : 8}°, has no part that can drop out and no slit joint that can swing, can be built (single discs, or groups built on the bench and slid in together, as egg crates are), and uses at most {rules ? rules.maxDiscs : 30} pieces. Each square of the map gathers forms with that many loops of joints and that height; each holds the best legal table and the closest near miss of every finer shape inside it. Open one for its 3D build, checks and laser files.</p>
      </section>

      {!RUN_IDS.length && <p className="note">No atlas runs yet. Run <code>npm run atlas</code>; it writes atlas-runs/&lt;time&gt;/atlas.json, which shows up here.</p>}
      {RUN_IDS.length > 1 && (
        <label className="mono label atlas-run">RUN <select value={runId} onChange={e => setRunId(e.target.value)}>{RUN_IDS.map(id => <option key={id} value={id}>{stampOf(id)}</option>)}</select></label>
      )}
      {error && <p className="note bad">Could not load the atlas: {error}</p>}
      {runId && !run && !error && <p className="note">Loading the atlas…</p>}

      {run && kit && (
        <>
          <p className="atlas-stats">
            <b>{run.cells.reduce((s, c) => s + c.seen, 0).toLocaleString()}</b> forms judged · <b>{run.cells.length.toLocaleString()}</b> shapes on the map · <b>{run.cells.filter(c => c.legal).length}</b> with a legal table, <b>{run.cells.filter(c => c.legal && !c.legal.grid).length}</b> of them not an egg crate · {run.params.size} mm discs, {run.params.sheet} mm sheet · {stampOf(runId)}{run.params.rank ? ` · ${RANKED[run.params.rank]}` : ''}
          </p>

          <div className="kg-filters">
            {chips('SHOW', show, setShow, [['legal', 'Legal tables', count(s => s.legal)], ['near', 'Near misses', count(s => !s.legal)], ['all', 'Both', count(() => true)]])}
            {chips('EGG CRATES', crates, setCrates, [['all', 'All', countC(() => true)], ['new', 'Not egg crates', countC(s => !s.e.grid)], ['crates', 'Egg crates only', countC(s => s.e.grid)]])}
            {scored && (
              <div className="kg-filter" role="radiogroup" aria-label="Map columns">
                <span className="mono label">ACROSS</span>
                {([['loops', 'Loops of joints'], ['crate', 'Distance from an egg crate']] as [Across, string][]).map(([id, text]) => <button key={id} type="button" role="radio" aria-checked={across === id} className={across === id ? 'on' : ''} onClick={() => setAcross(id)}>{text}</button>)}
              </div>
            )}
            {scored && (
              <div className="kg-filter" role="radiogroup" aria-label="Order">
                <span className="mono label">ORDER</span>
                {([['novel', 'Most novel first'], ['useful', 'Most usable top first']] as [Order, string][]).map(([id, text]) => <button key={id} type="button" role="radio" aria-checked={order === id} className={order === id ? 'on' : ''} onClick={() => setOrder(id)}>{text}</button>)}
              </div>
            )}
          </div>

          <div className="atlas-map-wrap">
            <div className={`atlas-map cols-${COLS.length}`} role="grid" aria-label={`Forms by ${ax === 'loops' ? 'loops of joints' : 'distance from an egg crate'} (across) and height (down)`}>
              <span className="mono head corner">HEIGHT \ {ax === 'loops' ? 'LOOPS' : 'FROM EGG CRATE'}</span>
              {COLS.map(l => <span key={l} className="mono head">{l}</span>)}
              {heights.map(h => (
                <div key={h} className="atlas-row" role="row">
                  <span className={`row-label${h * run.params.pitch < (rules?.height ?? 0) - run.params.pitch / 2 ? ' muted' : ''}`}>≈ {Math.round(h * run.params.pitch)} mm</span>
                  {COLS.map(l => {
                    const xs = square(l, h), legal = xs.filter(s => s.legal).length, on = pick?.col === l && pick.height === h;
                    if (!xs.length) return <span key={l} className="atlas-sq empty" role="gridcell" />;
                    const k = 0.12 + (0.55 * xs.length) / most;
                    return (
                      <button key={l} type="button" role="gridcell" aria-pressed={on} className={`atlas-sq ${legal ? 'legal' : 'near'}${on ? ' on' : ''}`} style={{background: legal ? `rgba(60,138,90,${k})` : `rgba(233,83,25,${k * 0.6})`}}
                        title={`${ax === 'loops' ? `${l} loops` : l === 'egg crate' ? 'egg crates' : `${l} from an egg crate`}, about ${Math.round(h * run.params.pitch)} mm: ${legal} legal, ${xs.length - legal} near misses`} onClick={() => setPick(on ? null : {col: l, height: h})}>
                        {xs.length}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="muted small">Green squares hold legal tables, orange only near misses; the number is how many shapes the square holds under the filters. Rows shaded grey are below the table height. {pick ? <button type="button" className="linkish" onClick={() => setPick(null)}>Show every square</button> : 'Click a square to see its forms.'}</p>
          </div>

          <div className="kg-grid">
            {list.slice(0, limit).map(({e, legal}, i) => (
              <button key={`${e.key}-${legal}`} type="button" className="kg-card" onClick={() => setOpen({e, n: i + 1})}>
                <FormThumb e={e} pitch={run.params.pitch} R={run.params.size / 2} />
                <span className="kg-card-meta">
                  <b>{legal ? 'Table' : 'Near miss'} · {e.discs} piece{e.discs === 1 ? '' : 's'}{e.metrics.mix?.H || e.metrics.mix?.H1 ? ` · ${[e.metrics.mix.H ? `${e.metrics.mix.H} H` : '', e.metrics.mix.H1 ? `${e.metrics.mix.H1} H1` : ''].filter(Boolean).join(', ')}` : ''}</b>
                  <span>{e.metrics.loops} loop{e.metrics.loops === 1 ? '' : 's'} · {Math.round(e.metrics.height)} mm{e.top ? ` · top ${Math.round(e.metrics.surface / 100)} cm²` : ''} · plan {e.features.footprint}{e.features.symmetry > 1 ? ` · ${e.features.symmetry}-fold symmetric` : ''}</span>
                  {typeof e.novelty === 'number' && <span>novelty {e.novelty.toFixed(2)}{e.grid ? '' : ` · ${e.features.crate} from an egg crate`}</span>}
                  {legal ? <span className="ok">legal{e.grid ? ' · an egg crate' : ' · not an egg crate'}</span> : <span className="warn">{e.failing.map(f => FAIL_TEXT[f]).join(' · ')}</span>}
                </span>
              </button>
            ))}
          </div>
          {list.length === 0 && <p className="note">Nothing here under these filters.</p>}
          {list.length > limit && <button type="button" className="atlas-more" onClick={() => setLimit(x => x + 48)}>Show more ({list.length - limit} left)</button>}

          <div className="atlas-facts">
            <div>
              <div className="mono label">HOW MANY FORMS THERE ARE</div>
              <table className="atlas-table">
                <thead><tr><th>pieces</th><th>forms</th><th>legal tables</th></tr></thead>
                <tbody>{run.levels.map(l => <tr key={l.n}><td>{l.n}</td><td>{l.forms.toLocaleString()}</td><td>{l.judged ? l.legal : 'not judged'}</td></tr>)}</tbody>
              </table>
              <p className="muted small">Every connected arrangement of kit pieces, counted once however it is turned or mirrored. Each disc multiplies the count about twelvefold, so past a handful of discs forms can only be sampled; the map is filled by search ({run.search.evaluations.toLocaleString()} forms judged, from {run.search.grids} gallery grids and {run.search.trees} grown trees).</p>
            </div>
            <div>
              <div className="mono label">WHAT FORMS FAIL</div>
              <ul className="atlas-fails">
                {run.byFails.slice(0, 14).map(b => (
                  <li key={b.fails}><button type="button" onClick={() => setOpen({e: b.example, n: 0})}><b>{b.count.toLocaleString()}</b> {b.failing.length ? b.failing.map(f => FAIL_TEXT[f]).join(' · ') : 'legal tables'}</button></li>
                ))}
              </ul>
              <p className="muted small">Click a line to open its best example. Bracing takes slit joints as hinges and the floor as non-slip: a table with no loops stands braced only by the floor.</p>
            </div>
          </div>
        </>
      )}

      {open && item && <DesignDetail item={item} index={open.n} name={`${open.e.failing.length ? 'Near miss' : 'Table'} · ${open.e.discs} piece${open.e.discs === 1 ? '' : 's'}`} fill={FILL} onClose={() => setOpen(null)} />}
    </div>
  );
}
