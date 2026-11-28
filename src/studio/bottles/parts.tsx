import type {Evaluation, Profile} from './vendor/model.mjs';
import * as F from './vendor/fit.mjs';
import {TIER_ORDER, fmt, plain} from './data';

/** A bottle's silhouette, mirrored about its axis; a sketch's outline dashed over it if given. */
export function Silhouette({prof, sketch, w = 120, h = 150}: {prof: Profile; sketch?: number[]; w?: number; h?: number}) {
  const H = prof.z[prof.z.length - 1];
  let R = Math.max(...prof.r);
  if (sketch) R = Math.max(R, ...sketch.map(v => v * H));
  const s = Math.min((w - 10) / (2 * R), (h - 10) / H), cx = w / 2, base = h - 5;
  const path = (pts: [number, number][]) => {
    const right = pts.map(([z, r]) => `${(cx + r * s).toFixed(1)},${(base - z * s).toFixed(1)}`);
    const left = pts.slice().reverse().map(([z, r]) => `${(cx - r * s).toFixed(1)},${(base - z * s).toFixed(1)}`);
    return 'M' + left.join('L') + 'L' + right.join('L');
  };
  return (
    <svg className="bs-sil" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden>
      <path d={path(prof.z.map((z, i) => [z, prof.r[i]]))} className="bs-sil-body" />
      {sketch && <path d={path(sketch.map((v, k) => [F.FRACS[k] * H, v * H]))} className="bs-sil-sketch" />}
    </svg>
  );
}

export function Conf({c}: {c: string}) {
  const t = c === 'S' ? 'Sourced' : c === 'E' ? 'Estimate' : 'Sourced point, estimated range';
  return <abbr className={'bs-conf ' + (c === 'S' ? 's' : c === 'E' ? 'e' : 'se')} title={t}>{c}</abbr>;
}

const TIER_HEAD: Record<string, [string, string]> = {
  make: ['Can be made', "Can't be made"], standard: ['Passes the tests', 'Fails a test'], use: ['Meets the brief', 'Misses the brief'],
  tooling: ['Reuses tooling', 'Needs new tooling'], precedent: ['Like the market', 'New to the market'],
};

/** Every rule that applies, grouped by tier, failures first within each. */
export function Verdict({ev, compact}: {ev: Evaluation; compact?: boolean}) {
  return (
    <div className="bs-verdict">
      {TIER_ORDER.map(tier => {
        const rows = ev.rules.filter(x => x.rule.tier === tier);
        if (!rows.length) return null;
        const bad = rows.filter(x => !x.ok);
        const hard = tier === 'make' || tier === 'standard' || tier === 'use';
        return (
          <div key={tier} className={'bs-tier ' + (bad.length ? (hard ? 'bad' : 'warn') : 'ok')}>
            <div className="bs-tier-head"><span className="bs-dot" />{TIER_HEAD[tier][bad.length ? 1 : 0]}</div>
            <ul>
              {(compact ? bad : bad.concat(rows.filter(x => x.ok))).map(x => (
                <li key={x.rule.id} className={x.ok ? 'ok' : 'bad'} title={x.rule.note}>
                  <span>{x.ok ? x.rule.name : plain(x.rule, x.value)}</span>
                  {!compact && <span className="bs-val">{fmt(x.value, x.rule.unit)}</span>}
                  <Conf c={x.rule.confidence} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
