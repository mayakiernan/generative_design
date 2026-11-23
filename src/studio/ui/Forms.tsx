import {formatCount, sci, type CountRow} from '../counts';
import {pinnedCounts, pinnedLevels, type Level} from '../pinnedCounts';
import {StudioNav} from './Nav';

function Big({log}: {log: number}) {
  const s = sci(log);
  return s.exponent ? <>{s.mantissa} × 10<sup>{s.exponent}</sup></> : <>{s.text}</>;
}

export function Forms() {
  const levels = pinnedLevels, counted = Math.max(0, ...levels.map(l => l.n));
  const rows: CountRow[] = pinnedCounts();

  return (
    <div className="st">
      <StudioNav current="forms" />
      <header className="st-head">
        <h1>How many forms?</h1>
        <p>
          A form is any connected arrangement of the kit's pieces (full discs and both half discs), each slotted into its
          neighbours, none running into another, counted once however it is turned or mirrored. Up to {counted} pieces every
          form was built and counted. Past that the count is an estimate, with a range, because it grows too fast to list.
        </p>
      </header>

      {!rows.length ? <p className="st-note bad">The counts come from a different atlas run than Slot Studio uses: update the import in Forms.tsx.</p> : (
        <table className="st-counts">
          <thead><tr><th scope="col">Pieces</th><th scope="col">Forms</th><th scope="col">Range</th><th scope="col">How we know</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.n} className={r.exact ? 'exact' : ''}>
                <th scope="row">{r.n}</th>
                <td className="num">{r.exact ? formatCount(r).text : <>≈ <Big log={r.log} /></>}</td>
                <td className="num range">{r.exact ? '' : <><Big log={r.low} /> – <Big log={r.high} /></>}</td>
                <td className="how">{r.exact ? 'counted' : r.atLeast ? `estimate; counting stopped past ${r.atLeast.toLocaleString('en-US')}` : 'estimate'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {rows.length > 0 && (
        <section className="st-method">
          <h2>How the estimate works</h2>
          <p>
            Each extra piece multiplies the number of forms, and the multiplier is still rising at {counted} pieces
            ({ratioText(levels)}). Forms like these grow like A·λ<sup>n</sup>·n<sup>−3/2</sup>, as clusters on a 3D grid
            do; λ and A are fitted to the last two exact counts. The low end keeps the last multiplier seen for every further
            piece; the high end lets it keep rising at the rate it has been.
          </p>
          <p>
            Most of these are not furniture. Only a small share stand on their own with a level top, and the Designs page
            further keeps only forms with no open slits. Counts are for the kit at any disc size: they depend on how the
            pieces join, not on how big they are.
          </p>
        </section>
      )}
    </div>
  );
}

function ratioText(levels: Level[]): string {
  const by = new Map(levels.map(l => [l.n, l.forms]));
  const out: string[] = [];
  for (const l of levels) if (by.has(l.n - 1) && l.n >= 3) out.push(`×${(l.forms / by.get(l.n - 1)!).toFixed(1)}`);
  return `${out.join(', ')} for pieces 3 to ${Math.max(...levels.map(l => l.n))}`;
}
