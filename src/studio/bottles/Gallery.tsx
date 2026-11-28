import {Fragment, useEffect, useMemo, useState} from 'react';
import type {Evaluation} from './vendor/model.mjs';
import {type Rec, fmt} from './data';
import {kmeansRows, contrastLabel, featureMean, nearestCenter, type FeatureTable} from './space';
import {Silhouette} from './parts';

/** A top-level cluster from the page, plus the placed extras (market products, fits, the sketch). */
export interface TopGroup { members: number[]; center: number[]; label: string; color: string }
export interface Placed { rec: Rec; z: Float64Array }
interface Group { members: number[]; center: number[]; label: string; color?: string; extras: Placed[] }

const LEAF = 30;       // a group this small shows its designs
const MAX_SPLIT = 6;

/**
 * The design space as a gallery you zoom into: the clusters as cards, each opening into the smaller
 * groups inside it (k-means again on its own designs, labelled by what sets each apart), down to
 * the designs themselves.
 */
export function Gallery({recs, table, w, top, evs, placed, onOpen}: {
  recs: Rec[]; table: FeatureTable; w: number[]; top: TopGroup[]; evs: Evaluation[]; placed: Placed[]; onOpen: (r: Rec) => void;
}) {
  const [path, setPath] = useState<number[]>([]);
  const [onlyMake, setOnlyMake] = useState(true);
  useEffect(() => { setPath([]); }, [top]);

  const keep = (i: number) => !onlyMake || !!evs[i]?.canMake;

  // levels[d] holds the groups shown at depth d; path[d] picks one of them.
  const levels = useMemo(() => {
    const topCenters = top.map(g => g.center);
    const first: Group[] = top.map((g, c) => ({
      members: g.members.filter(keep), center: g.center, label: g.label, color: g.color,
      extras: placed.filter(x => nearestCenter(topCenters, x.z, w) === c),
    }));
    const L: Group[][] = [first];
    for (let d = 0; d < path.length; d++) {
      const parent = L[d][path[d]];
      if (!parent) break;
      const kids = split(parent, table, w);
      if (!kids) break;
      L.push(kids);
    }
    return L;
  }, [top, path, onlyMake, evs, placed, table, w]); // eslint-disable-line react-hooks/exhaustive-deps

  const depth = Math.min(path.length, levels.length);
  const chosen = path.slice(0, depth).map((p, d) => levels[d][p]).filter(Boolean);
  const here = chosen[chosen.length - 1];
  const leaf = depth > 0 && levels.length === depth;   // the chosen group did not split: show its designs
  const shown = depth === 0 ? levels[0] : leaf ? null : levels[depth];

  return (
    <div className="bs-gallery">
      <div className="bs-crumbs">
        <button type="button" className={depth === 0 ? 'on' : ''} onClick={() => setPath([])}>All designs</button>
        {chosen.map((g, d) => (
          <Fragment key={d}>
            <span aria-hidden>›</span>
            <button type="button" className={d === depth - 1 ? 'on' : ''} onClick={() => setPath(path.slice(0, d + 1))}>{g.label}</button>
          </Fragment>
        ))}
        <label className="bs-check bs-crumbs-check"><input type="checkbox" checked={onlyMake} onChange={e => { setOnlyMake(e.target.checked); setPath([]); }} />Only what can be made</label>
      </div>

      {shown && (
        <div className="bs-gcards">
          {shown.map((g, j) => g.members.length > 0 && (
            <GroupCard key={j} g={g} recs={recs} table={table} w={w} evs={evs} onClick={() => setPath([...path.slice(0, depth), j])} />
          ))}
        </div>
      )}

      {leaf && here && (
        <div className="bs-row bs-leaf">
          {here.extras.map(x => (
            <button key={x.rec.key} type="button" className={'bs-tile ' + (x.rec.kind === 'market' ? 'bs-product' : 'bs-tile-' + x.rec.kind)} onClick={() => onOpen(x.rec)}>
              {x.rec.market?.image ? <img src={x.rec.market.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <Silhouette prof={x.rec.prof} w={90} h={120} />}
              <b>{x.rec.market ? x.rec.market.brand : x.rec.label}</b><span>{x.rec.market ? x.rec.market.name : fmt(x.rec.m.capacity_ml, 'mL')}</span>
            </button>
          ))}
          {here.members.slice().sort((a, b) => Number(recs[a].m.capacity_ml) - Number(recs[b].m.capacity_ml)).map(i => (
            <button key={i} type="button" className={'bs-tile' + (evs[i]?.canMake ? '' : ' bs-tile-no')} onClick={() => onOpen(recs[i])}>
              <Silhouette prof={recs[i].prof} w={90} h={120} />
              <b>{fmt(recs[i].m.capacity_ml, 'mL')}</b><span>{recs[i].key}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function split(parent: Group, table: FeatureTable, w: number[]): Group[] | null {
  const n = parent.members.length;
  if (n <= LEAF) return null;
  const k = Math.max(2, Math.min(MAX_SPLIT, Math.round(Math.sqrt(n / 12))));
  const {assign, centers} = kmeansRows(parent.members.map(i => table.rows[i]), w, k, 7);
  const parentMean = featureMean(table, parent.members);
  let kids: Group[] = centers.map((center, j) => ({members: parent.members.filter((_, q) => assign[q] === j), center, label: '', extras: [] as Placed[]}))
    .filter(g => g.members.length > 0);
  if (kids.length < 2) return null;
  for (const x of parent.extras) kids[nearestCenter(kids.map(g => g.center), x.z, w)].extras.push(x);
  kids = kids.sort((a, b) => b.members.length - a.members.length);
  kids.forEach(g => { g.label = contrastLabel(table, w, g.members, parentMean); });
  // Siblings with the same words get a third.
  kids.forEach(g => { if (kids.filter(h => h.label === g.label).length > 1) g.label = contrastLabel(table, w, g.members, parentMean, 3); });
  return kids;
}

// Up to four designs that show the group: the one nearest its centre, then the most different of
// the central 60% (outliers left out), so the card shows its range without its oddities.
function representatives(g: Group, table: FeatureTable, w: number[], evs: Evaluation[]): number[] {
  const d = w.length;
  const dist = (i: number, c: ArrayLike<number>, wc: boolean) => { let q = 0; const r = table.rows[i]; for (let j = 0; j < d; j++) q += (r[j] * w[j] - (wc ? c[j] : c[j] * w[j])) ** 2; return q; };
  let pool = g.members.filter(i => evs[i]?.canMake);
  if (!pool.length) pool = g.members;
  const byCentre = pool.map(i => [i, dist(i, g.center, true)] as [number, number]).sort((a, b) => a[1] - b[1]);
  const core = byCentre.slice(0, Math.max(1, Math.ceil(byCentre.length * 0.6))).map(x => x[0]);
  const picks = [core[0]];
  while (picks.length < Math.min(4, core.length)) {
    let best = -1, bd = -1;
    for (const i of core) {
      if (picks.includes(i)) continue;
      const m = Math.min(...picks.map(p => dist(i, table.rows[p], false)));
      if (m > bd) { bd = m; best = i; }
    }
    if (best < 0) break;
    picks.push(best);
  }
  return picks;
}

function GroupCard({g, recs, table, w, evs, onClick}: {g: Group; recs: Rec[]; table: FeatureTable; w: number[]; evs: Evaluation[]; onClick: () => void}) {
  const reps = useMemo(() => representatives(g, table, w, evs), [g, table, w, evs]);
  const n = g.members.length;
  const make = g.members.filter(i => evs[i]?.canMake).length;
  const caps = g.members.map(i => Number(recs[i].m.capacity_ml)).sort((a, b) => a - b);
  const lo = caps[Math.floor(caps.length * 0.1)], hi = caps[Math.floor(caps.length * 0.9)];
  const mk = g.extras.filter(x => x.rec.kind === 'market');
  const fits = g.extras.filter(x => x.rec.kind === 'fit').length;
  const sketch = g.extras.some(x => x.rec.kind === 'sketch');
  return (
    <button type="button" className="bs-gcard" onClick={onClick}>
      <div className="bs-gcard-sils">{reps.map(i => <Silhouette key={i} prof={recs[i].prof} w={54} h={96} />)}</div>
      <b>{g.color && <i style={{background: g.color}} />}{g.label}</b>
      <span>{n.toLocaleString()} {n === 1 ? 'design' : 'designs'} · {make === n ? 'all can be made' : Math.round((100 * make) / Math.max(n, 1)) + '% can be made'}</span>
      <span>{lo === hi ? fmt(lo, 'mL') : `${fmt(Math.round(lo / 10) * 10)}–${fmt(Math.round(hi / 10) * 10, 'mL')}`}</span>
      {(sketch || fits > 0 || mk.length > 0) && (
        <div className="bs-gcard-tags">
          {sketch && <em className="t-sketch">Your sketch</em>}
          {fits > 0 && <em className="t-fit">{fits} closest buildable</em>}
          {mk.length > 0 && <em className="t-market">{mk.length} on the market</em>}
        </div>
      )}
    </button>
  );
}
