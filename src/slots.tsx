import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Canvas, useFrame, useThree} from '@react-three/fiber';
import {Line, OrbitControls} from '@react-three/drei';
import * as THREE from 'three';
import type {Design, PanelOut, Result} from './slots/engine';
import {kitDefaults, MATRIX, SLIT_INFO} from './slots/generators';
import {makeModule, type KitParams} from './slots/kit';
import type {V2, V3} from './slots/math';
import type {SlitType} from './slots/panel';
import {describeTravel} from './slots/plan';
import {parsePrompt} from './slots/prompt';
import {describeHold, type Hold} from './slots/stability';
import {assemblyGuideHTML, cutSheetDXF, cutSheetSVG, loopPath, onSheet, packSheet, type Mark} from './slots/svg';
import {coverPiece, finishPieces, KITS, type Intent, type KitId, type Piece} from './slots/kits';
import type {GalleryItem} from './slots/gallery';
import {FOOTPRINT_X, LIMITS, recipeWeights, type Recipe, TABLE_MIN_PIECES, VISIBLE_KITS} from './slots/recipe';
import {SiteTabs} from './components/SiteTabs';
import './slots.css';

const SLITS: SlitType[] = ['cross', 'radial', 'edge', 'tab', 'kit'];
const KIT_SHAPES: [number, string][] = [[3, 'Triangle'], [5, 'Pentagon'], [6, 'Hexagon'], [10, 'Decagon']];
const EXAMPLES = ['small tower', 'side table', 'round coffee table', 'twisted tower 50cm', 'stool with 3 legs', 'sphere'];
const WOOD = ['#e7d2ac', '#dcc296', '#e2caa0', '#d6ba8c', '#ead8b6'];
const ACCENT = '#e95319';
const HOLD_MARK: Record<Hold, string> = {locked: 'locked', seated: 'seated', friction: 'friction', loose: 'loose'};
const f1 = (n: number) => n.toFixed(1);

/* ---------- geometry ---------- */

function buildPanel(p: PanelOut) {
  const {o, u, v, n} = p.frame, h = p.t / 2;
  const at = (q: V2, s: number): [number, number, number] => [o[0] + u[0] * q[0] + v[0] * q[1] + n[0] * s, o[1] + u[1] * q[0] + v[1] * q[1] + n[1] * s, o[2] + u[2] * q[0] + v[2] * q[1] + n[2] * s];
  const pos: number[] = [], nor: number[] = [], edges: number[] = [];
  const tri = (a: number[], b: number[], c: number[], nn: number[]) => { pos.push(...a, ...b, ...c); nor.push(...nn, ...nn, ...nn); };
  const nNeg = [-n[0], -n[1], -n[2]];
  for (const pc of p.pieces) for (let i = 1; i + 1 < pc.length; i++) {
    tri(at(pc[0], h), at(pc[i], h), at(pc[i + 1], h), n);
    tri(at(pc[0], -h), at(pc[i + 1], -h), at(pc[i], -h), nNeg);
  }
  for (const loop of p.loops) for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const out = [(u[0] * dy - v[0] * dx) / l, (u[1] * dy - v[1] * dx) / l, (u[2] * dy - v[2] * dx) / l];
    const a0 = at(a, -h), b0 = at(b, -h), a1 = at(a, h), b1 = at(b, h);
    tri(a0, b0, b1, out); tri(a0, b1, a1, out);
    edges.push(...a1, ...b1, ...a0, ...b0, ...a0, ...a1);
  }
  const mesh = new THREE.BufferGeometry();
  mesh.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  mesh.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
  return {mesh, lines};
}

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

/* ---------- 3D scene (design coordinates are z-up; the group turns them y-up) ---------- */

