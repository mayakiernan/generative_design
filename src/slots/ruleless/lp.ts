/**
 * A small dense linear-program solver (two-phase simplex) for the statics check.
 *
 * Equilibrium problems are highly degenerate (most right-hand sides are zero: horizontal forces, every torque), so
 * the right-hand side is perturbed by a tiny amount (well below the tolerance the answer is read with) and the ratio
 * test is Harris's two-pass one, which prefers large pivots. Pivots use the most negative reduced cost and switch to
 * Bland's rule after a run of degenerate steps.
 *
 * `Feasible` keeps the tableau of a phase-1 solution: further objectives over extra columns (a sideways push in
 * each of eight directions) start from that feasible basis instead of from scratch. The artificial columns hold
 * the basis inverse, so a new column is brought into the current basis by one multiplication.
 */

export type LPStatus = 'optimal' | 'infeasible' | 'unbounded' | 'stalled';
export interface LPResult {status: LPStatus; x: Float64Array; value: number; pivots: number}

const FEAS = 1e-9, COST = 1e-9, DROP = 1e-12;

class Tableau {
  T: Float64Array[];
  basis: Int32Array;
  pivots = 0;
  /** Columns: 0..n−1 structural, then extra columns, then m artificials (fixed at the end), then the RHS. */
  constructor(public m: number, public W: number, public piv = 1e-7) {
    this.T = Array.from({length: m + 1}, () => new Float64Array(W));
    this.basis = new Int32Array(m);
  }
  pivot(r: number, k: number) {
    const {T, m, W} = this, pr = T[r], pv = pr[k];
    for (let j = 0; j < W; j++) pr[j] /= pv;
    for (let i = 0; i <= m; i++) {
      if (i === r) continue;
      const row = T[i], f = row[k];
      if (f === 0) continue;
      // Entries that should cancel are cleared, so rounding noise is never chosen as a pivot later.
      for (let j = 0; j < W; j++) { const v = row[j] - f * pr[j]; row[j] = v > -DROP && v < DROP ? 0 : v; }
      row[k] = 0;
    }
    this.basis[r] = k;
    this.pivots++;
  }
  /** Minimise the objective row's reduced costs over allowed entering columns. */
  run(allowed: (j: number) => boolean, maxPivots: number): 'optimal' | 'unbounded' | 'stalled' {
    const {T, m, W, piv: PIV} = this, obj = T[m], R = W - 1;
    let degenerate = 0;
    for (;;) {
      if (this.pivots > maxPivots) return 'stalled';
      const bland = degenerate > 30;
      let k = -1, best = -COST;
      for (let j = 0; j < R; j++) {
        const d = obj[j];
        if (d >= -COST || !allowed(j)) continue;
        if (bland) { k = j; break; }
        if (d < best) { best = d; k = j; }
      }
      if (k < 0) return 'optimal';
      // Harris: the largest step any row allows with a little slack, then the biggest pivot within it.
      let theta = Infinity;
      for (let i = 0; i < m; i++) { const a = T[i][k]; if (a > PIV) theta = Math.min(theta, (Math.max(T[i][R], 0) + FEAS) / a); }
      if (theta === Infinity) return 'unbounded';
      let r = -1, big = 0;
      for (let i = 0; i < m; i++) {
        const a = T[i][k];
        if (a > PIV && Math.max(T[i][R], 0) / a <= theta && (a > big || (bland && a === big && r >= 0 && this.basis[i] < this.basis[r]))) { big = a; r = i; }
      }
      degenerate = Math.max(T[r][R], 0) / big <= FEAS ? degenerate + 1 : 0;
      this.pivot(r, k);
    }
  }
  read(n: number): Float64Array {
    const x = new Float64Array(n), R = this.W - 1;
    for (let i = 0; i < this.m; i++) if (this.basis[i] < n) x[this.basis[i]] = Math.max(0, this.T[i][R]);
    return x;
  }
}

/** Deterministic tiny perturbation of the right-hand side, against degeneracy. */
const perturb = (b: ArrayLike<number>, eps: number) => Float64Array.from(b, (v, i) => v + eps * (1 + ((i * 2654435761) % 1000) / 1000));

/**
 * Phase 1 for A x = b, x ≥ 0. Returns a handle for further objectives, or null if there is no such x.
 */
export class Feasible {
  private constructor(readonly tab: Tableau, private n: number, private m: number, private sign: Float64Array) {}

  /** Debugging hook: called with the infeasibility certificate when phase 1 fails. */
  static onInfeasible: ((y: Float64Array, info: {status: string; residual: number; allowed: number; pivots: number}) => void) | null = null;

  /** How many solves broke down numerically in both modes (each counted as not feasible). */
  static troubles = 0;

  static find(A: ArrayLike<number>[], b: ArrayLike<number>, maxPivots?: number): Feasible | null {
    // Fast mode first; if it breaks down (phase 1 cannot really be unbounded), again with larger pivots only.
    const fast = Feasible.attempt(A, b, maxPivots, 1e-7, 1e-9);
    if (fast !== 'broken') return fast;
    const safe = Feasible.attempt(A, b, maxPivots, 1e-5, 1e-10);
    if (safe !== 'broken') return safe;
    Feasible.troubles++;
    return null;
  }

