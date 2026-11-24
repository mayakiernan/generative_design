import {useEffect, useRef, useState} from 'react';
import type {ValidationReport} from '../../slotwright/validate';
import {runStudioAgent, type AgentEvent} from '../slotwright';
import type {Panel} from '../../slots/panel';
import {Detail} from './Detail';
import {renderPanels, type IsoView} from './isoThumbs';
import {DotArrow} from './Shapes';

export interface AgentRequest {id: number; prompt: string; discMm: number; circles: number}

type Line = {kind: 'note' | 'tool' | 'check'; text: string; bad?: boolean};
const TOOL_TEXT: Record<string, string> = {read_build: 'Reads its build', write_build: 'Writes the build', edit_build: 'Edits the build', validate: 'Checks it', render: 'Looks at it', finalize: 'Finishes'};
/** The four views, in the order Claude's contact sheet has them, drawn in the site's look (as the atlas cards are). */
const VIEWS: [IsoView, string][] = [['front', 'Front'], ['side', 'Side'], ['top', 'Top'], ['iso', 'Three-quarter']];
const IN = 25.4;
const inch = (mm: number) => `${Math.round((mm / IN) * 2) / 2}`;

/** A one-line verdict for the log: passes, or which checks fail. */
function verdict(r: ValidationReport): Line {
  if (r.ok) return {kind: 'check', text: `Passes every check · ${r.summary?.pieces ?? '?'} pieces`};
  if (r.buildError) return {kind: 'check', text: `The build does not run: ${r.buildError.split('\n')[0]}`, bad: true};
  const fails = [...(r.problems.length ? ['kit pieces'] : []), ...r.checks.filter(c => !c.passed).map(c => c.name.replace(/_/g, ' '))];
  return {kind: 'check', text: `Fails: ${fails.join(', ')}`, bad: true};
}

/**
 * One agent run: Claude's notes as it works, the latest render it looked at, and each check, then the finished
 * design, which opens in the same design sheet as the atlas's (3D build, cut sheet, assembly guide).
 */
export function AgentRun({req}: {req: AgentRequest}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [png, setPng] = useState<string | null>(null);
  const [panels, setPanels] = useState<Panel[] | null>(null);
  const [views, setViews] = useState<Partial<Record<IsoView, string>>>({});
  // People see the build drawn like the rest of the site; the numbered colour sheet Claude reads is one click away.
  const [show, setShow] = useState<'views' | 'claude'>('views');
  const [turn, setTurn] = useState({n: 0, cost: 0});
  const [status, setStatus] = useState<'running' | 'done' | 'stopped'>('running');
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<Extract<AgentEvent, {type: 'done'}> | null>(null);
  const [open, setOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const logEnd = useRef<HTMLLIElement | null>(null);
  // Seconds since the run began, ticking while it runs, so a long turn reads as working, not stuck.
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (status !== 'running') return;
    const t0 = Date.now(), id = setInterval(() => setSecs(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [status, req]);

  useEffect(() => {
    const ctl = new AbortController();
    abort.current = ctl;
    const add = (l: Line) => setLines(ls => [...ls, l]);
    runStudioAgent({prompt: req.prompt, discMm: req.discMm, circles: req.circles, signal: ctl.signal, onEvent: e => {
      // A cancelled run (unmounted, or stopped by the button, which says so itself) reports nothing more.
      if (ctl.signal.aborted) return;
      if (e.type === 'note') add({kind: 'note', text: e.text});
      if (e.type === 'tool') add({kind: 'tool', text: TOOL_TEXT[e.name] ?? e.name});
      if (e.type === 'validate') add(verdict(e.report));
      if (e.type === 'render') { setPng(e.png); setPanels(e.panels); }
      if (e.type === 'turn') setTurn({n: e.turn, cost: e.costUsd});
      if (e.type === 'done') { setDone(e); setStatus('done'); if (e.png) setPng(e.png); if (e.panels) setPanels(e.panels); }
      if (e.type === 'stopped') { setReason(e.reason); setStatus('stopped'); }
    }});
    return () => ctl.abort();
  }, [req]);
  useEffect(() => { logEnd.current?.scrollIntoView({block: 'nearest'}); }, [lines]);
  // Draw the views one per tick, so the page never stalls on them.
  useEffect(() => {
    if (!panels?.length) return;
    let k = 0, timer = 0;
    const next = () => {
      if (k >= VIEWS.length) return;
      const [view] = VIEWS[k++];
      try { const url = renderPanels(panels, view); setViews(v => ({...v, [view]: url})); } catch { /* keep the last drawing */ }
      timer = window.setTimeout(next, 16);
    };
    timer = window.setTimeout(next, 0);
    return () => clearTimeout(timer);
  }, [panels]);

  const D = req.discMm;
  // Made in the worker (src/slotwright/worker.ts 'finish'), so the page stays responsive.
  const finished = done && {item: done.item, cut: done.cut};

  const head = status === 'running'
    ? `The model is designing ${req.prompt}…`
    : status === 'done' ? `${done?.title ?? 'Design'}: ${finished?.item.design.panels.length ?? ''} circles of ${inch(D)} in` : reason;

  return (
    <div className="ag">
      <p className={`pa-note ${status === 'stopped' ? 'bad' : ''}`}>
        {head}
        <span className="ag-meta"> · {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}{turn.n > 0 ? ` · ${turn.n} turn${turn.n > 1 ? 's' : ''} · about $${turn.cost.toFixed(2)}` : ''}</span>
        {status === 'running' && <button type="button" className="ag-stop" onClick={() => { abort.current?.abort(); setReason('Stopped.'); setStatus('stopped'); }}>Stop</button>}
      </p>
      <div className="ag-body">
        <figure className="ag-view">
          {show === 'claude' && png
            ? <img className="ag-claude" src={`data:image/png;base64,${png}`} alt="The latest render the model looked at, pieces numbered" />
            : (
              <div className="ag-views">
                {VIEWS.map(([view, label]) => (
                  <div key={view} className="ag-tile">
                    {views[view] && <img src={views[view]} alt={`${label} view of the ${status === 'done' ? 'finished' : 'current'} build`} />}
                    <span>{label}</span>
                  </div>
                ))}
                {!panels && <p className="ag-wait">{status === 'running' ? 'The build appears here once the model has drawn it.' : ''}</p>}
              </div>
            )}
          {png && (
            <div className="ag-toggle" role="group" aria-label="What to show">
              <button type="button" className={show === 'views' ? 'on' : ''} onClick={() => setShow('views')}>Views</button>
              <button type="button" className={show === 'claude' ? 'on' : ''} onClick={() => setShow('claude')}>What the model sees</button>
            </div>
          )}
          {status === 'done' && finished && (
            <button type="button" className="pa-go ag-open" onClick={() => setOpen(true)}>
              <span>Open the design</span>
              <DotArrow />
            </button>
          )}
          {done?.summary && <figcaption>{done.summary}</figcaption>}
        </figure>
        <ol className="ag-log" aria-live="polite">
          {lines.map((l, i) => <li key={i} className={`ag-${l.kind}${l.bad ? ' bad' : ''}`}>{l.text}</li>)}
          {status === 'running' && <li className="ag-tool ag-busy" ref={logEnd}>Working…</li>}
        </ol>
      </div>
      {open && finished && done && <Detail item={finished.item} cut={finished.cut} title={done.title} diameter={D} onClose={() => setOpen(false)} />}
    </div>
  );
}