function Scene({d, step, playing, explode, picked, onPick, onStepDone, colors = WOOD}: {d: Design; step: number; playing: boolean; explode: boolean; picked: number | null; onPick: (i: number | null) => void; onStepDone: () => void; colors?: string[]}) {
  const geo = useMemo(() => d.panels.map(buildPanel), [d]);
  useEffect(() => () => geo.forEach(g => { g.mesh.dispose(); g.lines.dispose(); }), [geo]);
  // A panel appears at its own step; a panel in a group step (a layer built on the bench) waits raised above its
  // place until that step lowers the whole group.
  const rank = useMemo(() => {
    const m = new Map<number, number>();
    d.steps.forEach((s, i) => { if (!s.group && !m.has(s.panel)) m.set(s.panel, i); });
    d.steps.forEach((s, i) => { for (const q of s.group ?? []) if (!m.has(q)) m.set(q, i); });
    return m;
  }, [d]);
  const lowered = useMemo(() => new Map(d.steps.flatMap((s, i) => (s.group ?? []).map(q => [q, i] as const))), [d]);
  const size = Math.max(d.size.width, d.size.depth, d.size.height);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const anim = useRef({t: 1, step: -1});
  const done = useRef(onStepDone);
  done.current = onStepDone;
  const {camera} = useThree();

  useEffect(() => {
    const r = Math.hypot(d.size.width, d.size.depth, d.size.height) * 1.9;
    camera.position.set(r * 0.62, d.size.height * 0.75 + r * 0.32, r * 0.8);
    camera.lookAt(0, d.size.height * 0.42, 0);
  }, [camera, d, size]);

  useEffect(() => { anim.current = {t: playing ? 0 : 1, step}; }, [step, playing]);

  useFrame((_, dt) => {
    const a = anim.current, was = a.t;
    if (a.t < 1) a.t = Math.min(1, a.t + dt / 0.75);
    d.panels.forEach((p, i) => {
      const g = groups.current[i];
      if (!g) return;
      const k = rank.get(p.id) ?? 0, s = d.steps[k];
      g.visible = k < step;
      let off = 0;
      if (k === step - 1 && a.t < 1 && !s.group) off = Math.min(s.distance, size * 0.7) * (1 - ease(a.t));
      // Later panels move further out along their own insertion path, so stacks spread apart too.
      if (explode && k > 0) off += size * (0.12 + (0.5 * k) / Math.max(1, d.steps.length - 1));
      const pos = [-s.travel[0] * off, -s.travel[1] * off, -s.travel[2] * off];
      const gi = lowered.get(p.id);
      if (gi !== undefined && !explode) {
        const G = d.steps[gi], lift = G.distance * (gi >= step ? 1 : gi === step - 1 && a.t < 1 ? 1 - ease(a.t) : 0);
        for (let c = 0; c < 3; c++) pos[c] -= G.travel[c] * lift;
      }
      g.position.set(pos[0], pos[1], pos[2]);
    });
    if (was < 1 && a.t >= 1) done.current();
  });

  const hull = d.support.hull, com = d.support.com, stands = d.support.margin > 0;
  return (
    <>
      <ambientLight intensity={1.25} />
      <directionalLight position={[size * 1.2, size * 2.2, size * 1.4]} intensity={2.4} />
      <directionalLight position={[-size * 1.5, size * 0.8, -size]} intensity={0.8} />
      <group rotation={[-Math.PI / 2, 0, 0]}>
        {d.panels.map((p, i) => {
          const hit = d.hits.some(h => h.a === p.id || h.b === p.id), on = picked === p.id;
          const color = hit ? '#c81e1e' : on ? ACCENT : colors[i % colors.length];
          return (
            <group key={`${d.title}-${i}`} ref={el => { groups.current[i] = el; }} onClick={e => { e.stopPropagation(); onPick(on ? null : p.id); }}>
              <mesh geometry={geo[i].mesh}><meshStandardMaterial color={color} roughness={0.78} metalness={0} /></mesh>
              <lineSegments geometry={geo[i].lines}><lineBasicMaterial color="#5b4a36" transparent opacity={0.55} /></lineSegments>
            </group>
          );
        })}
        {hull.length >= 3 && step >= d.steps.length && !explode && (
          <>
            <Line points={[...hull, hull[0]].map(q => [q[0], q[1], 0.4] as [number, number, number])} color={stands ? '#3c8a5a' : '#c81e1e'} lineWidth={1.6} />
            <Line points={[[com[0], com[1], com[2]], [com[0], com[1], 0.4]]} color={stands ? '#3c8a5a' : '#c81e1e'} lineWidth={1} dashed dashSize={size * 0.02} gapSize={size * 0.015} />
            <mesh position={[com[0], com[1], com[2]]}><sphereGeometry args={[size * 0.012, 16, 12]} /><meshBasicMaterial color={stands ? '#3c8a5a' : '#c81e1e'} /></mesh>
          </>
        )}
        <mesh position={[0, 0, -0.2]}><circleGeometry args={[size * 1.6, 64]} /><meshStandardMaterial color="#f1efe9" roughness={1} /></mesh>
      </group>
      <OrbitControls makeDefault target={[0, d.size.height * 0.42, 0]} />
    </>
  );
}

