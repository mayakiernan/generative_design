import React, {useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Canvas, useThree} from '@react-three/fiber';
import {Html, OrbitControls} from '@react-three/drei';
import * as THREE from 'three';
import {makeDesign} from './hubs/pipeline';
import {plateSTL} from './hubs/browserPlate';
import {SHAPES} from './hubs/shapes';
import type {Hole, StickDesign, StickStatus} from './hubs/design';
import {add, scale, type V3} from './hubs/vec';
import './hubs.css';

const STATUS_COLOR: Record<StickStatus, string> = {ok: '#d9bf8f', cut: '#e95319', long: '#c81e1e'};
const HUB = '#ece9e1', HUB_ON = '#e95319';
const up = new THREE.Vector3(0, 1, 0);
const f1 = (n: number) => n.toFixed(1);

/** A cylinder from a to b (z-up design coordinates are rotated to y-up by the parent group). */
function Bar({a, b, r, color, opacity = 1}: {a: V3; b: V3; r: number; color: string; opacity?: number}) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), d = vb.clone().sub(va);
  return (
    <mesh position={va.clone().add(vb).multiplyScalar(0.5)} quaternion={new THREE.Quaternion().setFromUnitVectors(up, d.clone().normalize())}>
      <cylinderGeometry args={[r, r, d.length(), 14]} />
      <meshStandardMaterial color={color} roughness={0.55} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  );
}

/** Preview of a printed hub: core sphere plus one sleeve per hole, sized as in the STL. */
function HubPreview({at, holes, d, color, opacity}: {at: V3; holes: Hole[]; d: StickDesign; color: string; opacity: number}) {
  const rt = d.params.boreDiameter / 2 + d.params.wall;
  return (
    <group>
      <mesh position={at}><sphereGeometry args={[Math.max(rt * 1.45, d.params.minStop + 0.4), 16, 12]} /><meshStandardMaterial color={color} roughness={0.35} transparent={opacity < 1} opacity={opacity} /></mesh>
      {holes.map(h => <Bar key={h.stick} a={at} b={add(at, scale(h.dir, h.stop + d.params.insertion))} r={rt} color={color} opacity={opacity} />)}
    </group>
  );
}

function Scene({d, step, selected, onSelect}: {d: StickDesign; step: number; selected: number | null; onSelect: (i: number) => void}) {
  const shown = new Set(d.order.slice(0, step));
  const hubsShown = new Set<number>();
  shown.forEach(e => d.sticks[e].hubs.forEach(h => hubsShown.add(h)));
  if (step > 0 || !d.order.length) hubsShown.add(d.sticks[d.order[0]]?.hubs[0] ?? 0);
  const ext = [0, 1, 2].map(k => [Math.min(...d.nodes.map(n => n[k])), Math.max(...d.nodes.map(n => n[k]))]);
  const center: V3 = [(ext[0][0] + ext[0][1]) / 2, (ext[1][0] + ext[1][1]) / 2, 0];
  const size = Math.max(...ext.map(([a, b]) => b - a));
  const dim = (i: number) => (selected === null || selected === i ? 1 : 0.35);
  const {camera} = useThree();
  const height = ext[2][1] - ext[2][0];
  // Frame the whole model whenever the shape changes.
  useEffect(() => {
    const r = (0.65 * size) / Math.tan((32 * Math.PI) / 360); // fov 32°, with margin
    camera.position.copy(new THREE.Vector3(0.55, 0.45, 0.7).normalize().multiplyScalar(r).add(new THREE.Vector3(0, height / 3, 0)));
    camera.lookAt(0, height / 3, 0);
  }, [camera, size, height, d.name]);
  return (
    <>
      <ambientLight intensity={1.4} />
      <directionalLight position={[200, 400, 250]} intensity={2.6} />
      <directionalLight position={[-250, 120, -150]} intensity={0.9} />
      <group rotation={[-Math.PI / 2, 0, 0]} position={[-center[0], 0, center[1]]}>
        {d.sticks.map((s, i) => {
          if (!shown.has(i)) return null;
          const [a, b] = s.hubs;
          const ha = d.holes[a].find(h => h.stick === i)!, hb = d.holes[b].find(h => h.stick === i)!;
          const near = selected === null || s.hubs.includes(selected);
          return <Bar key={i} a={add(d.nodes[a], scale(ha.dir, ha.stop))} b={add(d.nodes[b], scale(hb.dir, hb.stop))} r={1} color={STATUS_COLOR[s.status]} opacity={near ? 1 : 0.3} />;
        })}
        {d.nodes.map((n, i) => hubsShown.has(i) && (
          <group key={i} onClick={e => { e.stopPropagation(); onSelect(i); }}>
            <HubPreview at={n} holes={d.holes[i].filter(h => shown.has(h.stick))} d={d} color={selected === i ? HUB_ON : HUB} opacity={dim(i)} />
            <Html position={add(n, [0, 0, 9])} center className={`hub-tag${selected === i ? ' on' : ''}`}>{i}</Html>
          </group>
        ))}
        <mesh position={[center[0], center[1], -0.5]} receiveShadow><planeGeometry args={[size * 2.2, size * 2.2]} /><meshStandardMaterial color="#f3f2ee" /></mesh>
      </group>
      <OrbitControls makeDefault target={[0, height / 3, 0]} />
    </>
  );
}

