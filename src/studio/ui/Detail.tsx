import {useEffect, useMemo, useState} from 'react';
import {Canvas} from '@react-three/fiber';
import type {Design} from '../../slots/engine';
import type {GalleryItem} from '../../slots/gallery';
import {assemblyGuideHTML, cutSheetDXF, cutSheetSVG} from '../../slots/svg';
import {CutSheet, download, Scene, slug} from '../../slots/ui/shared';
import {DotArrow, Mark, Shape, type ShapeKind} from './Shapes';
import type {StepHold} from '../../slots/atlas/holds';

/** Why the part built so far has to be held after a step. */
const holdReason = (h: StepHold) => [
  h.falls && 'it falls over',
  h.sags && 'a joint swings',
  h.loose.length && `piece${h.loose.length > 1 ? 's' : ''} ${h.loose.map(i => i + 1).join(', ')} can drop out`,
].filter(Boolean).join('; ');

const IN = 25.4;
const inch = (mm: number) => `${Math.round((mm / IN) * 2) / 2}`;
/** Grey pieces, black cuts, on white. */
const GREYS = ['#bdbdb9', '#c7c7c3', '#b2b2ae', '#c2c2be', '#b7b7b3'];
/**
 * Sheet thicknesses to choose from. The checks and cut files are made for 1/4 in for now, whatever is chosen.
 */
const THICKNESSES = ['1/8', '3/16', '1/4', '3/8', '1/2'];
const LOOK = {cutEdges: '#151515', lines: '#151515', lineOpacity: 0.85, ground: null, support: false};
/** Kit pieces as drawn shapes, in the order they are listed. */
const KINDS: [string, ShapeKind][] = [['C1', 'c1'], ['C2L', 'c2l'], ['C2I', 'c2i'], ['C3T', 'c3t'], ['H', 'notched'], ['H1', 'half']];

/**
 * One design, opened over a full-bleed colour: the 3D model (assembled to start) with its size and material on the
 * left; the cut sheet, laser files and how many of each circle on the right. Arrows or ← → step through the atlas.
 */
