/**
 * How many forms the kit makes with n pieces: exact where the atlas counted every one (npm run atlas enumerates
 * them up to a few pieces), estimated past that.
 *
 * A form is a connected arrangement of kit pieces on the lattice (full discs and both half discs) with no two
 * running into each other, counted once however it is turned or mirrored about the vertical.
 *
 * The estimate treats forms as lattice animals, whose counts grow like A · λ^n · n^−θ, with θ = 3/2 in three
 * dimensions. λ and A are fitted to the last two exact counts. Small counts pin λ down poorly, so every estimate
 * comes with a band:
 *  - low: every further piece multiplies the count by the last ratio seen (the ratio is still rising, so this
 *    undercounts);
 *  - high: the ratio keeps rising as λ − c/n, fitted to the last two ratios.
 * Numbers this large overflow a double's integers, so values are kept as log10.
 */

export interface CountRow {
  n: number;
  /** log10 of the count: exact, or the central estimate. */
  log: number;
  /** log10 of the low and high ends of the band (equal to log when exact). */
  low: number; high: number;
  exact: boolean;
  /** Known to be more than this (the enumeration passed its cap here). */
  atLeast?: number;
}

const THETA = 1.5;

/**
 * `atLeast`: a count known only from below, such as the level where the atlas's enumeration stopped because it
 * passed its cap (2,000,000 forms). No estimate or band end goes under it, or under what it implies further on.
 */
export function formCounts(levels: {n: number; forms: number}[], from = 2, to = 30, atLeast?: {n: number; forms: number}): CountRow[] {
  const exact = new Map(levels.filter(l => l.forms > 0).map(l => [l.n, l.forms]));
  const m = Math.max(...exact.keys());
  if (!exact.has(m - 1) || !exact.has(m - 2)) throw new Error('need the last three exact counts to estimate');
  const a = (n: number) => exact.get(n)!;
  const r = (n: number) => a(n) / a(n - 1);
  // Central: a_n = a_m · λ^(n−m) · (m/n)^θ, with λ from the last ratio.
  const lambda = r(m) * (m / (m - 1)) ** THETA;
  // High: ratios r_k = λh − c/k through the last two ratios.
  const c = (r(m) - r(m - 1)) / (1 / (m - 1) - 1 / m), lambdaHigh = r(m) + c / m;
  const rows: CountRow[] = [];
  let high = Math.log10(a(m));
  for (let n = from; n <= to; n++) {
    if (exact.has(n)) { const v = Math.log10(a(n)); rows.push({n, log: v, low: v, high: v, exact: true}); continue; }
    if (n < m) continue;
    high += Math.log10(lambdaHigh - c / n);
    const log = Math.log10(a(m)) + (n - m) * Math.log10(lambda) + THETA * Math.log10(m / n);
    let low = Math.log10(a(m)) + (n - m) * Math.log10(r(m));
    if (atLeast && n >= atLeast.n) low = Math.max(low, Math.log10(atLeast.forms) + (n - atLeast.n) * Math.log10(r(m)));
    rows.push({n, log: Math.max(log, low), low, high: Math.max(high, low), exact: false, ...(atLeast?.n === n ? {atLeast: atLeast.forms} : {})});
  }
  return rows;
}

/** A count for people: exact with separators, or "≈ 6.1 × 10^35" as [mantissa, exponent]. */
export function formatCount(row: CountRow): {text: string; mantissa?: string; exponent?: number} {
  if (row.exact) return {text: Math.round(10 ** row.log).toLocaleString('en-US')};
  return sci(row.log);
}

export function sci(log: number): {text: string; mantissa: string; exponent: number} {
  let exponent = Math.floor(log), mantissa = 10 ** (log - exponent);
  if (mantissa >= 9.95) { mantissa /= 10; exponent++; }
  if (exponent < 6) { const v = Math.round(10 ** log); return {text: v.toLocaleString('en-US'), mantissa: v.toLocaleString('en-US'), exponent: 0}; }
  const m = mantissa.toFixed(1);
  return {text: `${m} × 10^${exponent}`, mantissa: m, exponent};
}
