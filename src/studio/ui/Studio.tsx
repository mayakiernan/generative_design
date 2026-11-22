import {useEffect, useMemo, useRef, useState} from 'react';
import type {AtlasRun} from '../../slots/atlas/item';
import {atlasItem} from '../../slots/atlas/item';
import {atlasDesign} from '../../slots/atlas/view';
import {FAIL_TEXT, failList} from '../../slots/atlas/judge';
import {FormThumb} from '../../slots/ui/AtlasTab';
import {DesignDetail} from '../../slots/ui/KitGallery';
import {parsePurpose, type FunctionSpec} from '../spec';
import {
  candidates, CUT_CLEARANCE, entryOf, inSlice, kitFor, MAX_PIECES, MIN_DIAMETER, reach, rulesFor, scaleAt, sheetCells, sheetOptions,
  spreadOrder, type Judged, type Material, type Reach, type SheetOption,
} from '../query';
import type {JudgeMessage, JudgeRequest} from '../judgeWorker';

// The newest saved form atlas (npm run atlas), fetched when the page opens.
const RUNS = import.meta.glob('/atlas-runs/*/atlas.json', {query: '?url', import: 'default', eager: true}) as Record<string, string>;
const RUN_URL = RUNS[Object.keys(RUNS).sort().reverse()[0]];
const WANT = 24;
const FILL = '#8082a3';
const EXAMPLES = ['side table', 'coffee table', 'plant stand 70 cm tall', 'stool', 'desk', 'bench'];

type Mode = 'circles' | 'sheet';
interface Query {spec: FunctionSpec; material: Material; stable: boolean; options: SheetOption[]}
type Outcome =
  | {kind: 'idle'}
  | {kind: 'error'; text: string}
  | {kind: 'unreachable'; query: Query; reach: Reach}
  | {kind: 'running' | 'done'; query: Query; pool: number; tried: number};

const mm = (x: number) => `${Math.round(x)} mm`;

