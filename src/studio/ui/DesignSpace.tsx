import {useEffect, useRef, useState} from 'react';
import {pinnedCounts} from '../pinnedCounts';
import type {CountRow} from '../counts';
import {Mark} from './Shapes';

/** The piece counts the scroll steps through; the circle grows at each. */
const STEPS = [5, 10, 30];

/**
 * A count written out in full: exact counts as they are, estimates to two figures followed by every zero
 * ("≈ 580,000,000,…"), so the size of the number is seen, not read as an exponent.
 */
export function writtenOut(row: CountRow): string {
  if (row.exact) return Math.round(10 ** row.log).toLocaleString('en-US');
  const exponent = Math.floor(row.log), lead = Math.round(10 ** (row.log - exponent + 1));
  const digits = `${lead}${'0'.repeat(Math.max(0, exponent - 1))}`;
  return `≈\u00a0${BigInt(digits).toLocaleString('en-US')}`;
}

/**
 * The third beat: how big the design space is. A sticky stage holds one circle; each step of scrolling gives more
 * pieces and grows the circle, until it covers the page.
 */
export function DesignSpace() {
  const rows = pinnedCounts();
  const section = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const el = section.current;
      if (!el) return;
      const r = el.getBoundingClientRect(), run = r.height - innerHeight;
      const p = run > 0 ? Math.min(1, Math.max(0, -r.top / run)) : 0;
      setStep(Math.min(STEPS.length - 1, Math.floor(p * STEPS.length)));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    addEventListener('scroll', onScroll, {passive: true});
    addEventListener('resize', onScroll);
    return () => { removeEventListener('scroll', onScroll); removeEventListener('resize', onScroll); cancelAnimationFrame(frame); };
  }, []);
  if (!rows.length) return null;
  const n = STEPS[step], row = rows.find(r => r.n === n)!;
  return (
    <section ref={section} className="pp-space" data-step={step} style={{['--steps' as string]: STEPS.length}} aria-label="How many designs">
      <div className="pp-space-stage">
        <Mark className="pp-slide-mark" />
        <div className="pp-space-circle" aria-hidden />
        <p className="pp-space-have">I have <b>{n}</b> circles<br />I actually have</p>
        <p className="pp-space-count" key={n}><b>{writtenOut(row)}</b><br />possibilities</p>
      </div>
    </section>
  );
}
