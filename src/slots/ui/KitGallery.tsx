/** The Kit gallery tab: designs grown from one kit, started from a prompt (Claude) or by the solver alone. */
import {useEffect, useMemo, useState} from 'react';
import {Canvas} from '@react-three/fiber';
import * as THREE from 'three';
import type {Design} from '../engine';
import type {V2, V3} from '../math';
import {assemblyGuideHTML, cutSheetDXF, cutSheetSVG, loopPath} from '../svg';
import {coverPiece, finishPieces, KITS, type Intent, type KitId, type Piece} from '../kits';
import type {CoverSpec, GalleryItem} from '../gallery';
import {buildDesign, type DesignSpec} from '../agent';
import {FOOTPRINT_X, LIMITS, recipeWeights, type Recipe, TABLE_MIN_PIECES, VISIBLE_KITS} from '../recipe';
import {CutSheet, download, NumberField, Scene} from './shared';

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


/**
 * What a set grows from. `footprint`: the random form's circle on the floor, as a diameter in piece sizes (so it
 * follows the piece size). `cover`: a top asked for by the brief (the table form always has one).
 */
interface GallerySettings {kit: KitId; intent: Intent; count: number; size: number; t: number; clearance: number; footprint: number; favour: string[]; avoid: string[]; branching: 'chain' | 'mixed' | 'bushy' | null; cover: CoverSpec | null}
const START: GallerySettings = {kit: VISIBLE_KITS[0], intent: 'random', count: 14, size: 240, t: 6, clearance: 0.2, footprint: FOOTPRINT_X.start, favour: [], avoid: [], branching: null, cover: null};
/** Briefs to start from: in Claude's mode every set begins as a prompt. */
const BRIEFS = ['a side table about 50 cm tall', 'a plant stand with a square top at least 35 cm across', 'something random that fits in a 1 m circle', 'a tall tower of small discs'];
/**
 * Claude sets the engine up from a brief (the engine then grows at random); the Opus agent places every piece itself
 * and checks each design with the engine; Random runs the solver alone, no API.
 */
type Mode = 'prompt' | 'agent' | 'random';
const AGENT_BRIEFS = ['a tower with four-fold symmetry, about 60 cm tall', 'a symmetric side table with a square top', 'a star-shaped centrepiece, flat and low', 'a spiral staircase sculpture'];
/** A line in the agent's live log: its notes, and each design it built with the engine's verdict. */
interface AgentLine {kind: 'note' | 'pass' | 'fail'; text: string}
/** A design the agent presented: its card, the note it wrote, and the exact spec it built. */
interface AgentPick {item: GalleryItem; note: string; spec: DesignSpec}
type StandFilter = 'all' | 'stands' | 'support';
type ShapeFilter = 'all' | 'upright' | 'low';
/** Upright: at least as tall as it is wide. */
const upright = (it: GalleryItem) => it.design.size.height >= Math.max(it.design.size.width, it.design.size.depth);
const FORM_NAME: Record<Intent, string> = {table: 'table', random: 'random', any: 'sculpture', tower: 'tower', spread: 'low spread', compact: 'compact cluster'};
/** A cover's size: its diameter when round, width × depth when cut to fit. */
const coverSize = (top: NonNullable<GalleryItem['top']>) => top.shape === 'round' ? `⌀ ${Math.round(top.width)} mm` : `${Math.round(top.width)} × ${Math.round(top.depth)} mm`;