/* ---------- page ---------- */

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], {type}));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function CutSheet({d, marks}: {d: Design; marks?: Mark[]}) {
  const sheet = useMemo(() => packSheet(d, 12), [d]);
  const byId = new Map(sheet.items.map(it => [it.id, it]));
  return (
    <svg className="sheet" viewBox={`0 0 ${sheet.width} ${sheet.height}`} role="img" aria-label="Cut sheet">
      {sheet.items.map(it => (
        <g key={it.id}>
          <path d={loopPath(it.loops, it.x, it.y)} fillRule="evenodd" />
          {!marks && <text x={it.x + it.w / 2} y={it.y + it.h / 2} fontSize={Math.max(5, Math.min(14, it.w / 9))}>{it.name}</text>}
        </g>
      ))}
      {marks?.map((m, i) => { const it = byId.get(m.panel); if (!it) return null; const [x, y] = onSheet(it, m.at); return <text key={i} x={x} y={y} fontSize={m.size}>{m.text}</text>; })}
    </svg>
  );
}

function PanelGenerator() {
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
    const w = new Worker(new URL('./slots/worker.ts', import.meta.url), {type: 'module'});
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



/* ---------- kit gallery ---------- */

const KIT_FILL: Record<KitId, string> = {circle: '#8082a3', triangle: '#8f9c78', pentagon: '#b4836f', hexagon: '#d2b483', decagon: '#7f9aa6'};
/** A few close shades of one colour, so neighbouring pieces read apart in 3D. */
const tints = (hex: string) => [1.12, 1, 1.22, 0.92, 1.06].map(k => `#${new THREE.Color(hex).multiplyScalar(k).getHexString()}`);
const TOP_FILL = '#ece3d0';

/** One kit piece, flat, with its slits. */
function PieceIcon({p, fill}: {p: Piece; fill: string}) {
  const ext = 1.08 * Math.max(...p.outline.map(q => Math.hypot(q[0], q[1])));
  const path = (pts: V2[]) => `M${pts.map(q => `${q[0].toFixed(1)} ${(-q[1]).toFixed(1)}`).join('L')}Z`;
  return (
    <svg className="piece-icon" viewBox={`${-ext} ${-ext} ${2 * ext} ${2 * ext}`} aria-label={p.name}>
      <title>{p.name}</title>
      <path d={path(p.outline)} fill={fill} />
      {p.cuts.map((c, i) => <path key={i} d={path(c)} fill="#fff" />)}
    </svg>
  );
}

/** Axonometric drawing of a design, pieces painted far to near and shaded by how they face the light. */
function Thumb({d, fill, top = null}: {d: Design; fill: string; top?: number | null}) {
  const view = useMemo(() => {
    const az = -0.65, el = 0.5;
    const r: V3 = [Math.cos(az), Math.sin(az), 0], w: V3 = [Math.sin(az) * Math.cos(el), -Math.cos(az) * Math.cos(el), Math.sin(el)];
    const u: V3 = [w[1] * r[2] - w[2] * r[1], w[2] * r[0] - w[0] * r[2], w[0] * r[1] - w[1] * r[0]];
    const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const light: V3 = [0.35, -0.55, 0.76];
    const polys = d.panels.map(p => {
      const {o, u: pu, v: pv, n} = p.frame;
      const world = (q: V2): V3 => [o[0] + pu[0] * q[0] + pv[0] * q[1], o[1] + pu[1] * q[0] + pv[1] * q[1], o[2] + pu[2] * q[0] + pv[2] * q[1]];
      const loops = p.loops.map(l => l.map(q => { const P = world(q); return [dot(P, r), -dot(P, u)] as V2; }));
      const depth = dot(o, w), shade = 0.62 + 0.38 * Math.abs(dot(n, light));
      return {loops, depth, shade, top: p.id === top};
    }).sort((a, b) => a.depth - b.depth);
    const pts = polys.flatMap(p => p.loops.flat()), x0 = Math.min(...pts.map(q => q[0])), x1 = Math.max(...pts.map(q => q[0])), y0 = Math.min(...pts.map(q => q[1])), y1 = Math.max(...pts.map(q => q[1]));
    const pad = 0.06 * Math.max(x1 - x0, y1 - y0);
    return {polys, box: `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`};
  }, [d]);
  const base = new THREE.Color(fill);
  return (
    <svg className="thumb" viewBox={view.box} aria-hidden>
      {view.polys.map((p, i) => <path key={i} d={loopPath(p.loops)} fillRule="evenodd" fill={`#${(p.top ? new THREE.Color(TOP_FILL) : base.clone()).multiplyScalar(p.shade).getHexString()}`} stroke="#25252e" strokeOpacity={0.7} strokeWidth={0.9} vectorEffect="non-scaling-stroke" />)}
    </svg>
  );
}

/** Number input that lets you type freely and only clamps and commits on blur or Enter. */
function NumberField({value, min, max, step, onCommit, label}: {value: number; min: number; max: number; step: number; onCommit: (v: number) => void; label: string}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const v = Number(draft);
    const next = Number.isFinite(v) && draft.trim() !== '' ? Math.min(max, Math.max(min, v)) : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return <input type="number" inputMode="decimal" aria-label={label} min={min} max={max} step={step} value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />;
}

/** `footprint`: the random form's circle on the floor, as a diameter in piece sizes (so it follows the piece size). */
interface GallerySettings {kit: KitId; intent: Intent; count: number; size: number; t: number; clearance: number; footprint: number; favour: string[]; avoid: string[]; branching: 'chain' | 'mixed' | 'bushy' | null}
const START: GallerySettings = {kit: 'circle', intent: 'any', count: 14, size: 240, t: 6, clearance: 0.2, footprint: FOOTPRINT_X.start, favour: [], avoid: [], branching: null};
/** Briefs to start from: the page has no form buttons, so every set begins as a prompt. */
const BRIEFS = ['a side table about 50 cm tall', 'something random that fits in a 1 m circle', 'a tall tower of small discs', 'a low, wide centrepiece for a dining table'];
type StandFilter = 'all' | 'stands' | 'support';
type ShapeFilter = 'all' | 'upright' | 'low';
/** Upright: at least as tall as it is wide. */
const upright = (it: GalleryItem) => it.design.size.height >= Math.max(it.design.size.width, it.design.size.depth);

function KitGallery() {
  const [cfg, setCfg] = useState<GallerySettings>(START);
  const set = (patch: Partial<GallerySettings>) => setCfg(c => ({...c, ...patch}));
  const [round, setRound] = useState(1);
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState<GalleryItem | null>(null);
  const [brief, setBrief] = useState('');
  const [asking, setAsking] = useState(false);
  const [ai, setAi] = useState<{recipe: Recipe; model: string} | null>(null);
  const [aiError, setAiError] = useState('');
  const [standFilter, setStandFilter] = useState<StandFilter>('all');
  const [shapeFilter, setShapeFilter] = useState<ShapeFilter>('all');
  const kit = KITS.find(k => k.id === VISIBLE_KITS[0])!;
  const kitPieces = useMemo(() => finishPieces(kit.id, 100, 4, 0.2), [kit.id]);
  const cover = useMemo(() => coverPiece(kit.id, 100, 4, 0.2), [kit.id]);
  const table = cfg.intent === 'table', random = cfg.intent === 'random';
  const pieceName = (id: string) => kitPieces.find(p => p.id === id)?.name ?? id;
  const wanted = !table && cfg.count > 16 ? 6 : 9;
  // Nothing grows until a brief has set the engine up.
  const ready = ai !== null;

  useEffect(() => {
    if (!ready) return;
    setBusy(true); setItems([]); setNote(''); setOpen(null);
    const w = new Worker(new URL('./slots/galleryWorker.ts', import.meta.url), {type: 'module'});
    w.onmessage = ({data}) => {
      if (data.type === 'item') setItems(xs => [...xs, data.item]);
      else {
        setBusy(false);
        if (data.type === 'error') setNote(data.error);
        else if (data.type === 'done') setNote(`${data.found} verified from ${data.tried} grown${data.found < wanted ? `. Rejected: ${Object.entries(data.failed as Record<string, number>).map(([k, v]) => `${v} ${k}`).join(', ')}` : ''}.`);
        w.terminate();
      }
    };
    w.onerror = () => { setBusy(false); setNote('The search stopped unexpectedly.'); w.terminate(); };
    const attempts = table ? 200 : Math.round((cfg.intent === 'tower' ? 160 : 70) * (1 + cfg.count / 12));
    w.postMessage({kit: cfg.kit, intent: cfg.intent, count: cfg.count, size: cfg.size, t: cfg.t, clearance: cfg.clearance, footprint: cfg.footprint * cfg.size, seed: round, designs: wanted, attempts, keepFallers: true,
      weights: recipeWeights({favour: cfg.favour as never[], avoid: cfg.avoid as never[]}), branching: cfg.branching ?? undefined});
    return () => w.terminate();
  }, [cfg, round, wanted, table, ready]);

  const askClaude = async (text = brief) => {
    if (!text.trim() || asking) return;
    setAsking(true); setAiError('');
    try {
      const res = await fetch('../api/kit-recipe', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({prompt: text})});
      const data = await res.json().catch(() => ({error: `The server answered ${res.status}.`}));
      if (!res.ok || !data.recipe) throw new Error(data.error ?? `The server answered ${res.status}.`);
      const r = data.recipe as Recipe;
      setAi({recipe: r, model: data.model});
      const footprint = Math.min(FOOTPRINT_X.max, Math.max(FOOTPRINT_X.min, Math.round((r.footprintMm / r.pieceSizeMm) * 4) / 4));
      setCfg(c => ({...c, kit: VISIBLE_KITS[0], intent: r.form, count: r.pieces, size: r.pieceSizeMm, t: r.sheetMm, footprint: r.form === 'random' ? footprint : c.footprint, favour: r.favour, avoid: r.avoid, branching: r.branching}));
      setStandFilter('all'); setShapeFilter('all');
      setRound(x => x + 1);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Could not reach Claude.');
    } finally { setAsking(false); }
  };

  const shown = items.map((it, i) => ({it, n: i + 1})).filter(({it}) =>
    (standFilter === 'all' || (standFilter === 'stands') === it.stands) && (shapeFilter === 'all' || (shapeFilter === 'upright') === upright(it)));
  const count = (f: (it: GalleryItem) => boolean) => items.filter(f).length;
  const chips = <T extends string>(label: string, value: T, setValue: (v: T) => void, options: [T, string, number][]) => (
    <div className="kg-filter" role="radiogroup" aria-label={label}>
      <span className="mono label">{label}</span>
      {options.map(([id, text, n]) => <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? 'on' : ''} onClick={() => setValue(id)}>{text} <span className="muted">{n}</span></button>)}
    </div>
  );

  return (
    <div className="kg">
      <section className="kg-intro">
        <h1>Slot kits</h1>
        <p>Every piece is the same disc, differing only in its slits. Describe what you want, and Claude Opus 5.5 sets up the engine: what to grow, how many pieces, how big. When the design calls for a surface, the engine stacks the discs into a braced grid and sizes a cover to rest on top. Every design is checked before it is shown: nothing overlaps, it builds in order, and nothing can slide out. Most stand on their own; some would need propping, and the filters below sort them. Open one for its build steps and laser files.</p>
      </section>

      <form className="ai-brief" onSubmit={e => { e.preventDefault(); askClaude(); }}>
        <label htmlFor="ai-brief" className="mono label">DESCRIBE IT</label>
        <div className="ai-row">
          <input id="ai-brief" value={brief} onChange={e => setBrief(e.target.value)} maxLength={1000} placeholder="e.g. a tall lantern from cardboard discs, about 40 cm" autoComplete="off" />
          <button type="submit" className="primary" disabled={asking || !brief.trim()}>{asking ? 'Asking Opus 5.5…' : 'Generate'}</button>
        </div>
        {!ready && !asking && <div className="ai-examples">{BRIEFS.map(x => <button key={x} type="button" onClick={() => { setBrief(x); askClaude(x); }}>{x}</button>)}</div>}
        {aiError && <p className="note bad">{aiError}</p>}
        {ai && !aiError && (
          <div className="ai-recipe">
            <b>{ai.recipe.title}</b>
            <span>{ai.recipe.rationale}</span>
            <span className="muted">{ai.recipe.form === 'table' ? 'table with a cover' : ai.recipe.form === 'random' ? `random, inside a ${ai.recipe.footprintMm} mm circle` : ai.recipe.form === 'any' ? 'sculpture' : ai.recipe.form} · {ai.recipe.pieces} pieces · every disc {ai.recipe.pieceSizeMm} mm{ai.recipe.form === 'table' || ai.recipe.form === 'random' ? '' : ` · ${ai.recipe.branching} branching`} · {ai.recipe.sheetMm} mm sheet{ai.recipe.favour.length ? ` · favours ${ai.recipe.favour.map(id => `“${pieceName(id).toLowerCase()}”`).join(' and ')}` : ''}{ai.recipe.avoid.length ? ` · leaves out ${ai.recipe.avoid.map(id => `“${pieceName(id).toLowerCase()}”`).join(' and ')}` : ''} · set by {ai.model}</span>
          </div>
        )}
      </form>

      <div className="kit-card kit-only">
        <span className="kit-pieces">{kitPieces.map(p => <PieceIcon key={p.id} p={p} fill={KIT_FILL[kit.id]} />)}<span className="kit-cover" title="Cover"><PieceIcon p={cover} fill={TOP_FILL} /></span></span>
        <b>{kit.name} kit</b>
        <span>{kit.blurb}</span>
      </div>

      {ready && (
        <div className="kg-controls">
          <label>Pieces <b>{cfg.count}{table ? ' + cover' : ''}</b><input type="range" min={table ? TABLE_MIN_PIECES : LIMITS.pieces[0]} max={LIMITS.pieces[1]} value={cfg.count} onChange={e => set({count: Number(e.target.value)})} /></label>
          {random && <label>Footprint <b>⌀ {Math.round(cfg.footprint * cfg.size)} mm</b><input type="range" aria-label="Diameter of the circle on the floor, in piece sizes" min={FOOTPRINT_X.min} max={FOOTPRINT_X.max} step={0.25} value={cfg.footprint} onChange={e => set({footprint: Number(e.target.value)})} /></label>}
          <label>Piece size <span className="unit"><NumberField label="Size of every piece in mm" value={cfg.size} min={LIMITS.pieceSizeMm[0]} max={LIMITS.pieceSizeMm[1]} step={10} onCommit={v => set({size: v})} />mm</span></label>
          <label>Sheet <span className="unit"><NumberField label="Sheet thickness in mm" value={cfg.t} min={LIMITS.sheetMm[0]} max={LIMITS.sheetMm[1]} step={0.1} onCommit={v => set({t: v})} />mm</span></label>
          <label>Fit <span className="unit">+<NumberField label="Slit clearance in mm" value={cfg.clearance} min={0} max={1} step={0.05} onCommit={v => set({clearance: v})} />mm</span></label>
          <button type="button" className="primary" disabled={busy} onClick={() => setRound(x => x + 1)}>{busy ? 'Growing…' : 'New set'}</button>
        </div>
      )}
      {ready && <p className="muted small fit-note">Slits are cut sheet + fit wide ({(cfg.t + cfg.clearance).toFixed(2)} mm). Enter your measured sheet thickness, and add your laser's kerf allowance to the fit.</p>}

      {ready && items.length > 0 && (
        <div className="kg-filters">
          {chips('STANDING', standFilter, setStandFilter, [['all', 'All', items.length], ['stands', 'Stands', count(it => it.stands)], ['support', 'Needs support', count(it => !it.stands)]])}
          {chips('SHAPE', shapeFilter, setShapeFilter, [['all', 'All', items.length], ['upright', 'Upright', count(upright)], ['low', 'Low', count(it => !upright(it))]])}
        </div>
      )}

      <div className="kg-grid">
        {shown.map(({it, n}) => (
          <button key={it.id} type="button" className="kg-card" onClick={() => setOpen(it)}>
            <Thumb d={it.design} fill={KIT_FILL[cfg.kit]} top={it.top ? it.design.panels.length - 1 : null} />
            {it.top ? (
              <span className="kg-card-meta"><b>Table {n}</b><span>{it.design.panels.length - 1} pieces + cover{it.top.coverScale === 1 ? '' : ` (${it.top.coverScale}×)`} · surface {Math.round(it.top.height)} mm up</span><span className="ok">level · {Math.round(it.top.safeFrac * 100)}% supported{isFinite(it.top.loadKg) ? ` · tips past ${it.top.loadKg >= 100 ? '100+' : it.top.loadKg.toFixed(1)} kg` : ''}</span></span>
            ) : (
              <span className="kg-card-meta"><b>Design {n}</b><span>{it.design.panels.length} pieces · {Math.round(it.design.size.height)} mm tall{it.footprint ? ` · ⌀ ${Math.ceil(it.footprint.needed)} mm` : ''}</span>{it.stands ? <span className="ok">stands · tips at {Math.round(it.design.support.tipDeg)}°</span> : <span className="warn">needs support · {it.design.support.tipDeg > 0 ? `tips at ${it.design.support.tipDeg.toFixed(1)}°` : 'tips over'}</span>}</span>
            )}
          </button>
        ))}
        {busy && Array.from({length: Math.max(0, wanted - items.length)}, (_, i) => <div key={`s${i}`} className="kg-card skeleton" />)}
      </div>
      {ready && !busy && items.length > 0 && shown.length === 0 && <p className="note">No designs in this set match both filters.</p>}
      {note && <p className="note">{note}</p>}
      {open && <DesignDetail item={open} index={items.indexOf(open) + 1} fill={KIT_FILL[cfg.kit]} onClose={() => setOpen(null)} />}
    </div>
  );
}

