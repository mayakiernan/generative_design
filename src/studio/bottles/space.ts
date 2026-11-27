// The design-space map: features grouped (silhouette, proportion, size, neck & mouth, wall system,
// process), each group weighted by a slider, then projected to 3D by PCA. Clusters come from
// k-means on the same weighted features, so moving a slider re-forms both.

export interface FeatureTable { names: string[]; groups: string[]; mean: number[]; sd: number[]; rows: Float64Array[] }

export function featureTable(raw: [string, string, number][][]): FeatureTable {
  const first = raw[0];
  const names = first.map(f => f[1]), groups = first.map(f => f[0]);
  const d = names.length, n = raw.length;
  const mean = new Array(d).fill(0), sd = new Array(d).fill(0);
  for (const r of raw) r.forEach((f, j) => { mean[j] += f[2] / n; });
  for (const r of raw) r.forEach((f, j) => { sd[j] += (f[2] - mean[j]) ** 2 / n; });
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const rows = raw.map(r => Float64Array.from(r, (f, j) => (f[2] - mean[j]) / sd[j]));
  return {names, groups, mean, sd, rows};
}

export function standardize(t: FeatureTable, raw: [string, string, number][]): Float64Array {
  return Float64Array.from(raw, (f, j) => (f[2] - t.mean[j]) / t.sd[j]);
}

// Each group counts by its slider weight, not by how many features it has.
export function columnWeights(t: FeatureTable, weights: Record<string, number>): number[] {
  const count: Record<string, number> = {};
  for (const g of t.groups) count[g] = (count[g] ?? 0) + 1;
  return t.groups.map(g => (weights[g] ?? 1) / Math.sqrt(count[g]));
}

// Symmetric eigendecomposition (cyclic Jacobi), largest eigenvalues first.
function eigen(A: number[][]): {values: number[]; vectors: number[][]} {
  const n = A.length;
  const a = A.map(r => r.slice());
  const v: number[][] = A.map((_, i) => A.map((__, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
    if (off < 1e-12) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(a[p][q]) < 1e-15) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < n; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < n; k++) {
        const vkp = v[k][p], vkq = v[k][q];
        v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq;
      }
    }
  }
  const order = a.map((r, i) => i).sort((i, j) => a[j][j] - a[i][i]);
  return {values: order.map(i => a[i][i]), vectors: order.map(i => v.map(r => r[i]))};
}

export interface Projection { axes: number[][]; w: number[]; explained: number[]; scale: number }

export function project(t: FeatureTable, weights: Record<string, number>): Projection {
  const w = columnWeights(t, weights);
  const d = t.names.length, n = t.rows.length;
  const C = Array.from({length: d}, () => new Array(d).fill(0));
  for (const r of t.rows) for (let i = 0; i < d; i++) { const xi = r[i] * w[i]; for (let j = i; j < d; j++) C[i][j] += xi * r[j] * w[j]; }
  for (let i = 0; i < d; i++) for (let j = i; j < d; j++) { C[i][j] /= n; C[j][i] = C[i][j]; }
  const {values, vectors} = eigen(C);
  const total = values.reduce((s, x) => s + Math.max(x, 0), 0) || 1;
  const axes = vectors.slice(0, 3);
  // Scale so the cloud fills about a unit cube.
  let spread = 0;
  for (const r of t.rows) for (const ax of axes) spread = Math.max(spread, Math.abs(dotW(r, ax, w)));
  return {axes, w, explained: values.slice(0, 3).map(x => Math.max(x, 0) / total), scale: 1 / (spread || 1)};
}

function dotW(r: Float64Array, ax: number[], w: number[]) {
  let s = 0;
  for (let i = 0; i < r.length; i++) s += r[i] * w[i] * ax[i];
  return s;
}