export function KitGallery() {
  const [mode, setMode] = useState<Mode>('prompt');
  // Each mode keeps its own settings; Claude's stay empty until a brief has set them.
  const [promptCfg, setPromptCfg] = useState<GallerySettings | null>(null);
  const [randomCfg, setRandomCfg] = useState<GallerySettings>(START);
  const cfg = mode === 'random' ? randomCfg : mode === 'prompt' ? promptCfg : null;
  const set = (patch: Partial<GallerySettings>) => mode === 'random' ? setRandomCfg(c => ({...c, ...patch})) : setPromptCfg(c => c && {...c, ...patch});
  const [round, setRound] = useState(1);
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState<GalleryItem | null>(null);
  const [brief, setBrief] = useState('');
  const [asking, setAsking] = useState(false);
  const [ai, setAi] = useState<{recipe: Recipe; model: string} | null>(null);
  const [aiError, setAiError] = useState('');
  const [agentBrief, setAgentBrief] = useState('');
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentLog, setAgentLog] = useState<AgentLine[]>([]);
  const [agentPicks, setAgentPicks] = useState<AgentPick[]>([]);
  const [agentSummary, setAgentSummary] = useState('');
  const [agentError, setAgentError] = useState('');
  const [standFilter, setStandFilter] = useState<StandFilter>('all');
  const [shapeFilter, setShapeFilter] = useState<ShapeFilter>('all');
  const kit = KITS.find(k => k.id === VISIBLE_KITS[0])!;
  const kitPieces = useMemo(() => finishPieces(kit.id, 100, 4, 0.2), [kit.id]);
  const cover = useMemo(() => coverPiece(kit.id, 100, 4, 0.2), [kit.id]);
  const pieceName = (id: string) => kitPieces.find(p => p.id === id)?.name ?? id;
  const covered = !!cfg && (cfg.intent === 'table' || !!cfg.cover), random = cfg?.intent === 'random';
  const wanted = !covered && (cfg?.count ?? 0) > 16 ? 6 : 9;

  useEffect(() => {
    setItems([]); setNote(''); setOpen(null); setStandFilter('all'); setShapeFilter('all');
    if (!cfg) { setBusy(false); return; }
    setBusy(true);
    const w = new Worker(new URL('../galleryWorker.ts', import.meta.url), {type: 'module'});
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
    const attempts = covered ? 200 : Math.round((cfg.intent === 'tower' ? 160 : 70) * (1 + cfg.count / 12));
    w.postMessage({kit: cfg.kit, intent: cfg.intent, count: cfg.count, size: cfg.size, t: cfg.t, clearance: cfg.clearance, footprint: cfg.footprint * cfg.size, seed: round, designs: wanted, attempts, keepFallers: true,
      cover: cfg.cover ?? undefined, weights: recipeWeights({favour: cfg.favour as never[], avoid: cfg.avoid as never[]}), branching: cfg.branching ?? undefined});
    return () => w.terminate();
  }, [cfg, round, wanted, covered]);

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
      setPromptCfg({...START, intent: r.form, count: r.pieces, size: r.pieceSizeMm, t: r.sheetMm, footprint, favour: r.favour, avoid: r.avoid, branching: r.branching,
        cover: r.cover ? {shape: r.coverShape, minMm: r.coverMm} : null});
      setRound(x => x + 1);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Could not reach Claude.');
    } finally { setAsking(false); }
  };

  /** Run the agent: stream its notes and builds, then rebuild each design it presents from the exact spec. */
  const runAgent = async (text = agentBrief) => {
    if (!text.trim() || agentRunning) return;
    setAgentRunning(true); setAgentError(''); setAgentLog([]); setAgentPicks([]); setAgentSummary(''); setOpen(null);
    const line = (l: AgentLine) => setAgentLog(xs => [...xs, l]);
    try {
      const res = await fetch('../api/kit-agent', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({prompt: text})});
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({error: `The server answered ${res.status}.`}));
        throw new Error(data.error ?? `The server answered ${res.status}.`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (let r = await reader.read(); !r.done; r = await reader.read()) {
        buffer += r.value;
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        for (const raw of lines.filter(Boolean)) {
          const ev = JSON.parse(raw);
          if (ev.type === 'note') line({kind: 'note', text: ev.text});
          else if (ev.type === 'build') line({kind: ev.ok ? 'pass' : 'fail', text: `${ev.title} (${ev.pieces} pieces): ${ev.summary}`});
          else if (ev.type === 'designs') {
            setAgentSummary(ev.summary);
            // The engine is deterministic: the browser rebuilds exactly what the server checked.
            setAgentPicks((ev.designs as {note: string; spec: DesignSpec}[]).flatMap(({note, spec}) => {
              const {item} = buildDesign(spec);
              return item ? [{item, note, spec}] : [];
            }));
          } else if (ev.type === 'done') line({kind: 'note', text: `Done in ${ev.seconds} s, ${ev.turns} turns, by ${ev.model}.`});
          else if (ev.type === 'error') throw new Error(ev.message);
        }
      }
    } catch (e) {
      setAgentError(e instanceof Error ? e.message : 'Could not reach Claude.');
    } finally { setAgentRunning(false); }
  };

  const shownItems = mode === 'agent' ? agentPicks.map(p => p.item) : items;
  const shown = shownItems.map((it, i) => ({it, n: i + 1})).filter(({it}) =>
    (standFilter === 'all' || (standFilter === 'stands') === it.stands) && (shapeFilter === 'all' || (shapeFilter === 'upright') === upright(it)));
  const count = (f: (it: GalleryItem) => boolean) => shownItems.filter(f).length;
  const chips = <T extends string>(label: string, value: T, setValue: (v: T) => void, options: [T, string, number][]) => (
    <div className="kg-filter" role="radiogroup" aria-label={label}>
      <span className="mono label">{label}</span>
      {options.map(([id, text, n]) => <button key={id} type="button" role="radio" aria-checked={value === id} className={value === id ? 'on' : ''} onClick={() => setValue(id)}>{text} <span className="muted">{n}</span></button>)}
    </div>
  );
  const r = ai?.recipe;

  return (
    <div className="kg">
      <section className="kg-intro">
        <h1>Slot kits</h1>
        <p>Every piece is the same disc, differing only in its slits. Describe what you want and Claude Opus 5.5 sets up the engine: what to grow, how many pieces, how big, and whether it needs a top. Or switch to Random, which runs the solver alone with no AI, growing random designs up from the floor inside a circle you set. A top always rests on a braced grid of discs, since a branching tree of slit joints folds under weight. Every design is checked before it is shown: nothing overlaps, it builds in order, and nothing can slide out. Most stand on their own; some would need propping, and the filters sort them. Open one for its build steps and laser files.</p>
      </section>

      <div className="seg kg-mode" role="radiogroup" aria-label="Mode">
        <button type="button" role="radio" aria-checked={mode === 'prompt'} className={mode === 'prompt' ? 'on' : ''} onClick={() => setMode('prompt')}>Describe it · Claude</button>
        <button type="button" role="radio" aria-checked={mode === 'agent'} className={mode === 'agent' ? 'on' : ''} onClick={() => setMode('agent')}>Designed by Opus</button>
        <button type="button" role="radio" aria-checked={mode === 'random'} className={mode === 'random' ? 'on' : ''} onClick={() => setMode('random')}>Random · solver only</button>
      </div>

      {mode === 'prompt' ? (
        <form className="ai-brief" onSubmit={e => { e.preventDefault(); askClaude(); }}>
          <label htmlFor="ai-brief" className="mono label">DESCRIBE IT</label>
          <div className="ai-row">
            <input id="ai-brief" value={brief} onChange={e => setBrief(e.target.value)} maxLength={1000} placeholder="e.g. a tall lantern from cardboard discs, about 40 cm" autoComplete="off" />
            <button type="submit" className="primary" disabled={asking || !brief.trim()}>{asking ? 'Asking Opus 5.5…' : 'Generate'}</button>
          </div>
          {!promptCfg && !asking && <div className="ai-examples">{BRIEFS.map(x => <button key={x} type="button" onClick={() => { setBrief(x); askClaude(x); }}>{x}</button>)}</div>}
          {aiError && <p className="note bad">{aiError}</p>}
          {r && !aiError && (
            <div className="ai-recipe">
              <b>{r.title}</b>
              <span>{r.rationale}</span>
              <span className="muted">{r.form === 'random' ? `random, inside a ${r.footprintMm} mm circle` : FORM_NAME[r.form]}{r.cover ? ` · ${r.coverShape === 'fitted' ? 'a top cut to fit' : 'a round top'}${r.coverMm ? ` at least ${r.coverMm} mm across` : ''}` : ''} · {r.pieces} pieces · every disc {r.pieceSizeMm} mm{r.cover || r.form === 'table' || r.form === 'random' ? '' : ` · ${r.branching} branching`} · {r.sheetMm} mm sheet{r.favour.length ? ` · favours ${r.favour.map(id => `“${pieceName(id).toLowerCase()}”`).join(' and ')}` : ''}{r.avoid.length ? ` · leaves out ${r.avoid.map(id => `“${pieceName(id).toLowerCase()}”`).join(' and ')}` : ''} · set by {ai!.model}</span>
            </div>
          )}
        </form>
      ) : mode === 'agent' ? (
        <form className="ai-brief" onSubmit={e => { e.preventDefault(); runAgent(); }}>
          <label htmlFor="agent-brief" className="mono label">DESIGNED BY OPUS</label>
          <p className="muted small kg-mode-note">Claude Opus 5.5 places every piece itself, as many as the design needs: it builds a version, the engine checks it (collisions, assembly, standing, parts held, and for a top, braced joints), Opus fixes what fails and builds a few variations, then shows the ones that pass. Symmetry and repetition are built in, not left to chance. A run takes a minute or more.</p>
          <div className="ai-row">
            <input id="agent-brief" value={agentBrief} onChange={e => setAgentBrief(e.target.value)} maxLength={1000} placeholder="e.g. a tower with four-fold symmetry, about 60 cm tall" autoComplete="off" />
            <button type="submit" className="primary" disabled={agentRunning || !agentBrief.trim()}>{agentRunning ? 'Opus is designing…' : 'Design it'}</button>
          </div>
          {!agentRunning && !agentPicks.length && !agentLog.length && <div className="ai-examples">{AGENT_BRIEFS.map(x => <button key={x} type="button" onClick={() => { setAgentBrief(x); runAgent(x); }}>{x}</button>)}</div>}
          {agentError && <p className="note bad">{agentError}</p>}
          {agentLog.length > 0 && (
            <ol className="agent-log" aria-live="polite">
              {agentLog.map((l, i) => <li key={i} className={l.kind}>{l.kind === 'pass' ? '✓ ' : l.kind === 'fail' ? '✗ ' : ''}{l.text}</li>)}
              {agentRunning && <li className="note muted">working…</li>}
            </ol>
          )}
          {agentSummary && <div className="ai-recipe"><b>Opus's summary</b><span>{agentSummary}</span></div>}
        </form>
      ) : (
        <p className="muted small kg-mode-note">No AI: the solver grows random designs from the discs, each with its own branching, up from the floor and inside the footprint circle. Nothing is sent anywhere.</p>
      )}

      <div className="kit-card kit-only">
        <span className="kit-pieces">{kitPieces.map(p => <PieceIcon key={p.id} p={p} fill={KIT_FILL[kit.id]} />)}<span className="kit-cover" title="Cover"><PieceIcon p={cover} fill={TOP_FILL} /></span></span>
        <b>{kit.name} kit</b>
        <span>{kit.blurb}</span>
      </div>

      {cfg && (
        <div className="kg-controls">
          <label>Pieces <b>{cfg.count}{covered ? ' + cover' : ''}</b><input type="range" min={covered ? TABLE_MIN_PIECES : LIMITS.pieces[0]} max={LIMITS.pieces[1]} value={cfg.count} onChange={e => set({count: Number(e.target.value)})} /></label>
          {random && <label>Footprint <b>⌀ {Math.round(cfg.footprint * cfg.size)} mm</b><input type="range" aria-label="Diameter of the circle on the floor, in piece sizes" min={FOOTPRINT_X.min} max={FOOTPRINT_X.max} step={0.25} value={cfg.footprint} onChange={e => set({footprint: Number(e.target.value)})} /></label>}
          <label>Piece size <span className="unit"><NumberField label="Size of every piece in mm" value={cfg.size} min={LIMITS.pieceSizeMm[0]} max={LIMITS.pieceSizeMm[1]} step={10} onCommit={v => set({size: v})} />mm</span></label>
          <label>Sheet <span className="unit"><NumberField label="Sheet thickness in mm" value={cfg.t} min={LIMITS.sheetMm[0]} max={LIMITS.sheetMm[1]} step={0.1} onCommit={v => set({t: v})} />mm</span></label>
          <label>Fit <span className="unit">+<NumberField label="Slit clearance in mm" value={cfg.clearance} min={0} max={1} step={0.05} onCommit={v => set({clearance: v})} />mm</span></label>
          <button type="button" className="primary" disabled={busy} onClick={() => setRound(x => x + 1)}>{busy ? 'Growing…' : 'New set'}</button>
        </div>
      )}
      {cfg && <p className="muted small fit-note">Slits are cut sheet + fit wide ({(cfg.t + cfg.clearance).toFixed(2)} mm). Enter your measured sheet thickness, and add your laser's kerf allowance to the fit.</p>}

      {shownItems.length > 0 && (
        <div className="kg-filters">
          {chips('STANDING', standFilter, setStandFilter, [['all', 'All', shownItems.length], ['stands', 'Stands', count(it => it.stands)], ['support', 'Needs support', count(it => !it.stands)]])}
          {chips('SHAPE', shapeFilter, setShapeFilter, [['all', 'All', shownItems.length], ['upright', 'Upright', count(upright)], ['low', 'Low', count(it => !upright(it))]])}
        </div>
      )}

      <div className="kg-grid">
        {shown.map(({it, n}) => (
          <button key={it.id} type="button" className="kg-card" onClick={() => setOpen(it)}>
            <Thumb d={it.design} fill={KIT_FILL[kit.id]} top={it.top ? it.design.panels.length - 1 : null} />
            {it.top ? (
              <span className="kg-card-meta"><b>{mode === 'agent' ? agentPicks[n - 1].spec.title : cfg?.intent === 'table' ? 'Table' : 'Design'}{mode === 'agent' ? '' : ` ${n}`}</b><span>{it.design.panels.length - 1} pieces + {it.top.shape === 'fitted' ? 'fitted' : 'round'} top {coverSize(it.top)} · {Math.round(it.top.height)} mm up{it.footprint ? ` · ⌀ ${Math.ceil(it.footprint.needed)} mm` : ''}</span><span className="ok">level · {Math.round(it.top.safeFrac * 100)}% supported{isFinite(it.top.loadKg) ? ` · tips past ${it.top.loadKg >= 100 ? '100+' : it.top.loadKg.toFixed(1)} kg` : ''}</span></span>
            ) : (
              <span className="kg-card-meta"><b>{mode === 'agent' ? agentPicks[n - 1].spec.title : `Design ${n}`}</b><span>{it.design.panels.length} pieces · {Math.round(it.design.size.height)} mm tall{it.footprint ? ` · ⌀ ${Math.ceil(it.footprint.needed)} mm` : ''}</span>{it.stands ? <span className="ok">stands · tips at {Math.round(it.design.support.tipDeg)}°</span> : <span className="warn">needs support · {it.design.support.tipDeg > 0 ? `tips at ${it.design.support.tipDeg.toFixed(1)}°` : 'tips over'}</span>}</span>
            )}
          </button>
        ))}
        {busy && Array.from({length: Math.max(0, wanted - items.length)}, (_, i) => <div key={`s${i}`} className="kg-card skeleton" />)}
      </div>
      {mode === 'agent' && agentPicks.length > 0 && <ul className="agent-notes">{agentPicks.map(p => p.note && <li key={p.item.id}><b>{p.spec.title}:</b> {p.note}</li>)}</ul>}
      {!busy && shownItems.length > 0 && shown.length === 0 && <p className="note">No designs in this set match both filters.</p>}
      {mode !== 'agent' && note && <p className="note">{note}</p>}
      {open && <DesignDetail item={open} index={shownItems.indexOf(open) + 1} name={mode === 'agent' ? agentPicks.find(p => p.item === open)?.spec.title : undefined} fill={KIT_FILL[kit.id]} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function DesignDetail({item, index, name: title, fill, onClose}: {item: GalleryItem; index: number; name?: string; fill: string; onClose: () => void}) {
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
          <div><h2>{title ?? `${d.title.startsWith('Slot table') ? 'Table' : 'Design'} ${index}`}</h2><p className="muted">{item.stands ? '' : 'Needs support: it tips over standing like this · '}{item.top ? `${item.top.shape === 'fitted' ? 'Top cut to fit' : 'Round top'} ${coverSize(item.top)}, ${Math.round(item.top.height)} mm up, ${Math.round(item.top.safeFrac * 100)}% over its supports · ` : ''}{item.top ? `${d.panels.length - 1} pieces + cover` : `${d.panels.length} pieces`} ·{d.thickness} mm sheet · {Math.round(d.size.width)} × {Math.round(d.size.depth)} × {Math.round(d.size.height)} mm overall</p></div>
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

