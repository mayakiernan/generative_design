import {useEffect, useMemo, useRef, useState, type FormEvent} from 'react';
import type {AtlasRun} from '../../slots/atlas/item';
import {atlasItem} from '../../slots/atlas/item';
import {atlasDesign} from '../../slots/atlas/view';
import {FAIL_TEXT, failList} from '../../slots/atlas/judge';
import {FormThumb} from '../../slots/ui/AtlasTab';
import {parsePurpose, type FunctionSpec} from '../spec';
import {
  candidates, CUT_CLEARANCE, STUDIO_RUN, entryOf, inSlice, kitFor, MAX_PIECES, MIN_DIAMETER, reach, rulesFor, scaleAt,
  spreadOrder, type Judged, type Material, type Reach,
} from '../query';
import type {JudgeMessage, JudgeRequest} from '../judgeWorker';
import {DotArrow, Mark} from './Shapes';
import {Detail} from './Detail';
import type {StepHold} from '../../slots/atlas/holds';
import {queueIso} from './isoThumbs';

// The pinned form atlas run (query.ts STUDIO_RUN), fetched when the page opens.
const RUNS = import.meta.glob('/atlas-runs/*/atlas.json', {query: '?url', import: 'default', eager: true}) as Record<string, string>;
const RUN_URL = RUNS[`/atlas-runs/${STUDIO_RUN}/atlas.json`];
const WANT = 24;
const IN = 25.4;
/** Inches, to the nearest half. */
const inch = (mm: number) => `${Math.round((mm / IN) * 2) / 2}`;
const MIN_IN = Math.ceil((MIN_DIAMETER / IN) * 2) / 2;

interface Query {spec: FunctionSpec; material: Material; stable: boolean}
type Outcome =
  | {kind: 'idle'}
  | {kind: 'error'; text: string}
  | {kind: 'unreachable'; query: Query; reach: Reach}
  | {kind: 'running' | 'done'; query: Query; pool: number; tried: number};

/**
 * The atlas page: say the disc size, how many, what it is for and stable or artistic, then search. Designs stream
 * in below; each opens to its 3D build, assembly guide and cut sheet.
 */