function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], {type}));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function HubsPage() {
  const [shape, setShape] = useState<keyof typeof SHAPES>('banana');
  const [sticks, setSticks] = useState(48);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const source = useMemo(() => SHAPES[shape](), [shape]);
  const d = useMemo(() => makeDesign(source, undefined, sticks), [source, sticks]);
  const [step, setStep] = useState(Infinity);
  const shownStep = Math.min(step, d.order.length);
  const r = d.report;
  const pick = (s: keyof typeof SHAPES) => { setShape(s); setSelected(null); setStep(Infinity); };
  const sel = selected !== null && selected < d.nodes.length ? selected : null;

  return (
    <main className="hubs">
      <header><a className="wordmark" href="../">Possible Pieces</a><span className="mono muted">VARIABLE-ANGLE HUBS · PROTOTYPE</span></header>
      <section className="hubs-intro">
        <h1>Shape to sticks and printed hubs</h1>
        <p>Each joint gets its own hub. Bores point exactly along their sticks, and each bore's stop depth is set so one uncut {d.params.stickLength} mm toothpick fits every span.</p>
      </section>
      <div className="hubs-work">
        <aside>
          <div className="mono label">SHAPE</div>
          <div className="seg">{(Object.keys(SHAPES) as (keyof typeof SHAPES)[]).map(s => <button key={s} className={s === shape ? 'on' : ''} onClick={() => pick(s)}>{s}</button>)}</div>
          {source.kind === 'mesh' ? (
            <label className="mono label">STICK BUDGET <b>{sticks}</b>
              <input type="range" min={24} max={120} step={3} value={sticks} onChange={e => { setSticks(Number(e.target.value)); setSelected(null); setStep(Infinity); }} />
            </label>
          ) : <p className="note">Built from named parts: legs and stretchers become rods, seat and back become plates. Spans follow the part sizes.</p>}

          <div className="mono label">RESULT</div>
          <dl className="stats">
            <dt>Hubs</dt><dd>{r.hubCount}</dd>
            <dt>Sticks</dt><dd>{r.stickCount}</dd>
            <dt>Uncut fit</dt><dd>{r.ok}</dd>
            <dt>Need trimming</dt><dd className={r.cut ? 'warn' : ''}>{r.cut}</dd>
            <dt>Too long</dt><dd className={r.long ? 'bad' : ''}>{r.long}</dd>
            <dt>Rigid without friction</dt><dd>{r.pinFreedom ? `no (${r.pinFreedom} free motions)` : 'yes'}</dd>
            <dt>Hub spacing</dt><dd>{f1(r.spanRange[0])}–{f1(r.spanRange[1])} mm</dd>
            <dt>Largest hub</dt><dd>{f1(Math.max(...d.hubs.map(h => h.diameter)))} mm</dd>
          </dl>

          <div className="actions">
            <button disabled={busy} onClick={async () => { setBusy(true); try { download(`${d.name}-plate.stl`, await plateSTL(d) as BlobPart, 'model/stl'); } finally { setBusy(false); } }}>{busy ? 'Building…' : 'Download print plate (STL)'}</button>
            <button onClick={() => download(`${d.name}-design.json`, JSON.stringify(d, null, 1), 'application/json')}>Download design (JSON)</button>
          </div>
        </aside>

        <section className="stage">
          <div className="viewport">
            <Canvas camera={{position: [260, 220, 300], fov: 32, near: 1, far: 5000}} dpr={[1, 1.8]} onPointerMissed={() => setSelected(null)}>
              <Scene d={d} step={shownStep} selected={sel} onSelect={setSelected} />
            </Canvas>
            <div className="legend mono"><i style={{background: STATUS_COLOR.ok}} />uncut <i style={{background: STATUS_COLOR.cut}} />trim <i style={{background: STATUS_COLOR.long}} />too long · click a hub</div>
          </div>
          <label className="mono label step">BUILD STEP <b>{shownStep} / {d.order.length}</b>
            <input type="range" min={0} max={d.order.length} value={shownStep} onChange={e => setStep(Number(e.target.value))} />
          </label>
          {shownStep > 0 && shownStep <= d.order.length && (() => {
            const e = d.order[shownStep - 1], s = d.sticks[e];
            return <p className="mono now">Step {shownStep}: stick {e} joins hub {s.hubs[0]} and hub {s.hubs[1]}{s.status === 'cut' ? `, trim ${f1(s.mm)} mm` : s.status === 'long' ? `, falls ${f1(s.mm)} mm short` : ''}</p>;
          })()}

          {sel !== null && (
            <div className="hub-detail">
              <div className="mono label">HUB {sel} · {d.hubs[sel].valence} STICKS · {f1(d.hubs[sel].diameter)} MM ACROSS · TIGHTEST ANGLE {f1(d.hubs[sel].minAngleDeg)}°</div>
              <table>
                <thead><tr><th>Stick</th><th>To hub</th><th>Stop depth</th><th>Span</th><th>Fit</th></tr></thead>
                <tbody>{d.holes[sel].map(h => { const s = d.sticks[h.stick]; return (
                  <tr key={h.stick}><td>{h.stick}</td><td><button className="link" onClick={() => setSelected(s.hubs[0] === sel ? s.hubs[1] : s.hubs[0])}>{s.hubs[0] === sel ? s.hubs[1] : s.hubs[0]}</button></td><td>{f1(h.stop)} mm</td><td>{f1(s.span)} mm</td><td className={s.status === 'ok' ? '' : s.status === 'cut' ? 'warn' : 'bad'}>{s.status === 'ok' ? 'uncut' : s.status === 'cut' ? `trim ${f1(s.mm)}` : `${f1(s.mm)} short`}</td></tr>
                ); })}</tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><HubsPage /></React.StrictMode>);
