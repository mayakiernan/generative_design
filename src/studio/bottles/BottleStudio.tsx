import {useEffect, useMemo, useRef, useState} from 'react';
import * as S from './vendor/model.mjs';
import * as F from './vendor/fit.mjs';
import type {Point, PoolDesign} from './vendor/fit.mjs';
import type {Evaluation, Params, Rule, RuleState, Rulebook} from './vendor/model.mjs';
import {type Dataset, type Rec, loadDataset, paramsOf, measuresOf, describe, marketRecs, evaluateRec, fmt, FAMILY, TIER_ORDER} from './data';
import {featureTable, standardize, project, coords, kmeans, nearestCenter, columnWeights, axisLabel, type FeatureTable} from './space';
import {SketchPad} from './SketchPad';
import {Viewer} from './Viewer';
import {SpaceMap, type MapPoints} from './SpaceMap';
import {Silhouette, Verdict, Conf} from './parts';

const PALETTE = ['#B891B6', '#EBD300', '#2B2B2B', '#7FA39C', '#D9824B', '#6E7FB8', '#A8A59C'];
const K_CLUSTERS = 7;
type ColorBy = 'cluster' | 'make' | 'wall' | 'form' | 'mouth' | 'capacity';
const COLOR_BY: [ColorBy, string][] = [['cluster', 'Cluster'], ['make', 'Can it be made'], ['wall', 'Wall'], ['form', 'Form'], ['mouth', 'Mouth'], ['capacity', 'Capacity']];
const LEGEND: Partial<Record<ColorBy, [string, string][]>> = {
  make: [['#2B2B2B', 'Can be made'], ['#EBD300', 'Fails a test'], ['#D9824B', "Can't be made"]],
  wall: [['#EBD300', 'Single wall'], ['#B891B6', 'Double wall']],
  form: [['#2B2B2B', 'Bottle'], ['#B891B6', 'Tumbler']],
  mouth: [['#B891B6', 'Narrow'], ['#EBD300', 'Wide'], ['#D9824B', 'Non-standard'], ['#7FA39C', 'Tumbler rim']],
  capacity: [['#E3E1D9', 'Small'], ['#2B2B2B', 'Large']],
};
const hex = (h: string): [number, number, number] => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

interface Base { recs: Rec[]; raw: [string, string, number][][]; sig: number[][]; table: FeatureTable }