export function coords(pr: Projection, r: Float64Array): [number, number, number] {
  return [dotW(r, pr.axes[0], pr.w) * pr.scale, dotW(r, pr.axes[1], pr.w) * pr.scale, dotW(r, pr.axes[2], pr.w) * pr.scale];
}

// k-means++ on the weighted features, seeded so the same weights give the same clusters.
export function kmeans(t: FeatureTable, w: number[], k: number, seed = 7): {assign: Int32Array; centers: number[][]} {
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const n = t.rows.length, d = w.length;
  const X = t.rows.map(r => Float64Array.from(r, (v, i) => v * w[i]));
  const dist = (a: ArrayLike<number>, b: ArrayLike<number>) => { let q = 0; for (let i = 0; i < d; i++) q += (a[i] - b[i]) ** 2; return q; };
  const centers: number[][] = [Array.from(X[Math.floor(rand() * n)])];
  const dmin = X.map(x => dist(x, centers[0]));
  while (centers.length < k) {
    const sum = dmin.reduce((a, b) => a + b, 0);
    let r = rand() * sum, i = 0;
    while (i < n - 1 && (r -= dmin[i]) > 0) i++;
    centers.push(Array.from(X[i]));
    for (let j = 0; j < n; j++) dmin[j] = Math.min(dmin[j], dist(X[j], centers[centers.length - 1]));
  }
  const assign = new Int32Array(n);
  for (let it = 0; it < 25; it++) {
    let moved = 0;
    for (let j = 0; j < n; j++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const q = dist(X[j], centers[c]); if (q < bd) { bd = q; best = c; } }
      if (assign[j] !== best) { assign[j] = best; moved++; }
    }
    const sums = centers.map(() => new Array(d).fill(0)), counts = new Array(k).fill(0);
    for (let j = 0; j < n; j++) { counts[assign[j]]++; for (let i = 0; i < d; i++) sums[assign[j]][i] += X[j][i]; }
    for (let c = 0; c < k; c++) if (counts[c]) centers[c] = sums[c].map(v => v / counts[c]);
    if (!moved) break;
  }
  return {assign, centers};
}

export function nearestCenter(centers: number[][], r: Float64Array, w: number[]): number {
  let best = 0, bd = Infinity;
  centers.forEach((c, i) => { let q = 0; for (let j = 0; j < c.length; j++) q += (r[j] * w[j] - c[j]) ** 2; if (q < bd) { bd = q; best = i; } });
  return best;
}

// What each end of an axis means, from the feature with the largest loading.
const ENDS: Record<string, [string, string]> = {
  tumbler: ['bottle', 'tumbler'], h_over_d: ['squat', 'tall'], log_capacity: ['small', 'large'], height: ['short', 'tall'],
  diameter: ['slim', 'wide'], mouth_id: ['small mouth', 'large mouth'], mouth_body: ['narrow neck', 'open top'],
  fam_narrow: ['', 'narrow mouth'], fam_wide: ['', 'wide mouth'], fam_off: ['', 'odd mouth'], fam_rim: ['', 'tumbler rim'],
  double: ['single wall', 'double wall'], gap: ['thin gap', 'wide gap'], steel: ['light steel', 'heavy steel'],
  drawn: ['tube', 'drawn'], expansion: ['straight body', 'bulged body'], passes: ['few passes', 'many passes'],
};
export function axisLabel(t: FeatureTable, pr: Projection, i: number): [string, string] {
  const ax = pr.axes[i];
  let best = 0;
  for (let j = 1; j < ax.length; j++) if (Math.abs(ax[j] * pr.w[j]) > Math.abs(ax[best] * pr.w[best])) best = j;
  const name = t.names[best];
  const ends = ENDS[name] ?? (name.startsWith('r@') ? ['narrow at ' + Math.round(+name.slice(2) * 100) + '%', 'wide at ' + Math.round(+name.slice(2) * 100) + '%'] : ['−', '+']);
  return ax[best] >= 0 ? [ends[0], ends[1]] : [ends[1], ends[0]];
}