export function Atlas() {
  const [run, setRun] = useState<AtlasRun | null>(null);
  const [loadError, setLoadError] = useState('');
  const [circles, setCircles] = useState(24);
  const [inches, setInches] = useState(9);
  const [purpose, setPurpose] = useState('side table');
  const [stable, setStable] = useState(true);
  const [outcome, setOutcome] = useState<Outcome>({kind: 'idle'});
  const [results, setResults] = useState<Judged[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  /** Isometric renders by design key and diameter, as image URLs. */
  const [iso, setIso] = useState<Record<string, string>>({});
  const worker = useRef<Worker | null>(null);

  useEffect(() => {
    if (!RUN_URL) { setLoadError('No form atlas found.'); return; }
    fetch(RUN_URL).then(r => r.json()).then(j => setRun(j as AtlasRun), e => setLoadError(e instanceof Error ? e.message : String(e)));
    return () => worker.current?.terminate();
  }, []);
  const pools = useMemo(() => (run ? {stable: candidates(run, true), loose: candidates(run, false), free: candidates(run, false, false)} : null), [run]);

  /** Slice the archive for this material and judge a spread of it at the real kit, streaming what passes. */
  function search(spec: FunctionSpec, material: Material, isStable: boolean) {
    if (!run || !pools) return;
    worker.current?.terminate();
    setResults([]); setOpen(null);
    const pool = spec.role === 'none' ? pools.free : isStable ? pools.stable : pools.loose, query: Query = {spec, material, stable: isStable};
    const slice = pool.filter(c => inSlice(c, spec, material, scaleAt(run, material.diameter)));
    if (!slice.length) { setOutcome({kind: 'unreachable', query, reach: reach(run, pool, spec, material)}); return; }
    setOutcome({kind: 'running', query, pool: slice.length, tried: 0});
    const w = new Worker(new URL('../judgeWorker.ts', import.meta.url), {type: 'module'});
    worker.current = w;
    w.onmessage = ({data}: MessageEvent<JudgeMessage>) => {
      if (data.type === 'item') {
        setResults(r => [...r, data.judged]);
        const id = `${data.judged.key}@${material.diameter}`;
        queueIso({key: data.judged.key, top: data.judged.verdict.top, rest: data.judged.verdict.rest, diameter: material.diameter}, url => setIso(m => ({...m, [id]: url})));
      }
      if (data.type === 'error') { setOutcome({kind: 'error', text: data.error}); w.terminate(); return; }
      setOutcome(o => (o.kind === 'running' ? {...o, kind: data.type === 'done' ? 'done' : 'running', tried: data.tried} : o));
      if (data.type === 'done') w.terminate();
    };
    w.onerror = () => { setOutcome({kind: 'error', text: 'The search stopped. Try again.'}); w.terminate(); };
    const order = spreadOrder(slice);
    const request: JudgeRequest = {keys: order.map(c => c.key), rests: Object.fromEntries(order.filter(c => c.rest).map(c => [c.key, c.rest!])), spec, diameter: material.diameter, stable: isStable, want: WANT};
    w.postMessage(request);
  }

  function go() {
    if (!run || !pools) return;
    const heard = parsePurpose(purpose);
    setResults([]);
    if (!heard.ok) { setOutcome({kind: 'error', text: heard.reason}); return; }
    if (!(inches >= MIN_IN)) { setOutcome({kind: 'error', text: `Discs need to be at least ${MIN_IN} in across in 1/4 in plywood.`}); return; }
    search(heard.spec, {diameter: Math.round(inches * IN), circles: Math.max(1, Math.round(circles))}, stable);
    scrollTo({top: 0, behavior: 'smooth'});
  }

  const q = outcome.kind === 'running' || outcome.kind === 'done' || outcome.kind === 'unreachable' ? outcome.query : null;
  const D = q?.material.diameter ?? Math.round(inches * IN);
  const kit = useMemo(() => kitFor(D), [D]);
  const label = q ? titleCase(q.spec.label) : '';
  // A design's number is its place in the pinned atlas, so the same design keeps it from search to search.
  const ids = useMemo(() => new Map(pools?.free.map((c, i) => [c.key, i + 1]) ?? []), [pools]);
  const nameOf = (j: Judged) => `${label} #${ids.get(j.key) ?? '?'}`;
  const openItem = useMemo(() => {
    if (open === null || !q || !results[open]) return null;
    const j = results[open], title = nameOf(j);
    return {
      item: atlasItem(kit, entryOf(j), rulesFor(q.spec, D), title), title,
      cut: atlasDesign(kitFor(D, CUT_CLEARANCE), {key: j.key, steps: j.verdict.steps, top: j.verdict.top, rest: j.verdict.rest}, title),
    };
  }, [open, q, results, kit, D, label, ids]);
  // The drawn disc grows with the diameter asked for, within the panel.
  const discScale = Math.min(1, Math.max(0.55, 0.55 + ((inches - MIN_IN) / (24 - MIN_IN)) * 0.45));
  const searched = outcome.kind !== 'idle';
  const submit = (e: FormEvent) => { e.preventDefault(); go(); };

  const fields = {
    diameter: <input className="pa-num" type="number" min={MIN_IN} max={48} step={0.5} value={inches} onChange={e => setInches(Number(e.target.value))} aria-label="Disc diameter in inches" style={{width: `${String(inches).length + 1.2}ch`}} />,
    circles: <input className="pa-num" type="number" min={1} max={60} value={circles} onChange={e => setCircles(Number(e.target.value))} aria-label="Number of circles" style={{width: `${String(circles).length + 1.2}ch`}} />,
    purpose: <input className="pa-text" type="text" value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="purpose…" aria-label="Purpose" />,
    mode: (
      <div className="pa-mode" role="radiogroup" aria-label="Stable or artistic">
        <button type="button" role="radio" aria-checked={stable} className={stable ? 'on' : ''} onClick={() => setStable(true)}>Stable</button>
        <span aria-hidden>/</span>
        <button type="button" role="radio" aria-checked={!stable} className={!stable ? 'on' : ''} onClick={() => setStable(false)}>Artistic</button>
      </div>
    ),
  };

  return (
    <div className="pa">
      {!searched ? (
        <form className="pa-panel" onSubmit={submit}>
          <a className="pa-home" href="../" aria-label="Probable Pieces home"><Mark /></a>
          <div className="pa-left">
            <div className="pa-disc" style={{['--s' as string]: discScale}} aria-hidden><span /></div>
            <label className="pa-line">Diameter {fields.diameter} in</label>
          </div>
          <div className="pa-rule" aria-hidden />
          <div className="pa-right">
            <label className="pa-line">I have {fields.circles} circles</label>
            <label className="pa-line pa-purpose">The purpose of this is {fields.purpose}</label>
            {fields.mode}
            <button className="pa-go" type="submit" disabled={!run}>
              <span>{run ? 'Atlas' : 'Loading…'}</span>
              <DotArrow />
            </button>
          </div>
        </form>
      ) : (
        <form className="pa-bar" onSubmit={submit}>
          <a className="pa-home" href="../" aria-label="Probable Pieces home"><Mark /></a>
          <button className="pa-bar-title" type="submit" disabled={!run} title="Search again">Atlas</button>
          <div className="pa-bar-fields">
            <label className="pa-bar-purpose">{fields.purpose}</label>
            {fields.mode}
            <label className="pa-line"># of {fields.circles}</label>
            <span className="pa-disc pa-disc-small" aria-hidden><span /></span>
            <label className="pa-line">Diameter {fields.diameter} in</label>
          </div>
        </form>
      )}

      {searched && (
        <div className="pa-results">
          {loadError && <p className="pa-note bad">{loadError}</p>}
          <Status outcome={outcome} found={results.length} />
          {results.length > 0 && q && (
            <div className="pa-grid">
              {results.map((j, i) => {
                const m = j.verdict.metrics, box = j.verdict.top ? topBox(j) : null;
                const fails = failList(j.verdict.fails).filter(f => f !== 'short');
                const width = box ? box[0] : m.spread;
                return (
                  <button key={j.key} type="button" className={`pa-card ${TILE[i % TILE.length]}`} onClick={() => setOpen(i)} title={fails.length ? fails.map(f => FAIL_TEXT[f]).join('; ') : undefined}>
                    <span className="pa-tile">
                      {iso[`${j.key}@${D}`]
                        ? <img className="pa-iso" src={iso[`${j.key}@${D}`]} alt="" />
                        : <span className="pa-pending"><FormThumb e={entryOf(j)} pitch={kit.p} R={kit.R} fill="#b5b5b0" topFill="#d6d6d2" /></span>}
                    </span>
                    <span className="pa-meta">
                      <b>{nameOf(j)}</b>
                      <span>H: {inch(m.height)}″ W: {inch(width)}″</span>
                      {j.holds && <span className="pa-hands">{handsText(j.holds)}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {openItem && open !== null && (
        <Detail item={openItem.item} cut={openItem.cut} title={openItem.title} diameter={D} holds={results[open]?.holds} onClose={() => setOpen(null)}
          onPrev={open > 0 ? () => setOpen(open - 1) : undefined} onNext={open < results.length - 1 ? () => setOpen(open + 1) : undefined} />
      )}
    </div>
  );
}

/** Tile sizes in the order the grid repeats them: mostly single, some wide, now and then a big one. */
const TILE = ['', '', '', '', '', 'wide', '', '', '', 'big', 'wide'];
/** "Builds alone", or how many build steps need someone holding the part built so far. */
const handsText = (holds: StepHold[]) => { const n = holds.filter(h => h.needs).length; return n ? `A hand at ${n} of ${holds.length} steps` : 'Builds alone'; };
const titleCase = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());

function topBox(j: Judged): [number, number] {
  const o = j.verdict.top!.outline, xs = o.map(p => p[0]), ys = o.map(p => p[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  return [Math.max(w, h), Math.min(w, h)];
}

function Status({outcome, found}: {outcome: Outcome; found: number}) {
  if (outcome.kind === 'idle') return null;
  if (outcome.kind === 'error') return <p className="pa-note bad">{outcome.text}</p>;
  const {spec, material, stable} = outcome.query, d = inch(material.diameter);
  if (outcome.kind === 'unreachable') {
    const r = outcome.reach, capped = material.circles > MAX_PIECES ? ` (at most ${MAX_PIECES} are used)` : '';
    let text: string;
    if (!r.minD) text = `No ${spec.label} can be made from ${material.circles} circles${capped}. Try more circles.`;
    else if (material.diameter < r.minD) text = `With ${d} in discs a ${spec.label} comes out too low or too narrow. With ${material.circles} circles${capped} it needs discs of at least ${inch(r.minD)} in${r.maxD ? `, and at most ${inch(r.maxD)} in` : ''}.`;
    else if (r.maxD && material.diameter > r.maxD) text = `With ${d} in discs a ${spec.label} comes out too tall. Try discs of ${inch(r.minD)}–${inch(r.maxD)} in.`;
    else text = `No ${spec.label} fits ${material.circles} circles of ${d} in${capped}. Try ${inch(r.minD)}–${inch(r.maxD!)} in discs, or more circles.`;
    return <p className="pa-note">{text}</p>;
  }
  const running = outcome.kind === 'running';
  return (
    <p className="pa-note">
      {found} {found === 1 ? spec.label : plural(spec.label)}{running ? '…' : ''}
      {!stable && ' · artistic: these may tip or sway'}
      {!running && found === 0 && ` · none held up at ${d} in: try a slightly different diameter`}
    </p>
  );
}

const plural = (w: string) => (/(ch|sh|s|x)$/.test(w) ? `${w}es` : `${w}s`);
