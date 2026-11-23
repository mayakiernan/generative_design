import {useEffect, useMemo, useState} from 'react';
import {makeKit} from '../atlas/lattice';
import type {AtlasEntry} from '../atlas/item';
import type {GalleryItem} from '../gallery';
import {BREAKS, KIT_DIST, type Breaks, type FreeEntry} from '../ruleless/explore';
import {FREE_FAIL_TEXT, freeFailList, type FreeFailName} from '../ruleless/judge';
import {freeItem, type FreeRun} from '../ruleless/item';
import {STEP} from '../ruleless/free';
import {FormThumb} from './AtlasTab';
import {DesignDetail} from './KitGallery';

/* ---------- rule-free form atlas ---------- */

// Saved runs of `npm run atlas:free`, as asset URLs (fetched only when shown).
const RUNS = import.meta.glob('/atlas-runs/*/free-atlas.json', {query: '?url', import: 'default', eager: true}) as Record<string, string>;
const RUN_IDS = Object.keys(RUNS).sort().reverse();
const stampOf = (id: string) => {
  const m = /(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-\d\d(?:-([\w-]+))?/.exec(id);
  return m ? `${m[1]} ${m[2]}:${m[3]}${m[4] ? ` · ${m[4]}` : ''}` : id;
};
const LOOPS = ['0', '1', '2–3', '4–7', '8–15', '16+'];
const TRIAGE = ['robust', 'needs friction', 'needs slack', 'half on half'] as const;
type Show = 'legal' | 'near' | 'all';
type BreakFilter = 'all' | Breaks;
type TriageFilter = 'all' | (typeof TRIAGE)[number];
type Order = 'novel' | 'far' | 'top';
interface Shown {e: FreeEntry; legal: boolean}

export function FreeAtlasTab() {
  const [runId, setRunId] = useState(RUN_IDS[0] ?? '');
  const [run, setRun] = useState<FreeRun | null>(null);
  const [error, setError] = useState('');
  const [show, setShow] = useState<Show>('legal');
  const [breaks, setBreaks] = useState<BreakFilter>('all');
  const [tri, setTri] = useState<TriageFilter>('all');
  const [order, setOrder] = useState<Order>('novel');
  const [pick, setPick] = useState<{row: Breaks; col: string} | null>(null);
  const [limit, setLimit] = useState(48);
  const [open, setOpen] = useState<{e: FreeEntry; n: number} | null>(null);
  useEffect(() => {
    if (!runId) return;
    let live = true;
    setRun(null); setError(''); setPick(null); setOpen(null);
    fetch(RUNS[runId]).then(r => r.json()).then(j => { if (live) setRun(j as FreeRun); }, e => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [runId]);

  const kit = useMemo(() => (run ? makeKit(run.params.size, run.params.sheet, run.params.clearance) : null), [run]);
  const all: Shown[] = useMemo(() => (run ? run.cells.flatMap(c => [c.legal && {e: c.legal, legal: true}, c.near && {e: c.near, legal: false}].filter((x): x is Shown => !!x)) : []), [run]);
  const passTri = (s: Shown) => tri === 'all' || (s.legal && s.e.triage?.label === tri);
  const kept = all.filter(s => (show === 'all' || (show === 'legal') === s.legal) && (breaks === 'all' || s.e.features.breaks === breaks) && passTri(s));
  const inPick = (s: Shown) => !pick || (s.e.features.breaks === pick.row && s.e.features.loops === pick.col);
  const failCount = (e: FreeEntry) => freeFailList(e.fails).length;
  const value = (e: FreeEntry) => (order === 'novel' ? e.novelty : order === 'far' ? e.kitDist : e.metrics.surface / e.metrics.pieces);
  const list = kept.filter(inPick).sort((a, b) => (a.legal !== b.legal ? (a.legal ? -1 : 1) : a.legal ? value(b.e) - value(a.e) : failCount(a.e) - failCount(b.e) || value(b.e) - value(a.e)));
  const square = (row: Breaks, col: string) => kept.filter(s => s.e.features.breaks === row && s.e.features.loops === col);
  const most = Math.max(1, ...BREAKS.flatMap(r => LOOPS.map(c => square(r, c).length)));
  const item: GalleryItem | null = useMemo(() => (open && kit && run ? freeItem(kit, open.e, run.params.rules, `Rule-free form ${open.n}`) : null), [open, kit, run]);
  useEffect(() => setLimit(48), [show, breaks, tri, pick, order]);

  const chips = <T extends string>(label: string, value: T, set: (v: T) => void, options: [T, string, number?][]) => (
    <div className="kg-filter" role="radiogroup" aria-label={label}>
      <span className="mono label">{label}</span>
      {options.map(([id, text, n]) => <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? 'on' : ''} onClick={() => set(id)}>{text}{n !== undefined && <> <span className="muted">{n}</span></>}</button>)}
    </div>
  );
  const legalAll = all.filter(s => s.legal), rules = run?.params.rules;
  const seedsLegal = run?.seeding.verdicts.legal ?? 0;
  const failText = (f: FreeFailName) => FREE_FAIL_TEXT[f];

  return (
    <div className="kg atlas">
      <section className="kg-intro">
        <h1>Rule-free atlas</h1>
        <p>The same pieces and the same table ({rules ? rules.height : 120} mm surface, at most {rules ? rules.maxDiscs : 30} pieces, buildable), without the kit's joining rules: a slit may be pushed onto any plain edge (a clip), pieces may rest on each other, and joints may sit off the pitch. Whether a form stands is decided by statics: contact forces at slit walls, slit bottoms, resting faces and the floor (friction {run ? run.params.statics.mu : 0.4}), which must hold it under its weight and a load on top as heavy as itself, take a sideways push on the top, and keep it from tipping or sliding when tilted {rules ? rules.minTip : 8}°. Every legal table is then re-judged with less friction and with slits cut to a press fit.</p>
      </section>

      {!RUN_IDS.length && <p className="note">No rule-free runs yet. Run <code>npm run atlas:free</code>; it writes atlas-runs/&lt;time&gt;-free/free-atlas.json, which shows up here.</p>}
      {RUN_IDS.length > 1 && (
        <label className="mono label atlas-run">RUN <select value={runId} onChange={e => setRunId(e.target.value)}>{RUN_IDS.map(id => <option key={id} value={id}>{stampOf(id)}</option>)}</select></label>
      )}
      {error && <p className="note bad">Could not load the atlas: {error}</p>}
      {runId && !run && !error && <p className="note">Loading the atlas…</p>}

      {run && kit && (
        <>
          <p className="atlas-stats">
            <b>{run.search.evaluations.toLocaleString()}</b> forms judged · <b>{run.cells.length.toLocaleString()}</b> shapes on the map · <b>{legalAll.length}</b> with a legal table, <b>{legalAll.filter(s => s.e.metrics.breaks).length}</b> breaking a kit rule, <b>{legalAll.filter(s => s.e.triage?.label === 'robust').length}</b> robust · of the lattice atlas's <b>{run.seeding.kitLegal}</b> legal tables, <b>{seedsLegal}</b> pass statics · {stampOf(runId)}
          </p>

          <div className="kg-filters">
            {chips('SHOW', show, setShow, [['legal', 'Legal tables', all.filter(s => s.legal).length], ['near', 'Near misses', all.filter(s => !s.legal).length], ['all', 'Both', all.length]])}
            {chips('RULES BROKEN', breaks, setBreaks, [['all', 'Any'], ...BREAKS.map(b => [b, b === 'kit joints' ? 'None' : b[0].toUpperCase() + b.slice(1)] as [Breaks, string])])}
            {chips('ROBUSTNESS', tri, setTri, [['all', 'Any'], ...TRIAGE.map(t => [t, t[0].toUpperCase() + t.slice(1), legalAll.filter(s => s.e.triage?.label === t).length] as [TriageFilter, string, number])])}
            {chips('ORDER', order, setOrder, [['novel', 'Most novel first'], ['far', 'Farthest from a kit table'], ['top', 'Most top per piece']])}
          </div>

          <div className="atlas-map-wrap">
            <div className="atlas-map cols-6 rows-wide" role="grid" aria-label="Forms by kit rules broken (down) and loops of contacts (across)">
              <span className="mono head corner">RULES \ LOOPS</span>
              {LOOPS.map(l => <span key={l} className="mono head">{l}</span>)}
              {BREAKS.map(row => (
                <div key={row} className="atlas-row" role="row">
                  <span className="row-label">{row === 'kit joints' ? 'none broken' : row}</span>
                  {LOOPS.map(col => {
                    const xs = square(row, col), legal = xs.filter(s => s.legal).length, on = pick?.row === row && pick.col === col;
                    if (!xs.length) return <span key={col} className="atlas-sq empty" role="gridcell" />;
                    const k = 0.12 + (0.55 * xs.length) / most;
                    return (
                      <button key={col} type="button" role="gridcell" aria-pressed={on} className={`atlas-sq ${legal ? 'legal' : 'near'}${on ? ' on' : ''}`} style={{background: legal ? `rgba(60,138,90,${k})` : `rgba(233,83,25,${k * 0.6})`}}
                        title={`${row}, ${col} loops: ${legal} legal, ${xs.length - legal} near misses`} onClick={() => setPick(on ? null : {row, col})}>
                        {xs.length}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="muted small">Down: which kit rules a form breaks. Across: independent loops of piece-to-piece contacts. Green squares hold legal tables, orange only near misses; each square holds one table and one near miss for every height and spread inside it. {pick ? <button type="button" className="linkish" onClick={() => setPick(null)}>Show every square</button> : 'Click a square to see its forms.'}</p>
          </div>

          <div className="kg-grid">
            {list.slice(0, limit).map(({e, legal}, i) => (
              <button key={`${e.key}-${legal}`} type="button" className="kg-card" onClick={() => setOpen({e, n: i + 1})}>
                <FormThumb e={e as unknown as AtlasEntry} pitch={STEP} R={run.params.size / 2} />
                <span className="kg-card-meta">
                  <b>{legal ? 'Table' : 'Near miss'} · {e.metrics.pieces} piece{e.metrics.pieces === 1 ? '' : 's'}</b>
                  <span>{e.metrics.laps} lap{e.metrics.laps === 1 ? '' : 's'} · {e.metrics.clips} clip{e.metrics.clips === 1 ? '' : 's'} · {e.metrics.rests} resting · {e.metrics.loops} loop{e.metrics.loops === 1 ? '' : 's'}</span>
                  <span>{Math.round(e.metrics.height)} mm{e.top ? ` · top ${Math.round(e.metrics.surface / 100)} cm²` : ''}{e.metrics.stanceDeg >= 0 ? ` · tips at ${Math.round(e.metrics.stanceDeg)}°` : ''}</span>
                  <span>novelty {e.novelty.toFixed(2)} · {e.features.kit === 'a kit table' ? 'a kit table' : `${e.features.kit} from a kit table`}</span>
                  {legal ? <span className={e.triage?.label === 'robust' ? 'ok' : 'warn'}>legal · {e.triage?.label ?? 'not triaged'}</span> : <span className="warn">{freeFailList(e.fails).map(failText).join(' · ')}</span>}
                </span>
              </button>
            ))}
          </div>
          {list.length === 0 && <p className="note">Nothing here under these filters.</p>}
          {list.length > limit && <button type="button" className="atlas-more" onClick={() => setLimit(x => x + 48)}>Show more ({list.length - limit} left)</button>}

          <div className="atlas-facts">
            <div>
              <div className="mono label">THE KIT'S OWN TABLES, BY STATICS</div>
              <table className="atlas-table">
                <thead><tr><th>verdict</th><th>tables</th></tr></thead>
                <tbody>{Object.entries(run.seeding.verdicts).sort((a, b) => b[1] - a[1]).map(([k, v]) => <tr key={k}><td>{k === 'legal' ? 'still legal' : k.split('+').map(x => FREE_FAIL_TEXT[x as FreeFailName]).join(', ')}</td><td>{v}</td></tr>)}</tbody>
              </table>
              <p className="muted small">The lattice atlas's legal tables, judged again here. Its judge pinned every floor contact; here a disc standing on its rim can roll and a foot can slide or lift, so frames whose slit joints act as hinges rack or sag.</p>
              <div className="mono label" style={{marginTop: 18}}>MOVES</div>
              <table className="atlas-table">
                <thead><tr><th>move</th><th>forms</th><th>legal</th></tr></thead>
                <tbody>{Object.entries(run.search.moves).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v.tried.toLocaleString()}</td><td>{v.legal.toLocaleString()}</td></tr>)}</tbody>
              </table>
            </div>
            <div>
              <div className="mono label">WHAT FORMS FAIL</div>
              <ul className="atlas-fails">
                {run.byFails.slice(0, 14).map(b => (
                  <li key={b.fails}>{b.example ? <button type="button" onClick={() => setOpen({e: b.example!, n: 0})}><b>{b.count.toLocaleString()}</b>{b.failing.length ? b.failing.map(failText).join(' · ') : 'legal'}</button> : <span><b>{b.count.toLocaleString()}</b>{b.failing.map(failText).join(' · ')}</span>}</li>
                ))}
              </ul>
              <p className="muted small">Distance from a kit table: {KIT_DIST.map(([, n]) => n).join(', ')} (structural fingerprint distance to the nearest of the lattice atlas's legal tables).</p>
            </div>
          </div>
        </>
      )}

      {open && item && <DesignDetail item={item} index={open.n} name={open.n ? `Rule-free form ${open.n}` : 'Example'} fill="#8082a3" onClose={() => setOpen(null)} />}
    </div>
  );
}