export function BottleStudio() {
  const [D, setD] = useState<Dataset | null>(null);
  const [base, setBase] = useState<Base | null>(null);
  const [state, setState] = useState<RuleState>({__market: 'US'});
  const [strokes, setStrokes] = useState<Point[][]>(() => F.exampleStrokes('classic'));
  const [capacity, setCapacity] = useState(500);
  const [publicLids, setPublicLids] = useState(true);
  const [weights, setWeights] = useState<Record<string, number>>(() => Object.fromEntries(S.GROUPS.map(g => [g.id, 1])));
  const [colorBy, setColorBy] = useState<ColorBy>('cluster');
  const [focus, setFocus] = useState<number | null>(null);
  const [open, setOpen] = useState<Rec | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [tip, setTip] = useState<{text: string; x: number; y: number} | null>(null);
  const [sketchWall, setSketchWall] = useState<'single' | 'double'>('double');
  const [section, setSection] = useState(false);

  useEffect(() => { loadDataset().then(setD); }, []);
  const book: Rulebook | null = D?.rulebook ?? null;

  // Profiles, outlines and map features for every design, once.
  useEffect(() => {
    if (!D) return;
    const t = setTimeout(() => {
      const recs: Rec[] = [], raw: [string, string, number][][] = [], sig: number[][] = [];
      for (let i = 0; i < D.designs.id.length; i++) {
        const p = paramsOf(D, i), prof = S.buildProfile(p), m = measuresOf(D, i);
        recs.push({key: D.designs.id[i], kind: 'design', label: D.designs.id[i], sub: describe(p), p, prof, m, index: i});
        raw.push(S.features(prof, p, m));
        sig.push(F.signature(prof));
      }
      setBase({recs, raw, sig, table: featureTable(raw)});
    }, 30);
    return () => clearTimeout(t);
  }, [D]);

  const evs = useMemo(() => (base && book ? base.recs.map(r => evaluateRec(r, book, state)) : []), [base, book, state]);
  const proj = useMemo(() => (base ? project(base.table, weights) : null), [base, weights]);
  const clusters = useMemo(() => (base && proj ? kmeans(base.table, proj.w, K_CLUSTERS) : null), [base, proj]);
  const market = useMemo(() => (book ? marketRecs(book) : []), [book]);

  // ---------- the sketch ----------
  const read = useMemo(() => F.silhouette(strokes), [strokes]);
  const judged = useMemo(() => (read && book ? F.judgeSketch(read.r, {capacity, book, state}) : null), [read, book, capacity, state]);
  const [fits, setFits] = useState<Rec[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!read || !base || !book) { setFits([]); return; }
    setBusy(true);
    const t = setTimeout(() => {
      const pool: PoolDesign[] = [];
      base.recs.forEach((r, i) => {
        if (!evs[i]?.feasible) return;
        if (publicLids && !['narrow', 'wide', 'rim'].includes(r.m.mouth_family)) return;
        pool.push({id: r.key, p: r.p, m: r.m, family: r.m.mouth_family, sig: base.sig[i]});
      });
      const res = F.findDesigns(read.r, {pool, book, state, cap: capacity, capTol: 0.1});
      setFits(res.picks.map((pk, k) => {
        const prof = S.buildProfile(pk.p);
        return {key: 'fit-' + k, kind: 'fit', label: 'Fit ' + (k + 1), sub: describe(pk.p) + ' · ' + (FAMILY[pk.family] ?? pk.family), p: pk.p, prof, m: pk.m, sig: pk.sig, g: pk.g, parent: pk.parent};
      }));
      setBusy(false);
    }, 250);
    return () => clearTimeout(t);
  }, [read, base, book, state, capacity, publicLids, evs]);
  const matches = useMemo(() => (read && judged ? F.marketMatches(read.r, market.map(r => r.market!), 6, judged.form) : []), [read, judged, market]);

  const sketchRec: Rec | null = useMemo(() => {
    if (!judged || !read) return null;
    const j = judged[sketchWall];
    return {key: 'sketch', kind: 'sketch', label: 'Your sketch', sub: (sketchWall === 'double' ? 'Double wall' : 'Single wall') + ' · ' + capacity + ' mL', p: j.cfg, prof: j.prof, m: j.m, sig: read.r};
  }, [judged, read, sketchWall, capacity]);

  // ---------- the map ----------
  const extra = useMemo(() => [...market, ...fits, ...(sketchRec ? [sketchRec] : [])], [market, fits, sketchRec]);
  const extraCoords = useMemo(() => {
    if (!base || !proj || !clusters) return [];
    return extra.map(r => {
      const z = standardize(base.table, S.features(r.prof, r.p, r.m));
      return {xyz: coords(proj, z), cluster: nearestCenter(clusters.centers, z, proj.w)};
    });
  }, [extra, base, proj, clusters]);

  const clusterInfo = useMemo(() => {
    if (!base || !clusters) return [];
    const info = Array.from({length: K_CLUSTERS}, (_, c) => ({c, n: 0, make: 0, members: [] as number[]}));
    clusters.assign.forEach((c, i) => { info[c].n++; info[c].members.push(i); if (evs[i]?.canMake) info[c].make++; });
    const used = new Set<string>();
    return info.map(x => {
      const ms = x.members.map(i => base.recs[i]);
      const maj = (f: (r: Rec) => string) => { const cnt: Record<string, number> = {}; ms.forEach(r => { const k = f(r); cnt[k] = (cnt[k] ?? 0) + 1; }); return Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''; };
      const med = (f: (r: Rec) => number) => { const v = ms.map(f).sort((a, b) => a - b); return v[v.length >> 1] ?? 0; };
      const form = maj(r => String(r.p.form)), wall = maj(r => String(r.p.wall)), fam = maj(r => r.m.mouth_family);
      const cap = med(r => Number(r.m.capacity_ml)), hd = med(r => Number(r.m.h_over_d));
      let label = (wall === 'double' ? 'Double-wall ' : 'Single-wall ') + (form === 'tumbler' ? 'tumblers' : 'bottles') + (form === 'bottle' ? ', ' + (FAMILY[fam] ?? fam).toLowerCase() : '');
      if (used.has(label)) label += hd > 3 ? ', tall' : hd < 2.2 ? ', squat' : ', mid';
      used.add(label);
      return {...x, label, cap, hd};
    });
  }, [base, clusters, evs]);

  const colorOf = (r: Rec, i: number, cluster: number): [number, number, number] => {
    if (colorBy === 'cluster') return hex(PALETTE[cluster % PALETTE.length]);
    if (colorBy === 'make') { const e = i >= 0 ? evs[i] : (r.ev ?? (book ? evaluateRec(r, book, state) : undefined)); return hex(!e ? '#A8A59C' : !e.canMake ? '#D9824B' : !e.feasible ? '#EBD300' : '#2B2B2B'); }
    if (colorBy === 'wall') return hex(r.p.wall === 'double' ? '#B891B6' : '#EBD300');
    if (colorBy === 'form') return hex(r.p.form === 'tumbler' ? '#B891B6' : '#2B2B2B');
    if (colorBy === 'mouth') return hex(({narrow: '#B891B6', wide: '#EBD300', off: '#D9824B', rim: '#7FA39C', 'rim-off': '#A8A59C'} as Record<string, string>)[r.m.mouth_family] ?? '#A8A59C');
    const t = Math.min(1, Math.max(0, (Math.log(Number(r.m.capacity_ml) || 100) - Math.log(150)) / (Math.log(2500) - Math.log(150))));
    return [0.92 - 0.75 * t, 0.9 - 0.73 * t, 0.86 - 0.69 * t];
  };

  const points: MapPoints | null = useMemo(() => {
    if (!base || !proj || !clusters) return null;
    const n = base.recs.length, total = n + extra.length;
    const pos = new Float32Array(total * 3), col = new Float32Array(total * 4), size = new Float32Array(total), ring = new Float32Array(total);
    const keys: string[] = new Array(total);
    base.recs.forEach((r, i) => {
      const [x, y, z] = coords(proj, base.table.rows[i]);
      pos.set([x, y, z], i * 3);
      const c = colorOf(r, i, clusters.assign[i]);
      const dim = focus !== null && clusters.assign[i] !== focus;
      col.set([...c, dim ? 0.05 : colorBy === 'make' && evs[i]?.feasible ? 0.5 : 0.62], i * 4);
      size[i] = 4.2; keys[i] = r.key;
    });
    extra.forEach((r, j) => {
      const i = n + j, ec = extraCoords[j];
      if (!ec) return;
      pos.set(ec.xyz, i * 3);
      const fill = r.kind === 'market' ? hex('#FFFFFF') : r.kind === 'sketch' ? hex('#EBD300') : hex('#B891B6');
      col.set([...fill, 1], i * 4);
      size[i] = r.kind === 'sketch' ? 22 : r.kind === 'fit' ? 15 : 13; ring[i] = 1; keys[i] = r.key;
    });
    if (open) {
      const i = keys.indexOf(open.key);
      if (i >= 0) { size[i] = Math.max(size[i], 20); ring[i] = 1; col[i * 4 + 3] = 1; }
    }
    return {pos, col, size, ring, keys};
  }, [base, proj, clusters, extra, extraCoords, colorBy, focus, evs, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const axes = useMemo<[string, string][]>(() => (base && proj ? [0, 1, 2].map(i => axisLabel(base.table, proj, i)) : []), [base, proj]);
  const byKey = useMemo(() => {
    const m = new Map<string, Rec>();
    base?.recs.forEach(r => m.set(r.key, r));
    extra.forEach(r => m.set(r.key, r));
    return m;
  }, [base, extra]);

  const marketInCluster = (c: number) => extra.map((r, j) => ({r, c: extraCoords[j]?.cluster})).filter(x => x.r.kind === 'market' && x.c === c).map(x => x.r);

  // ---------- render ----------
  return (
    <div className="bs">
      <header className="bs-bar">
        <a className="bs-home" href="../">Probable Pieces</a>
        <h1 className="bs-title">Bottles</h1>
        <span className="bs-bar-meta">{D ? `Stainless steel · ${D.meta.total.toLocaleString()} designs` : 'Loading'}</span>
        <button type="button" className="bs-bar-btn" onClick={() => setDrawer(true)}>Constraints</button>
      </header>
      <main className="bs-split">
        <section className="bs-left" aria-label="Sketch">
          <div className="bs-sketch-row">
            <SketchPad strokes={strokes} setStrokes={setStrokes} read={read} />
            <div className="bs-sketch-side">
              <label className="bs-cap">
                <span>Capacity</span>
                <input type="number" min={100} max={2500} step={10} value={capacity} onChange={e => setCapacity(Math.max(100, Math.min(2500, Number(e.target.value) || 500)))} />
                <span>mL</span>
              </label>
              {sketchRec && (
                <div className="bs-sketch-3d">
                  <Viewer prof={sketchRec.prof} cfg={sketchRec.p} section={section} />
                  <div className="bs-toggle">
                    {(['single', 'double'] as const).map(w => <button key={w} type="button" className={sketchWall === w ? 'on' : ''} onClick={() => setSketchWall(w)}>{w === 'single' ? 'Single' : 'Double'}</button>)}
                    <button type="button" className={section ? 'on' : ''} onClick={() => setSection(!section)}>Section</button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {judged && book && (
            <div className="bs-verdicts">
              {(['single', 'double'] as const).map(w => {
                const j = judged[w];
                return (
                  <article key={w} className={'bs-card ' + (j.ev.canMake ? (j.ev.feasible ? 'ok' : 'warn') : 'bad')} onClick={() => setSketchWall(w)}>
                    <h2>{w === 'single' ? 'Single wall' : 'Double wall'}</h2>
                    <p className="bs-big">{j.ev.canMake ? (j.ev.feasible ? 'Can be made' : 'Can be made, fails a test') : "Can't be made"}</p>
                    <dl className="bs-facts">
                      <dt>Height</dt><dd>{fmt(j.m.height_mm, 'mm')}</dd>
                      <dt>Diameter</dt><dd>{fmt(j.m.max_d_mm, 'mm')}</dd>
                      <dt>Mouth</dt><dd>{fmt(j.m.mouth_id_mm, 'mm')}</dd>
                      <dt>Steel + lid</dt><dd>{fmt(j.m.mass_g, 'g')}</dd>
                      {w === 'double' && <><dt>After 6 h</dt><dd>{fmt(j.m.heat_6h_c, '°C')} <span className="bs-est">est.</span></dd></>}
                    </dl>
                    <Verdict ev={j.ev} compact />
                  </article>
                );
              })}
            </div>
          )}

          <div className="bs-block">
            <div className="bs-block-head">
              <h2>Closest buildable</h2>
              <label className="bs-check"><input type="checkbox" checked={publicLids} onChange={e => setPublicLids(e.target.checked)} /> Public lids only</label>
              {busy && <span className="bs-busy">Fitting</span>}
            </div>
            <div className="bs-row">
              {fits.map(r => (
                <button key={r.key} type="button" className="bs-tile" onClick={() => setOpen(r)}>
                  <Silhouette prof={r.prof} sketch={read?.r} w={110} h={140} />
                  <b>{r.p.wall === 'double' ? 'Double' : 'Single'} · {fmt(r.m.capacity_ml, 'mL')}</b>
                  <span>{FAMILY[r.m.mouth_family]} · {((r.g ?? 0) * 100).toFixed(1)}% off</span>
                </button>
              ))}
              {!fits.length && !busy && <p className="bs-empty">{!base ? 'Loading designs' : read ? 'No buildable design within 10% of this capacity.' : 'Draw an outline to see designs.'}</p>}
            </div>
          </div>

          <div className="bs-block">
            <div className="bs-block-head"><h2>On the market</h2></div>
            <div className="bs-row">
              {matches.map(({p}) => {
                const r = market.find(x => x.market === p)!;
                return (
                  <button key={r.key} type="button" className="bs-tile bs-product" onClick={() => setOpen(r)}>
                    {p.image ? <img src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Silhouette prof={r.prof} w={110} h={140} />}
                    <b>{p.brand}</b>
                    <span>{p.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section className="bs-right" aria-label="Design space">
          <div className="bs-map-tools">
            <label>Colour <select value={colorBy} onChange={e => { setColorBy(e.target.value as ColorBy); setFocus(null); }}>{COLOR_BY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <div className="bs-weights">
              {S.GROUPS.map(g => (
                <label key={g.id}>
                  <span>{g.label}</span>
                  <input type="range" min={0} max={3} step={0.25} value={weights[g.id]} onChange={e => { setWeights({...weights, [g.id]: Number(e.target.value)}); setFocus(null); }} />
                </label>
              ))}
            </div>
          </div>
          <div className="bs-map-wrap">
            <SpaceMap
              points={points} axes={axes}
              onHover={(k, x, y) => { const r = k ? byKey.get(k) : null; setTip(r ? {text: r.label + ' · ' + r.sub, x, y} : null); }}
              onPick={k => { const r = byKey.get(k); if (r) setOpen(r); }}
            />
            {!points && <p className="bs-loading">Mapping the space</p>}
            <div className="bs-key">
              <span><i className="m-sketch" />Your sketch</span><span><i className="m-fit" />Closest buildable</span><span><i className="m-market" />On the market</span>
              {LEGEND[colorBy]?.map(([c, l]) => <span key={l}><i className="m-dot" style={{background: c}} />{l}</span>)}
            </div>
          </div>
          <ul className="bs-clusters">
            {clusterInfo.map(c => (
              <li key={c.c}>
                <button type="button" className={focus === c.c ? 'on' : ''} onClick={() => { setFocus(focus === c.c ? null : c.c); setColorBy('cluster'); }}>
                  <i style={{background: PALETTE[c.c % PALETTE.length]}} />
                  <b>{c.label}</b>
                  <span>{c.n.toLocaleString()} · {Math.round((100 * c.make) / Math.max(c.n, 1))}% can be made · {fmt(c.cap, 'mL')}</span>
                </button>
              </li>
            ))}
          </ul>
          {focus !== null && clusterInfo[focus] && base && (
            <div className="bs-block">
              <div className="bs-block-head"><h2>{clusterInfo[focus].label}</h2></div>
              <div className="bs-row">
                {clusterInfo[focus].members.filter(i => evs[i]?.canMake).slice(0, 4).map(i => (
                  <button key={i} type="button" className="bs-tile" onClick={() => setOpen(base.recs[i])}>
                    <Silhouette prof={base.recs[i].prof} w={90} h={120} />
                    <b>{fmt(base.recs[i].m.capacity_ml, 'mL')}</b><span>{base.recs[i].key}</span>
                  </button>
                ))}
                {marketInCluster(focus).map(r => (
                  <button key={r.key} type="button" className="bs-tile bs-product" onClick={() => setOpen(r)}>
                    {r.market?.image ? <img src={r.market.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Silhouette prof={r.prof} w={90} h={120} />}
                    <b>{r.market?.brand}</b><span>{r.market?.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
      {tip && <div className="bs-tip" style={{left: tip.x + 14, top: tip.y + 14}}>{tip.text}</div>}
      {open && book && <DesignSheet rec={open} book={book} state={state} market={market} sketch={read?.r} onClose={() => setOpen(null)} onOpen={setOpen} />}
      {drawer && book && <Constraints book={book} state={state} setState={setState} onClose={() => setDrawer(false)} />}
    </div>
  );
}

function DesignSheet({rec, book, state, market, sketch, onClose, onOpen}: {rec: Rec; book: Rulebook; state: RuleState; market: Rec[]; sketch?: number[]; onClose: () => void; onOpen: (r: Rec) => void}) {
  const [section, setSection] = useState(false);
  const ev: Evaluation = useMemo(() => evaluateRec(rec, book, state), [rec, book, state]);
  const sig = rec.sig ?? F.signature(rec.prof);
  const similar = useMemo(() => F.marketMatches(sig, market.map(r => r.market!), 4, String(rec.p.form)).filter(x => x.p !== rec.market), [sig, market, rec]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    box.current?.focus();
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  const p = rec.p, m = rec.m;
  return (
    <div className="pd bs-sheet" role="dialog" aria-modal="true" aria-label={rec.label} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pd-card" ref={box} tabIndex={-1}>
        <button type="button" className="pd-close" aria-label="Close" onClick={onClose}>×</button>
        <div>
          <div className="pd-view">
            <Viewer prof={rec.prof} cfg={p} section={section} />
            <div className="pd-toggle">
              <button type="button" className={!section ? 'on' : ''} onClick={() => setSection(false)}>3D</button>
              <button type="button" className={section ? 'on' : ''} onClick={() => setSection(true)}>Section</button>
            </div>
          </div>
          {rec.kind === 'market' && rec.market && (
            <div className="bs-sheet-product">
              {rec.market.image && <img src={rec.market.image} alt={rec.label} referrerPolicy="no-referrer" />}
              <p>Outline read from {rec.market.image ? 'the product photo' : 'its listed height, diameter and mouth'}; gauges typical for its wall. <a href={rec.market.url} target="_blank" rel="noreferrer">Product page</a></p>
            </div>
          )}
          {sketch && rec.kind !== 'sketch' && <div className="bs-sheet-overlay"><Silhouette prof={rec.prof} sketch={sketch} w={150} h={190} /><span>Dashed: your sketch</span></div>}
        </div>
        <div>
          <h2 className="pd-title">{rec.label}</h2>
          <p className="pd-label">{rec.sub}{rec.parent ? ' · fitted from ' + rec.parent : ''}</p>
          <dl className="pd-facts">
            <dt>Capacity</dt><dd>{fmt(m.capacity_ml, 'mL')}</dd>
            <dt>Height</dt><dd>{fmt(m.height_mm, 'mm')} (body; cap not included)</dd>
            <dt>Diameter</dt><dd>{fmt(m.max_d_mm, 'mm')}</dd>
            <dt>Mouth</dt><dd>{fmt(m.mouth_id_mm, 'mm')} · {FAMILY[m.mouth_family] ?? m.mouth_family}</dd>
            <dt>Walls</dt><dd>{p.wall === 'double' ? `${fmt(Number(p.t_outer_mm), 'mm')} outer, ${fmt(Number(p.t_inner_mm), 'mm')} inner, ${fmt(Number(p.gap_mm), 'mm')} gap` : fmt(Number(p.t_mm), 'mm')}</dd>
            <dt>Steel + lid</dt><dd>{fmt(m.mass_g, 'g')}</dd>
            <dt>Spin passes</dt><dd>{fmt(m.spin_passes)}</dd>
            <dt>Bulge</dt><dd>{Math.round(Number(m.bulge_expansion) * 100)}%</dd>
            {m.heat_6h_c !== null && <><dt>After 6 h</dt><dd>{fmt(m.heat_6h_c, '°C')}, rough estimate</dd></>}
          </dl>
          <Verdict ev={ev} />
          {similar.length > 0 && (
            <>
              <h3 className="pd-title">Similar on the market</h3>
              <div className="bs-row">
                {similar.slice(0, 3).map(({p: mp}) => {
                  const r = market.find(x => x.market === mp)!;
                  return (
                    <button key={r.key} type="button" className="bs-tile bs-product" onClick={() => onOpen(r)}>
                      {mp.image ? <img src={mp.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Silhouette prof={r.prof} w={90} h={120} />}
                      <b>{mp.brand}</b><span>{mp.name}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function limitOf(r: Rule, state: RuleState): number | [number, number] {
  const st = state[r.id];
  if (st && typeof st === 'object' && st.limit !== undefined) return st.limit;
  return r.by_form ? r.by_form.bottle : r.limit;
}
function isOn(r: Rule, state: RuleState): boolean {
  const st = state[r.id];
  if (st && typeof st === 'object' && st.on !== undefined) return st.on;
  if (r.market) return state.__market === r.market;
  return r.default_on !== false;
}

function Constraints({book, state, setState, onClose}: {book: Rulebook; state: RuleState; setState: (s: RuleState) => void; onClose: () => void}) {
  const set = (id: string, patch: {on?: boolean; limit?: number | [number, number]}) => {
    const cur = state[id];
    setState({...state, [id]: {...(typeof cur === 'object' ? cur : {}), ...patch}});
  };
  const step = (r: Rule) => (r.scale >= 10 ? 1 : r.scale >= 1 ? 0.1 : 0.01);
  return (
    <div className="bs-drawer-back" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <aside className="bs-drawer" aria-label="Constraints">
        <div className="bs-drawer-head">
          <h2>Constraints</h2>
          <button type="button" className="pd-close" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <label className="bs-market">Market
          <select value={state.__market ?? 'US'} onChange={e => setState({...state, __market: e.target.value})}>
            <option value="US">US · retailer tests</option>
            <option value="EU">EU · EN 12546-1</option>
          </select>
        </label>
        <p className="bs-fine">{book.about}</p>
        {TIER_ORDER.map(tier => (
          <section key={tier}>
            <h3>{book.tiers[tier]}</h3>
            {book.rules.filter(r => r.tier === tier).map(r => {
              const lim = limitOf(r, state), on = isOn(r, state);
              return (
                <div key={r.id} className={'bs-rule' + (on ? '' : ' off')}>
                  <label className="bs-rule-name"><input type="checkbox" checked={on} onChange={e => set(r.id, {on: e.target.checked})} /> {r.name} <Conf c={r.confidence} /></label>
                  <div className="bs-rule-limit">
                    {r.op === 'between' && Array.isArray(lim) ? (
                      <>
                        <input type="number" step={step(r)} value={lim[0]} onChange={e => set(r.id, {limit: [Number(e.target.value), lim[1]]})} />
                        <span>to</span>
                        <input type="number" step={step(r)} value={lim[1]} onChange={e => set(r.id, {limit: [lim[0], Number(e.target.value)]})} />
                      </>
                    ) : (
                      <><span>{r.op === '<=' ? 'at most' : 'at least'}</span><input type="number" step={step(r)} value={lim as number} onChange={e => set(r.id, {limit: Number(e.target.value)})} /></>
                    )}
                    <span>{r.unit}</span>
                  </div>
                  <p>{r.note}{r.source.startsWith('http') && <> <a href={r.source} target="_blank" rel="noreferrer">Source</a></>}</p>
                </div>
              );
            })}
          </section>
        ))}
        <button type="button" className="bs-reset" onClick={() => setState({__market: 'US'})}>Reset to rulebook {book.version}</button>
      </aside>
    </div>
  );
}

export type {Params};