export function Detail({item, cut, title, diameter, holds, onClose, onPrev, onNext}: {
  item: GalleryItem; cut: Design; title: string; diameter: number; holds?: StepHold[]; onClose: () => void; onPrev?: () => void; onNext?: () => void;
}) {
  const d = item.design, n = d.steps.length;
  // View: the whole thing assembled or exploded, or the build, one step at a time.
  const [mode, setMode] = useState<'assembled' | 'exploded' | 'build'>('assembled');
  const [step, setStep] = useState(n);
  // `moving`: the scene is animating the step just shown; `auto`: keep going to the end.
  const [moving, setMoving] = useState(false);
  const [auto, setAuto] = useState(false);
  useEffect(() => { setStep(n); setMoving(false); setAuto(false); setMode('assembled'); }, [d, n]);
  const building = mode === 'build';
  const goTo = (k: number) => { const next = Math.max(1, Math.min(n, k)); setAuto(false); setMoving(next > step); setStep(next); };
  const enterBuild = () => { setMode('build'); setAuto(false); setMoving(true); setStep(1); };
  const leave = (m: 'assembled' | 'exploded') => { setMode(m); setAuto(false); setMoving(false); setStep(n); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // In the build, the arrow keys step through it; otherwise they move between designs.
      if (e.key === 'ArrowRight') { if (building) goTo(step + 1); else onNext?.(); }
      if (e.key === 'ArrowLeft') { if (building) goTo(step - 1); else onPrev?.(); }
    };
    addEventListener('keydown', k);
    document.body.style.overflow = 'hidden';
    return () => { removeEventListener('keydown', k); document.body.style.overflow = ''; };
  }, [onClose, onNext, onPrev, building, step]);
  const colors = d.panels.map((p, i) => (p.role === 'top' ? '#dcdcd8' : GREYS[i % GREYS.length]));
  const name = slug(title);
  const counts = KINDS.map(([id, kind]) => ({id, kind, part: item.parts.find(p => p.id === id)})).filter(x => x.part);
  const top = item.parts.find(p => p.id === 'CF');
  const [thickness, setThickness] = useState('1/4');
  // The top is cut to fit from other stock, so the sheet holds only the circles.
  const sheet = useMemo(() => ({...cut, panels: cut.panels.filter(p => p.role !== 'top')}), [cut]);
  // Pack the preview about 4:3, so the sheet reads as a board rather than a strip.
  const sheetWidth = useMemo(() => {
    const boxes = sheet.panels.map(p => { const q = p.loops.flat(), xs = q.map(v => v[0]), ys = q.map(v => v[1]); return [Math.max(...xs) - Math.min(...xs) + 12, Math.max(...ys) - Math.min(...ys) + 12]; });
    const area = boxes.reduce((s, [w, h]) => s + w * h, 0);
    return Math.max(Math.sqrt(area * 1.45) * 1.08, ...boxes.map(b => b[0] + 12));
  }, [sheet]);

  return (
    <div className="pd" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      {onPrev && <button type="button" className="pd-step prev" onClick={e => { e.stopPropagation(); onPrev(); }} aria-label="Previous design"><DotArrow className="pd-arrow" /></button>}
      <article className="pd-card" onClick={e => e.stopPropagation()}>
        <Mark className="pd-mark" />
        <button type="button" className="pd-close" onClick={onClose} aria-label="Close">×</button>
        <div className="pd-left">
          <div className="pd-view">
            <Canvas camera={{position: [600, 400, 700], fov: 32, near: 1, far: 20000}} dpr={[1, 1.8]}>
              <Scene d={d} step={step} playing={moving} explode={mode === 'exploded'} picked={null} onPick={() => {}} colors={colors} look={LOOK}
                onStepDone={() => { if (auto && step < n) setStep(s => s + 1); else { setMoving(false); setAuto(false); } }} />
            </Canvas>
            <div className="pd-toggle">
              <button type="button" className={mode === 'assembled' ? 'on' : ''} onClick={() => leave('assembled')}>Assembled</button>
              <button type="button" className={mode === 'exploded' ? 'on' : ''} onClick={() => leave('exploded')}>Exploded</button>
              <button type="button" className={building ? 'on' : ''} onClick={() => (building ? leave('assembled') : enterBuild())}>Build</button>
            </div>
            {building && (
              <div className="pd-stepper" role="group" aria-label="Build steps">
                <button type="button" onClick={() => goTo(step - 1)} disabled={step <= 1} aria-label="Previous step">‹</button>
                <span>Step <b>{step}</b> / {n}</span>
                <button type="button" onClick={() => goTo(step + 1)} disabled={step >= n} aria-label="Next step">›</button>
                <button type="button" className="play" onClick={() => { if (auto) { setAuto(false); } else { const from = step >= n ? 1 : step + 1; setStep(from); setMoving(true); setAuto(true); } }} aria-label={auto ? 'Pause' : 'Play the build'}>{auto ? 'Pause' : 'Play'}</button>
              </div>
            )}
          </div>
          {building && (
            <p className="pd-how" aria-live="polite">
              {d.steps[step - 1]?.how}
              {holds?.[step - 1]?.needs && <span className="pd-hold">Hold: {holdReason(holds[step - 1])}</span>}
            </p>
          )}
          <h2 className="pd-title">{title}</h2>
          <dl className="pd-facts">
            <dt>Size</dt><dd>W {inch(d.size.width)} × D {inch(d.size.depth)} × H {inch(d.size.height)} in</dd>
            {holds && <><dt>Build</dt><dd>{holds.some(h => h.needs) ? `needs a second hand at ${holds.filter(h => h.needs).length} of ${holds.length} steps` : 'one person can build it'}</dd></>}
            <dt>Material</dt><dd>{thickness} in plywood · circles {inch(diameter)} in across</dd>
          </dl>
        </div>
        <div className="pd-right">
          <p className="pd-label">Cut sheet<br />
            <select value={thickness} onChange={e => setThickness(e.target.value)} aria-label="Sheet thickness">
              {THICKNESSES.map(t => <option key={t} value={t}>{t}</option>)}
            </select> in thickness</p>
          <div className="pd-sheet"><CutSheet d={sheet} marks={item.marks} width={sheetWidth} /></div>
          <div className="pd-files">
            <button type="button" className="primary" onClick={() => download(`${name}.svg`, cutSheetSVG(sheet, item.marks), 'image/svg+xml')}>Cut sheet · SVG</button>
            <button type="button" onClick={() => download(`${name}.dxf`, cutSheetDXF(sheet, item.marks), 'application/dxf')}>Cut sheet · DXF</button>
            <button type="button" onClick={() => download(`${name}-assembly.html`, assemblyGuideHTML(title, cut, item.parts.map(p => ({name: p.name, count: p.count})), item.steps, item.marks), 'text/html')}>Assembly guide · HTML</button>
          </div>
          <ul className="pd-counts" aria-label="Circles of each type">
            {counts.map(({id, kind, part}) => (
              <li key={id} title={part!.name}><Shape kind={kind} /><b>× {part!.count}</b></li>
            ))}
            {top && <li className="pd-top" title="Top, cut to fit"><span className="pd-board" aria-label="Top, cut to fit" /><b>× {top.count}</b></li>}
          </ul>
        </div>
      </article>
      {onNext && <button type="button" className="pd-step next" onClick={e => { e.stopPropagation(); onNext(); }} aria-label="Next design"><DotArrow className="pd-arrow" /></button>}
    </div>
  );
}
