/** The Panel generator tab: a prompt becomes flat panels that slot together, built by a chosen slit type. */
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Canvas} from '@react-three/fiber';
import type {Design, Result} from '../engine';
import {kitDefaults, MATRIX, SLIT_INFO} from '../generators';
import {makeModule, type KitParams} from '../kit';
import type {SlitType} from '../panel';
import {describeTravel} from '../plan';
import {parsePrompt} from '../prompt';
import {describeHold, type Hold} from '../stability';
import {cutSheetSVG} from '../svg';
import {CutSheet, download, Scene, slug} from './shared';

const SLITS: SlitType[] = ['cross', 'radial', 'edge', 'tab', 'kit'];
const KIT_SHAPES: [number, string][] = [[3, 'Triangle'], [5, 'Pentagon'], [6, 'Hexagon'], [10, 'Decagon']];
const EXAMPLES = ['small tower', 'side table', 'round coffee table', 'twisted tower 50cm', 'stool with 3 legs', 'sphere'];
const HOLD_MARK: Record<Hold, string> = {locked: 'locked', seated: 'seated', friction: 'friction', loose: 'loose'};
const f1 = (n: number) => n.toFixed(1);

export function PanelGenerator() {
  const [draft, setDraft] = useState('small tower');
  const [prompt, setPrompt] = useState('small tower');
  const [slit, setSlit] = useState<SlitType>('edge');
  const [thickness, setThickness] = useState<number | null>(null);
  const [clearance, setClearance] = useState(0.2);
  const [seed, setSeed] = useState(1);
  const [kit, setKit] = useState<KitParams | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [explode, setExplode] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const worker = useRef<Worker | null>(null);
  const brief = useMemo(() => parsePrompt(prompt), [prompt]);

  useEffect(() => {
    setBusy(true); setError('');
    worker.current?.terminate();
    const w = new Worker(new URL('../worker.ts', import.meta.url), {type: 'module'});
    worker.current = w;
    w.onmessage = ({data}) => {
      setBusy(false);
      if (data.ok) {
        setResult(data.result);
        setPicked(null);
        const n = data.result.design?.steps.length ?? 0;
        setStep(n > 1 ? 1 : n); setPlaying(n > 1);
      } else setError(data.error);
      w.terminate();
    };
    w.onerror = () => { setBusy(false); setError('The search could not finish.'); w.terminate(); };
    w.postMessage({prompt, slit, thickness, clearance, seed, candidates: slit === 'kit' ? 4 : 6, kit});
    return () => w.terminate();
  }, [prompt, slit, thickness, clearance, seed, kit]);

  const submit = (text: string) => {
    setDraft(text);
    const b = parsePrompt(text);
    if (b.slit) setSlit(b.slit);
    if (b.kitSides) setKit(kitDefaults(b.kitSides));
    setPrompt(text);
    setSeed(1);
  };

  const d = result?.design ?? null;
  const n = d?.steps.length ?? 0;
  const tried = result?.tried ?? [];
  const cell = MATRIX[brief.typology][slit];
  const pickedPanel = d && picked !== null ? d.panels.find(p => p.id === picked) : null;
  const current = d && step > 0 && step <= n ? d.steps[step - 1] : null;

  return (
    <div className="panel-gen">
      <section className="slots-intro">
        <h1>Panels from a prompt</h1>
        <p>Describe a table, tower or sphere. The generator places flat panels, cuts every slit from the path each panel takes into place, then checks the result: no two panels overlap (separating-axis test on every piece), each panel stays in one piece, a build order exists, and the object stands.</p>
      </section>

      <div className="slots-work">
        <aside>
          <form onSubmit={e => { e.preventDefault(); submit(draft); }}>
            <label className="mono label" htmlFor="prompt">PROMPT</label>
            <div className="prompt-row">
              <input id="prompt" value={draft} onChange={e => setDraft(e.target.value)} placeholder="e.g. a small tower, 40cm, twisted" autoComplete="off" />
              <button type="submit" disabled={busy}>Generate</button>
            </div>
          </form>
          <div className="chips">{EXAMPLES.map(x => <button key={x} type="button" onClick={() => submit(x)}>{x}</button>)}</div>
          <p className="heard"><b>{brief.label}</b>{brief.heard.length ? ` · ${brief.heard.join(' · ')}` : ''}</p>
          {brief.unsupported && <p className="note bad">{brief.unsupported}</p>}

          <div className="mono label">SLIT TYPE</div>
          <div className="slit-grid">
            {SLITS.map(s => {
              const c = MATRIX[brief.typology][s];
              return (
                <button key={s} type="button" className={`${s === slit ? 'on' : ''} ${c.gen ? '' : 'off'}`} onClick={() => { setSlit(s); setSeed(1); }} aria-pressed={s === slit}>
                  <SlitIcon kind={s} />
                  <span>{SLIT_INFO[s].name}</span>
                </button>
              );
            })}
          </div>
          <div className="slit-info">
            <p><b>{SLIT_INFO[slit].joins}</b></p>
            <p>{SLIT_INFO[slit].rule}</p>
            <p className={cell.gen ? '' : 'bad'}>For a {brief.typology}: {cell.what}.</p>
          </div>

          {slit === 'kit' && <KitPanel kit={kit ?? result?.kit?.kit ?? kitDefaults(brief.typology === 'tower' ? 6 : 10)} report={result?.kit ?? null} t={d?.thickness ?? thickness ?? 4} clearance={clearance} onChange={k => { setKit(k); setSeed(1); }} />}

          <div className="mono label">SHEET</div>
          <div className="sheet-row">
            <label>Thickness
              <span className="unit"><input type="number" min={2} max={30} step={0.5} value={thickness ?? ''} placeholder={d ? String(d.thickness) : 'auto'} onChange={e => setThickness(e.target.value ? Number(e.target.value) : null)} />mm</span>
            </label>
            <label>Fit clearance <b>{clearance.toFixed(2)} mm</b>
              <input type="range" min={0} max={0.6} step={0.05} value={clearance} onChange={e => setClearance(Number(e.target.value))} />
            </label>
          </div>

          <div className="actions">
            <button type="button" disabled={busy} onClick={() => setSeed(s => s + 1)}>{busy ? 'Searching…' : 'Another variant'}</button>
            <button type="button" disabled={!d} onClick={() => d && download(`${slug(d.title)}-cut-sheet.svg`, cutSheetSVG(d), 'image/svg+xml')}>Download cut sheet (SVG, mm)</button>
            <button type="button" disabled={!d} onClick={() => d && download(`${slug(d.title)}.json`, JSON.stringify(d, null, 1), 'application/json')}>Download design (JSON)</button>
          </div>
        </aside>

        <section className="stage">
          <div className={`viewport${busy ? ' busy' : ''}`}>
            {d ? (
              <Canvas camera={{position: [600, 400, 700], fov: 32, near: 1, far: 20000}} dpr={[1, 1.8]} onPointerMissed={() => setPicked(null)}>
                <Scene d={d} step={step} playing={playing} explode={explode} picked={picked} onPick={setPicked} onStepDone={() => { if (playing) { if (step < n) setStep(s => s + 1); else setPlaying(false); } }} />
              </Canvas>
            ) : (
              <div className="empty">{busy ? 'Searching…' : result?.unsupported || error || (result && !result.design ? `No candidate could be built: ${[...new Set(result.tried.map(x => x.why))].join('; ')}` : '')}</div>
            )}
            {d && <div className="legend mono"><i className="sw ok" />support outline and centre of mass · click a panel</div>}
            {d && <div className="view-toggle"><button type="button" className={explode ? '' : 'on'} onClick={() => setExplode(false)}>Assembled</button><button type="button" className={explode ? 'on' : ''} onClick={() => setExplode(true)}>Exploded</button></div>}
          </div>

          {d && (
            <>
              <div className="build">
                <button type="button" className="play" onClick={() => { if (playing) setPlaying(false); else { setStep(s => (s >= n ? 1 : s + 1)); setPlaying(true); } }}>{playing ? 'Pause' : step >= n ? 'Replay build' : 'Play build'}</button>
                <label className="mono label step">BUILD STEP <b>{step} / {n}</b>
                  <input type="range" min={0} max={n} value={step} onChange={e => { setPlaying(false); setStep(Number(e.target.value)); }} />
                </label>
              </div>
              <p className="now">{current ? <>Step {step}: <b>{d.panels[current.panel].name}</b>, {step === 1 ? 'place it' : current.how}.</> : 'Drag to orbit, scroll to zoom.'}</p>

              <div className="verdict">
                <h2>{d.title} <span className={d.ok ? 'pill ok' : 'pill bad'}>{d.ok ? 'verified' : 'fails a check'}</span></h2>
                <p className="muted">{SLIT_INFO[d.slit].name} · {d.panels.length} panels · {d.thickness} mm sheet · {Math.round(d.size.width)} × {Math.round(d.size.depth)} × {Math.round(d.size.height)} mm · {Math.round(d.support.mass)} g in plywood · best of {tried.length} candidates ({tried.filter(x => x.ok).length} passed)</p>
              </div>

              <div className="report">
                <div>
                  <div className="mono label">CHECKS</div>
                  <ul className="checks">{d.checks.map(c => <li key={c.label} className={c.level}><span>{c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✗'}</span><b>{c.label}</b> {c.detail}</li>)}</ul>
                  <div className="mono label">DESIGN</div>
                  <dl className="stats">{d.params.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>
                </div>
                <div>
                  <div className="mono label">PARTS · HOW EACH IS HELD</div>
                  <table className="parts">
                    <thead><tr><th>#</th><th>Panel</th><th>Goes in</th><th>Held</th><th>Bridge</th></tr></thead>
                    <tbody>{d.steps.map((s, i) => {
                      const p = d.panels[s.panel];
                      return (
                        <tr key={p.id} className={picked === p.id ? 'on' : ''} onClick={() => setPicked(p.id)}>
                          <td>{i + 1}</td><td>{p.name}</td><td>{i === 0 ? 'placed' : describeTravel(s.travel).replace(/ \(heading.*\)/, '')}</td>
                          <td className={`hold ${p.hold}`} title={describeHold[p.hold]}>{HOLD_MARK[p.hold]}</td><td>{f1(p.ligament)} mm</td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                  {pickedPanel && <p className="note">{pickedPanel.name}: {describeHold[pickedPanel.hold]}. {pickedPanel.cuts.filter(c => c.kind !== 'design').length} slit/slot cuts; thinnest bridge {f1(pickedPanel.ligament)} mm.</p>}
                  <JointTable d={d} />
                </div>
              </div>

              <div className="mono label">CUT SHEET · {d.panels.length} PANELS, {d.thickness} MM</div>
              <CutSheet d={d} />
              {d.notes.length > 0 && <p className="note">{d.notes.join(' ')}</p>}
            </>
          )}
          {!d && result?.unsupported && <p className="note bad">{result.unsupported}</p>}
          {error && <p className="note bad">{error}</p>}
        </section>
      </div>
    </div>
  );
}

/** One row per distinct crossing: angle between the panels and the slit width the formula gives. */
function JointTable({d}: {d: Design}) {
  const rows = new Map<string, {slit: SlitType; mode: string; angle: number; width: number; count: number}>();
  for (const j of d.joints) {
    const key = `${j.slit}-${j.mode}-${Math.round(j.angleDeg)}`;
    const r = rows.get(key);
    if (r) r.count++;
    else rows.set(key, {slit: j.slit, mode: j.mode, angle: j.angleDeg, width: j.slitWidth, count: 1});
  }
  const label = (m: string) => (m === 'lap' ? 'half-lap' : m === 'through' ? 'relief channel' : 'tab slot');
  return (
    <>
      <div className="mono label">JOINTS</div>
      <table className="parts">
        <thead><tr><th>Count</th><th>Kind</th><th>Panel angle</th><th>Slot width</th></tr></thead>
        <tbody>{[...rows.values()].map((r, i) => (
          <tr key={i}><td>{r.count}</td><td>{label(r.mode)}</td><td>{Math.round(r.angle)}°</td><td>{r.mode === 'moving' ? `${f1(d.thickness + d.clearance)} mm` : `${f1(r.width)} mm`}</td></tr>
        ))}</tbody>
      </table>
      <p className="formula">Slot width for panels meeting at θ: (t + t·|cos θ|) / sin θ + clearance. At 90° that is just the sheet plus clearance.</p>
    </>
  );
}

/** Kit shape and slit settings, a drawing of one piece, and what this kit admits. */
function KitPanel({kit, report, t, clearance, onChange}: {kit: KitParams; report: Result['kit']; t: number; clearance: number; onChange: (k: KitParams) => void}) {
  const [draft, setDraft] = useState(kit);
  useEffect(() => setDraft(kit), [kit]);
  const piece = useMemo(() => makeModule(draft, 100, t, clearance), [draft, t, clearance]);
  const ext = 1.15 * Math.max(...piece.outline.map(q => Math.hypot(q[0], q[1])));
  const commit = (k: KitParams) => { setDraft(k); onChange(k); };
  const slider = (label: string, key: 'slitAngle' | 'slitAt' | 'slitLength' | 'slitWidth', min: number, max: number, step: number, fmt: (x: number) => string) => (
    <label>{label} <b>{fmt(draft[key])}</b>
      <input type="range" min={min} max={max} step={step} value={draft[key]} onChange={e => setDraft({...draft, [key]: Number(e.target.value)})} onPointerUp={() => onChange(draft)} onKeyUp={() => onChange(draft)} />
    </label>
  );
  const rings = new Map<number, boolean>();
  for (const r of report?.rings ?? []) rings.set(r.pieces, (rings.get(r.pieces) ?? false) || r.clear);
  return (
    <div className="kit">
      <div className="mono label">KIT PIECE</div>
      <div className="kit-shapes">{KIT_SHAPES.map(([n, name]) => <button key={n} type="button" className={n === draft.sides ? 'on' : ''} onClick={() => commit(kitDefaults(n))}>{name}</button>)}</div>
      <svg className="kit-piece" viewBox={`${-ext} ${-ext} ${2 * ext} ${2 * ext}`} aria-label="One kit piece">
        <path d={`M${piece.outline.map(q => `${q[0]} ${-q[1]}`).join('L')}Z`} className="body" />
        {piece.cuts.map((c, i) => <path key={i} d={`M${c.map(q => `${q[0]} ${-q[1]}`).join('L')}Z`} className="slit" />)}
      </svg>
      <div className="sheet-row">
        {slider('Slit angle', 'slitAngle', -45, 45, 1, x => `${x}°`)}
        {slider('Slit position', 'slitAt', 0.12, 0.6, 0.01, x => `${Math.round(x * 100)}% along edge`)}
        {slider('Slit length', 'slitLength', 0.06, 0.4, 0.01, x => `${Math.round(x * 100)}% of side`)}
        {slider('Slit width', 'slitWidth', 1.05, 3, 0.05, x => `${x.toFixed(2)} × sheet`)}
      </div>
      {report && (
        <div className="kit-report">
          {report.problem ? <p className="bad">Can’t be cut: {report.problem}.</p> : (
            <>
              <p>Pieces fit together at <b>{Math.round(report.fitDeg[0])}°–{Math.round(report.fitDeg[1])}°</b>: (t + t|cos θ|) / sin θ must fit the slit.</p>
              <p>Closes flat rings of {rings.size ? [...rings.entries()].sort((a, b) => a[0] - b[0]).map(([n, ok], i) => <span key={n} className={ok ? 'ok' : 'clash'}>{i ? ', ' : ''}{n}{ok ? '' : ' (collides)'}</span>) : <b>none</b>} pieces. Any other pair of joint angles makes a helix.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SlitIcon({kind}: {kind: SlitType}) {
  const stroke = {stroke: 'currentColor', strokeWidth: 1.6, fill: 'none'} as const;
  if (kind === 'cross') return <svg viewBox="0 0 40 28" aria-hidden><rect x="4" y="6" width="32" height="18" {...stroke} /><path d="M20 6v9" {...stroke} /></svg>;
  if (kind === 'radial') return <svg viewBox="0 0 40 28" aria-hidden><rect x="4" y="4" width="32" height="20" {...stroke} /><path d="M20 4v6M20 18v6" {...stroke} /></svg>;
  if (kind === 'edge') return <svg viewBox="0 0 40 28" aria-hidden><rect x="4" y="6" width="32" height="18" {...stroke} /><path d="M9 6v5M31 24v-5" {...stroke} /></svg>;
  if (kind === 'kit') return <svg viewBox="0 0 40 28" aria-hidden><path d="M20 3l11 8-4 13H13L9 11z" {...stroke} /><path d="M24 6l-3 5M30 17l-5-1M22 24l1-5M11 17l5-2M13 8l4 4" {...stroke} /></svg>;
  return <svg viewBox="0 0 40 28" aria-hidden><path d="M4 24V12h8V8h6v4h4V8h6v4h8v12z" {...stroke} /></svg>;
}



