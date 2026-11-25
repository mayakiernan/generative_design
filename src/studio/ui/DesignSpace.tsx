import {useState} from 'react';
import {pinnedCounts} from '../pinnedCounts';
import type {CountRow} from '../counts';
import {DownArrow, Mark} from './Shapes';
import {PossibleLink} from './Possible';

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
 * The third beat: how big the design space is. One screen holds one circle; each press of the down arrow gives
 * more pieces and grows the circle. The last step links to the Atlas.
 */
export function DesignSpace() {
  const rows = pinnedCounts();
  const [step, setStep] = useState(0);
  if (!rows.length) return null;
  const n = STEPS[step], row = rows.find(r => r.n === n)!;
  return (
    <section className="pp-space" data-step={step} aria-label="How many designs">
      <div className="pp-space-stage">
        <Mark className="pp-slide-mark" />
        <div className="pp-space-circle" aria-hidden />
        <p className="pp-space-have">I have <b>{n}</b> circles<br />I actually have</p>
        <p className="pp-space-count" key={n}><b>{writtenOut(row)}</b><br />possibilities</p>
        {step < STEPS.length - 1
          ? <DownArrow label={`Show ${STEPS[step + 1]} circles`} onClick={() => { setStep(current => current + 1); return true; }} />
          : <div className="pp-space-go"><PossibleLink /></div>}
      </div>
    </section>
  );
}