function DesignDetail({item, index, fill, onClose}: {item: GalleryItem; index: number; fill: string; onClose: () => void}) {
  const d = item.design, n = d.steps.length;
  const [step, setStep] = useState(n);
  const [playing, setPlaying] = useState(false);
  const [explode, setExplode] = useState(false);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const name = `slot-design-${index}`;
  const parts = item.parts.map(p => ({name: p.name, count: p.count}));
  const passed = d.checks.filter(c => c.level !== 'error').length;
  return (
    <div className="kg-detail" role="dialog" aria-modal="true" aria-label={`Design ${index}`} onClick={onClose}>
      <div className="kg-sheet" onClick={e => e.stopPropagation()}>
        <header>
          <div><h2>{item.top ? 'Table' : 'Design'} {index}</h2><p className="muted">{item.stands ? '' : 'Needs support: it tips over standing like this · '}{item.top ? `Cover${item.top.coverScale === 1 ? '' : ` (${item.top.coverScale}× piece size)`} ${Math.round(item.top.height)} mm up, ${Math.round(item.top.safeFrac * 100)}% over its supports · ` : ''}{item.top ? `${d.panels.length - 1} pieces + cover` : `${d.panels.length} pieces`} ·{d.thickness} mm sheet · {Math.round(d.size.width)} × {Math.round(d.size.depth)} × {Math.round(d.size.height)} mm overall</p></div>
          <button type="button" className="close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="kg-body">
          <div className="kg-view">
            <div className="viewport">
              <Canvas camera={{position: [600, 400, 700], fov: 32, near: 1, far: 20000}} dpr={[1, 1.8]}>
                <Scene d={d} step={step} playing={playing} explode={explode} picked={null} onPick={() => {}} colors={item.top ? d.panels.map((_, i) => (i === d.panels.length - 1 ? TOP_FILL : tints(fill)[i % 5])) : tints(fill)} onStepDone={() => { if (playing) { if (step < n) setStep(s => s + 1); else setPlaying(false); } }} />
              </Canvas>
              <div className="view-toggle"><button type="button" className={explode ? '' : 'on'} onClick={() => setExplode(false)}>Assembled</button><button type="button" className={explode ? 'on' : ''} onClick={() => setExplode(true)}>Exploded</button></div>
            </div>
            <div className="build">
              <button type="button" className="play" onClick={() => { if (playing) setPlaying(false); else { setStep(s => (s >= n ? 1 : s + 1)); setPlaying(true); } }}>{playing ? 'Pause' : step >= n ? 'Play build' : 'Resume'}</button>
              <label className="mono label step">STEP <b>{step} / {n}</b><input type="range" min={1} max={n} value={step} onChange={e => { setPlaying(false); setStep(Number(e.target.value)); }} /></label>
            </div>
          </div>
          <div className="kg-info">
            <ul className="verify">{d.checks.map(c => <li key={c.label} className={c.level} title={c.detail}>{c.level === 'ok' ? '✓' : '!'} {c.label}</li>)}</ul>
            <p className="muted small">{passed} of {d.checks.length} checks pass{d.checks.some(c => c.level === 'warn') ? '; ! marks a warning' : ''}. Hover a check for detail.</p>
            <div className="mono label">PARTS</div>
            <ul className="parts-list">{item.parts.map(p => <li key={p.id}><b>{p.count} ×</b> {p.name}</li>)}</ul>
            <div className="mono label">BUILD</div>
            <ol className="steps">{item.steps.map((s, i) => <li key={i} className={i + 1 === step ? 'on' : ''}><button type="button" onClick={() => { setPlaying(false); setStep(i + 1); }}>{s.text}</button></li>)}</ol>
            <div className="mono label">LASER FILES</div>
            <div className="downloads">
              <button type="button" className="primary" onClick={() => download(`${name}.svg`, cutSheetSVG(d, item.marks), 'image/svg+xml')}>Cut sheet · SVG</button>
              <button type="button" onClick={() => download(`${name}.dxf`, cutSheetDXF(d, item.marks), 'application/dxf')}>Cut sheet · DXF</button>
              <button type="button" onClick={() => download(`${name}-assembly.html`, assemblyGuideHTML(`Design ${index}`, d, parts, item.steps, item.marks), 'text/html')}>Assembly guide · HTML</button>
            </div>
            <p className="muted small">Red lines cut, blue text engraves: each piece's number and a letter at each slit. Slits are cut {(d.thickness + d.clearance).toFixed(2)} mm wide for a snug 90° fit.</p>
          </div>
        </div>
        <div className="mono label">CUT SHEET</div>
        <CutSheet d={d} marks={item.marks} />
      </div>
    </div>
  );
}

function App() {
  const [tab, setTab] = useState<'kits' | 'panels'>('kits');
  return (
    <main className="slots">
      <SiteTabs current="slots" />
      <header className="topbar">
        <a className="wordmark" href="../">Possible Pieces</a>
        <nav className="tabs" aria-label="Mode">
          <button type="button" className={tab === 'kits' ? 'on' : ''} aria-current={tab === 'kits' ? 'page' : undefined} onClick={() => setTab('kits')}>Kit gallery</button>
          <button type="button" className={tab === 'panels' ? 'on' : ''} aria-current={tab === 'panels' ? 'page' : undefined} onClick={() => setTab('panels')}>Panel generator</button>
        </nav>
      </header>
      {tab === 'kits' ? <KitGallery /> : <PanelGenerator />}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