  private static attempt(A: ArrayLike<number>[], b: ArrayLike<number>, maxPivots: number | undefined, piv: number, eps: number): Feasible | null | 'broken' {
    const m = A.length, n = m ? A[0].length : 0, W = n + m + 1, tab = new Tableau(m, W, piv), bp = perturb(b, eps), sign = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const s = bp[i] < 0 ? -1 : 1, row = tab.T[i], Ai = A[i];
      sign[i] = s;
      for (let j = 0; j < n; j++) row[j] = s * Ai[j];
      row[n + i] = 1;
      row[W - 1] = s * bp[i];
      tab.basis[i] = n + i;
    }
    const obj = tab.T[m];
    for (let i = 0; i < m; i++) { const row = tab.T[i]; for (let j = 0; j < n; j++) obj[j] -= row[j]; obj[W - 1] -= row[W - 1]; }
    const st = tab.run(j => j < n, maxPivots ?? 20 * (m + n));
    // The perturbation alone can leave up to its own total unmet (a balanced hinge cannot take a 1e-9 torque).
    const scale = Math.max(1, ...Array.from(b, v => Math.abs(v)));
    let shift = 0;
    for (let i = 0; i < m; i++) shift += Math.abs(bp[i] - b[i]);
    const residual = -obj[W - 1];
    if (st !== 'optimal' || residual < -1e-6 * scale) return 'broken';
    if (residual > 1e-7 * scale + 2 * shift) {
      // Farkas certificate: y = c_B B⁻¹ (phase-1 costs −1 on artificials), back in the unflipped rows. y·A ≤ 0 for
      // every column and y·b > 0: a virtual motion every force resists or ignores, but the loads drive.
      if (Feasible.onInfeasible) {
        const y = new Float64Array(m);
        for (let i = 0; i < m; i++) if (tab.basis[i] >= n) for (let r = 0; r < m; r++) y[r] -= tab.T[i][n + r];
        for (let r = 0; r < m; r++) y[r] *= sign[r];
        Feasible.onInfeasible(y, {status: st, residual, allowed: 1e-7 * scale + 2 * shift, pivots: tab.pivots});
      }
      return null;
    }
    // Drive zero artificials out of the basis where a structural column can replace them.
    for (let i = 0; i < m; i++) {
      if (tab.basis[i] < n) continue;
      let k = -1, big = 1e-7;
      for (let j = 0; j < n; j++) if (Math.abs(tab.T[i][j]) > big) { big = Math.abs(tab.T[i][j]); k = j; }
      if (k >= 0) tab.pivot(i, k);
    }
    return new Feasible(tab, n, m, sign);
  }

  get pivots() { return this.tab.pivots; }
  x(): Float64Array { return this.tab.read(this.n); }

  /**
   * Maximise λ over the feasible set with one extra column h (A x + λ h = b), λ ≤ cap. Starts from the phase-1
   * basis (λ = 0 is feasible there).
   */
  maxAlong(h: ArrayLike<number>, cap: number, maxPivots?: number): {status: LPStatus; value: number} {
    const {n, m} = this, base = this.tab, Wb = base.W;
    // New tableau: columns 0..n−1, λ (n), artificials (n+1..n+m), slack of the cap row (n+m+1), RHS.
    const W = n + m + 3, t = new Tableau(m + 1, W, base.piv), lam = n, art0 = n + 1, slack = n + m + 1;
    for (let i = 0; i < m; i++) {
      const src = base.T[i], dst = t.T[i];
      dst.set(src.subarray(0, n), 0);
      dst.set(src.subarray(n, n + m), art0);
      dst[W - 1] = src[Wb - 1];
      // λ's column in the current basis: B⁻¹ (sign ⊙ h); B⁻¹ sits in the artificial columns.
      let v = 0;
      for (let r = 0; r < m; r++) { const hr = h[r]; if (hr) v += src[n + r] * this.sign[r] * hr; }
      dst[lam] = v;
      const bi = base.basis[i];
      t.basis[i] = bi < n ? bi : bi + 1;
    }
    // Cap row: λ + slack = cap, with the slack basic.
    const capRow = t.T[m];
    capRow[lam] = 1; capRow[slack] = 1; capRow[W - 1] = cap;
    t.basis[m] = slack;
    // Objective: maximise λ, i.e. reduced cost −1 on λ (every basic variable costs nothing).
    t.T[m + 1][lam] = -1;
    t.pivots = 0;
    const st = t.run(j => j <= lam || j === slack, maxPivots ?? 20 * (m + n));
    if (st !== 'optimal') return {status: st, value: NaN};
    let value = 0;
    for (let i = 0; i <= m; i++) if (t.basis[i] === lam) value = t.T[i][W - 1];
    return {status: 'optimal', value: Math.min(cap, Math.max(0, value))};
  }
}

/** Maximise c·x with A x = b and x ≥ 0 (general use and tests). */
export function solveLP(c: ArrayLike<number>, A: ArrayLike<number>[], b: ArrayLike<number>): LPResult {
  const n = c.length, f = Feasible.find(A, b);
  if (!f) return {status: 'infeasible', x: new Float64Array(n), value: NaN, pivots: 0};
  const tab = f.tab, m = A.length, W = tab.W, obj = tab.T[m];
  obj.fill(0);
  for (let j = 0; j < n; j++) obj[j] = -c[j];
  for (let i = 0; i < m; i++) {
    const bi = tab.basis[i], cb = bi < n ? c[bi] : 0;
    if (!cb) continue;
    const row = tab.T[i];
    for (let j = 0; j < W; j++) obj[j] += cb * row[j];
  }
  const st = tab.run(j => j < n, 20 * (m + n));
  const x = tab.read(n);
  if (st !== 'optimal') return {status: st, x, value: NaN, pivots: tab.pivots};
  let value = 0;
  for (let j = 0; j < n; j++) value += c[j] * x[j];
  return {status: 'optimal', x, value, pivots: tab.pivots};
}