export function Studio() {
  const [run, setRun] = useState<AtlasRun | null>(null);
  const [loadError, setLoadError] = useState('');
  const [mode, setMode] = useState<Mode>('circles');
  const [circles, setCircles] = useState(24);
  const [diameter, setDiameter] = useState(220);
  const [sheet, setSheet] = useState<[number, number]>([1220, 610]);
  const [purpose, setPurpose] = useState('side table');
  const [stable, setStable] = useState(true);
  const [outcome, setOutcome] = useState<Outcome>({kind: 'idle'});
  const [results, setResults] = useState<Judged[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const worker = useRef<Worker | null>(null);

  useEffect(() => {
    if (!RUN_URL) { setLoadError('No form atlas found. Run npm run atlas first.'); return; }
    fetch(RUN_URL).then(r => r.json()).then(j => setRun(j as AtlasRun), e => setLoadError(e instanceof Error ? e.message : String(e)));
    return () => worker.current?.terminate();
  }, []);
  const pools = useMemo(() => (run ? {stable: candidates(run, true), loose: candidates(run, false)} : null), [run]);

  const heard = useMemo(() => parsePurpose(purpose), [purpose]);

  /** Slice the archive for this material and judge a spread of it at the real kit, streaming what passes. */
  function search(spec: FunctionSpec, material: Material, isStable: boolean, options: SheetOption[]) {
    if (!run || !pools) return;
    worker.current?.terminate();
    setResults([]); setOpen(null);
    const pool = isStable ? pools.stable : pools.loose, query: Query = {spec, material, stable: isStable, options};
    const slice = pool.filter(c => inSlice(c, spec, material, scaleAt(run, material.diameter)));
    if (!slice.length) { setOutcome({kind: 'unreachable', query, reach: reach(run, pool, spec, material)}); return; }
    setOutcome({kind: 'running', query, pool: slice.length, tried: 0});
    const w = new Worker(new URL('../judgeWorker.ts', import.meta.url), {type: 'module'});
    worker.current = w;
    w.onmessage = ({data}: MessageEvent<JudgeMessage>) => {
      if (data.type === 'item') setResults(r => [...r, data.judged]);
      if (data.type === 'error') { setOutcome({kind: 'error', text: data.error}); w.terminate(); return; }
      if (data.type !== 'item' && data.type !== 'miss' && data.type !== 'done') return;
      setOutcome(o => (o.kind === 'running' ? {...o, kind: data.type === 'done' ? 'done' : 'running', tried: data.tried} : o));
      if (data.type === 'done') w.terminate();
    };
    w.onerror = () => { setOutcome({kind: 'error', text: 'Judging stopped. Try again.'}); w.terminate(); };
    const request: JudgeRequest = {keys: spreadOrder(slice).map(c => c.key), spec, diameter: material.diameter, stable: isStable, want: WANT};
    w.postMessage(request);
  }

  function generate() {
    if (!run || !pools) return;
    if (!heard.ok) { setOutcome({kind: 'error', text: heard.reason}); setResults([]); return; }
    const spec = heard.spec;
    if (mode === 'circles') {
      if (diameter < MIN_DIAMETER) { setOutcome({kind: 'error', text: `Discs must be at least ${MIN_DIAMETER} mm across in 1/4 in plywood: smaller ones are too thin beside their slits to build.`}); setResults([]); return; }
      search(spec, {diameter, circles}, stable, []);
      return;
    }
    if (Math.min(...sheet) < MIN_DIAMETER + 6) { setOutcome({kind: 'error', text: `The sheet must be at least ${MIN_DIAMETER + 6} mm on its short side.`}); setResults([]); return; }
    const options = sheetOptions(run, stable ? pools.stable : pools.loose, spec, sheet);
    if (!options.length) {
      setResults([]);
      setOutcome({kind: 'unreachable', query: {spec, material: {diameter: MIN_DIAMETER, circles: sheetCells(sheet, MIN_DIAMETER), sheet}, stable, options}, reach: {minD: null, maxD: null, heights: null}});
      return;
    }
    const best = options.reduce((a, b) => (b.count > a.count ? b : a));
    search(spec, {diameter: best.diameter, circles: best.circles, sheet}, stable, options);
  }

  const q = outcome.kind === 'running' || outcome.kind === 'done' || outcome.kind === 'unreachable' ? outcome.query : null;
  const D = q?.material.diameter ?? diameter;
  const kit = useMemo(() => kitFor(D), [D]);
  const openItem = useMemo(() => {
    if (open === null || !q || !results[open]) return null;
    const j = results[open], title = `${q.spec.label[0].toUpperCase()}${q.spec.label.slice(1)} ${open + 1}`;
    return {
      item: atlasItem(kit, entryOf(j), rulesFor(q.spec, D), title), title,
      cut: atlasDesign(kitFor(D, CUT_CLEARANCE), {key: j.key, steps: j.verdict.steps, top: j.verdict.top}, title),
    };
  }, [open, q, results, kit, D]);

  return (
    <div className="st">
      <header className="st-head">
        <div className="st-brand">Slot Studio</div>
        <p>Circles of 1/4 in plywood, slotted together. Say what it is for and how much you have; get an atlas of designs that work, each with a 3D build, assembly guide and cut sheet.</p>
      </header>

      <form className="st-form" onSubmit={e => { e.preventDefault(); generate(); }}>
        <fieldset>
          <legend><span className="st-n">1</span> Material</legend>
          <div className="st-seg" role="radiogroup" aria-label="Material">
            <button type="button" role="radio" aria-checked={mode === 'circles'} className={mode === 'circles' ? 'on' : ''} onClick={() => setMode('circles')}>Circles</button>
            <button type="button" role="radio" aria-checked={mode === 'sheet'} className={mode === 'sheet' ? 'on' : ''} onClick={() => setMode('sheet')}>Sheet size</button>
          </div>
          {mode === 'circles' ? (
            <div className="st-row">
              <label>Circles<input type="number" min={1} max={60} value={circles} onChange={e => setCircles(Math.max(1, Number(e.target.value) || 1))} /></label>
              <label>Diameter, mm<input type="number" min={MIN_DIAMETER} step={5} value={diameter} onChange={e => setDiameter(Number(e.target.value) || 0)} /></label>
            </div>
          ) : (
            <div className="st-row">
              <label>Width, mm<input type="number" min={200} step={10} value={sheet[0]} onChange={e => setSheet([Number(e.target.value) || 0, sheet[1]])} /></label>
              <label>Height, mm<input type="number" min={200} step={10} value={sheet[1]} onChange={e => setSheet([sheet[0], Number(e.target.value) || 0])} /></label>
            </div>
          )}
          <p className="st-hint">{mode === 'circles'
            ? `A half disc counts as half a circle. At most ${MAX_PIECES} circles are used; discs from ${MIN_DIAMETER} mm.`
            : 'The site tries disc sizes that fit the sheet, top included, and starts on the one with most designs.'}</p>
        </fieldset>

        <fieldset>
          <legend><span className="st-n">2</span> Purpose</legend>
          <input className="st-purpose" type="text" value={purpose} onChange={e => setPurpose(e.target.value)} placeholder="side table, 55 cm tall" aria-label="Purpose" />
          <div className="st-examples">{EXAMPLES.map(x => <button key={x} type="button" onClick={() => setPurpose(x)}>{x}</button>)}</div>
          <p className="st-hint">{heard.ok
            ? `${heard.spec.label}: top ${heard.spec.minH}–${Math.round(heard.spec.maxH)} mm up, at least ${heard.spec.minWidth} mm across, for ${heard.spec.kg} kg${heard.spec.knee ? '. Knee room is not checked yet.' : '.'}`
            : heard.reason}</p>
        </fieldset>

        <fieldset>
          <legend><span className="st-n">3</span> Stability</legend>
          <div className="st-seg" role="radiogroup" aria-label="Stability">
            <button type="button" role="radio" aria-checked={stable} className={stable ? 'on' : ''} onClick={() => setStable(true)}>Stable</button>
            <button type="button" role="radio" aria-checked={!stable} className={!stable ? 'on' : ''} onClick={() => setStable(false)}>Not stable</button>
          </div>
          <p className="st-hint">{stable ? 'Stands on its own, nothing swings or drops out, loads checked for balance (not strength).' : 'Lets through designs that tip or sway, for exploring form. Still buildable, with a surface.'}</p>
        </fieldset>

        <button className="st-go" type="submit" disabled={!run}>{run ? 'Generate' : 'Loading atlas…'}</button>
      </form>
      {loadError && <p className="st-note bad">{loadError}</p>}

      <Status outcome={outcome} found={results.length} onPick={o => q && search(q.spec, {diameter: o.diameter, circles: o.circles, sheet: q.material.sheet}, q.stable, q.options)} />

      {results.length > 0 && q && (
        <div className="st-grid">
          {results.map((j, i) => {
            const e = entryOf(j), m = j.verdict.metrics, box = j.verdict.top ? topBox(j) : null;
            const fails = failList(j.verdict.fails).filter(f => f !== 'short');
            return (
              <button key={j.key} type="button" className="st-card" onClick={() => setOpen(i)}>
                <FormThumb e={e} pitch={kit.p} R={kit.R} />
                <span className="st-meta">
                  <b>{q.spec.label[0].toUpperCase()}{q.spec.label.slice(1)} {i + 1}</b>
                  <span>{circlesOf(j)} circles · {mm(m.height)} tall</span>
                  {box && <span>top {mm(box[0])} × {mm(box[1])}</span>}
                  {fails.length > 0 && <span className="warn">{fails.map(f => FAIL_TEXT[f]).join('; ')}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {openItem && open !== null && <DesignDetail item={openItem.item} index={open + 1} name={openItem.title} fill={FILL} cut={openItem.cut} onClose={() => setOpen(null)} />}
    </div>
  );
}

function topBox(j: Judged): [number, number] {
  const o = j.verdict.top!.outline, xs = o.map(p => p[0]), ys = o.map(p => p[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  return [Math.max(w, h), Math.min(w, h)];
}

function circlesOf(j: Judged): number {
  const mix = j.verdict.metrics.mix;
  return Object.entries(mix).reduce((n, [id, k]) => n + (id === 'H' || id === 'H1' ? k / 2 : k), 0);
}

function Status({outcome, found, onPick}: {outcome: Outcome; found: number; onPick: (o: SheetOption) => void}) {
  if (outcome.kind === 'idle') return null;
  if (outcome.kind === 'error') return <p className="st-note bad">{outcome.text}</p>;
  const {spec, material, stable, options} = outcome.query;
  const choices = options.length > 0 && (
    <div className="st-options" role="radiogroup" aria-label="Disc size">
      <span>From this sheet:</span>
      {options.map(o => (
        <button key={o.diameter} type="button" role="radio" aria-checked={o.diameter === material.diameter} className={o.diameter === material.diameter ? 'on' : ''} onClick={() => onPick(o)}>
          {o.circles} × {o.diameter} mm <span>{o.count} designs</span>
        </button>
      ))}
    </div>
  );
  if (outcome.kind === 'unreachable') {
    const r = outcome.reach, capped = material.circles > MAX_PIECES ? ` (results use at most ${MAX_PIECES})` : '';
    let text: string;
    if (material.sheet && !options.length) text = `No ${spec.label} fits this sheet with its top. Try a bigger sheet, or a lower or smaller purpose.`;
    else if (!r.minD) text = `No ${spec.label} can be made from ${material.circles} circles${capped}: try more circles.`;
    else if (material.diameter < r.minD) text = `With ${material.diameter} mm discs a ${spec.label} comes out too low or too narrow. With ${material.circles} circles${capped} it needs discs of at least ${r.minD} mm${r.maxD ? ` (and at most ${r.maxD} mm)` : ''}.`;
    else if (r.maxD && material.diameter > r.maxD) text = `With ${material.diameter} mm discs a ${spec.label} comes out too tall. Try discs of ${r.minD}–${r.maxD} mm.`;
    else text = `No ${spec.label} in the atlas fits ${material.circles} circles of ${material.diameter} mm${capped}. Try ${r.minD}–${r.maxD} mm discs, or more circles.`;
    return <>{choices}<p className="st-note">{text}</p></>;
  }
  const running = outcome.kind === 'running';
  return (
    <>
      {choices}
      <p className="st-note">
        {running ? `Checking ${spec.label}s at ${material.diameter} mm discs in 1/4 in plywood… ` : ''}
        {found} {found === 1 ? 'design' : 'designs'}{running ? ' so far' : ''}, from {outcome.pool} candidate structures ({outcome.tried} checked at this size).
        {!stable && ' Not stable: drawn from the near misses of the stable atlas until an exploratory atlas exists.'}
        {!running && found === 0 && ' None passed at this exact size: try a slightly different diameter.'}
      </p>
    </>
  );
}
