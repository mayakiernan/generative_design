/**
 * A small CPU renderer for slot-kit builds, so the agent can look at what it built (BrickWright renders LDraw parts
 * for the same reason; text checks say a build is valid, not that it reads as the thing asked for).
 *
 * Each panel is extruded from its convex pieces (outline minus slits) to its sheet thickness and drawn with a
 * z-buffer, orthographic camera, flat shading and dark outlines where the visible piece or face changes. Pieces get
 * distinct colours and their numbers, so a render can be matched to the build's piece list. The floor is a checker
 * of lattice cells (each square centred on a cell's x, y), drawn at z = 0. Pure TypeScript: returns RGB pixels.
 */
import {cross, dot, norm, type V3} from '../slots/math.js';
import {panelVertices, toWorld, type Panel} from '../slots/panel.js';

export type RGB = [number, number, number];
export interface Image {width: number; height: number; rgb: Uint8Array}
export interface RenderPiece {panel: Panel; color: RGB; label?: string}
export interface Camera {azimuth: number; elevation: number}

/** Camera position direction: azimuth 0 looks from −y (front), 90 from +x; elevation 90 looks straight down. */
export function viewDir(c: Camera): V3 {
  const az = (c.azimuth * Math.PI) / 180, el = (c.elevation * Math.PI) / 180;
  return norm([-Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), -Math.sin(el)]);
}

export const SHEET_VIEWS: {name: string; camera: Camera; caption: string}[] = [
  {name: 'FRONT', camera: {azimuth: 0, elevation: 0}, caption: 'front: from −y looking +y (x right, z up)'},
  {name: 'SIDE', camera: {azimuth: 90, elevation: 0}, caption: 'side: from +x looking −x (y right, z up)'},
  {name: 'TOP', camera: {azimuth: 0, elevation: 90}, caption: 'top: looking down (x right, y up)'},
  {name: 'ISO', camera: {azimuth: 35, elevation: 30}, caption: 'iso: from −y, +x, above'},
];

/** Distinct colours by piece number, light enough for dark outlines and labels. */
export function pieceColor(i: number): RGB {
  const h = (i * 137.508) % 360, s = 0.55, l = 0.64;
  const f = (n: number) => { const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}
export const WOOD: RGB[] = [[231, 210, 172], [220, 194, 150], [226, 202, 160], [214, 186, 140], [234, 216, 182]];

const NAMED: Record<string, RGB> = {
  black: [40, 40, 44], white: [240, 240, 236], red: [200, 52, 44], green: [58, 150, 72], blue: [50, 96, 190], yellow: [236, 196, 48],
  orange: [232, 124, 40], grey: [140, 140, 140], gray: [140, 140, 140], brown: [128, 84, 52], pink: [230, 140, 170], purple: [128, 72, 160], wood: WOOD[0],
};
/** A colour from a name or #rgb / #rrggbb, or null. */
export function parseColor(s: string | undefined): RGB | null {
  if (!s) return null;
  const k = s.trim().toLowerCase();
  if (NAMED[k]) return NAMED[k];
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(k);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

/* ---------- a 3×5 pixel font for labels ---------- */
const GLYPHS: Record<string, string> = {
  '0': '111101101101111', '1': '010110010010111', '2': '111001111100111', '3': '111001111001111', '4': '101101111001001',
  '5': '111100111001111', '6': '111100111101111', '7': '111001010010010', '8': '111101111101111', '9': '111101111001111',
  F: '111100110100100', R: '110101110101101', O: '010101101101010', N: '110101101101101', T: '111010010010010', S: '011100010001110',
  I: '111010010010111', D: '110101101101110', E: '111100111100111', P: '111101111100100', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', '+': '000010111010000', '-': '000000111000000', '#': '101111101111101', ' ': '000000000000000',
};

interface Buffers {w: number; h: number; z: Float32Array; id: Int32Array; col: Uint8Array}

function newBuffers(w: number, h: number, bg: RGB): Buffers {
  const col = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) col.set(bg, 3 * i);
  return {w, h, z: new Float32Array(w * h).fill(Infinity), id: new Int32Array(w * h).fill(-1), col};
}

/** Fill a screen-space triangle; `shade` gives the colour at a pixel (barycentrics given). */
function triangle(B: Buffers, p: [number, number, number][], id: number, shade: (b0: number, b1: number, b2: number) => RGB) {
  const [a, b, c] = p, area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(area) < 1e-9) return;
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))), x1 = Math.min(B.w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))), y1 = Math.min(B.h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + 0.5, py = y + 0.5;
    const w0 = ((b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px)) / area;
    const w1 = ((c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px)) / area;
    const w2 = 1 - w0 - w1;
    if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
    const z = w0 * a[2] + w1 * b[2] + w2 * c[2], k = y * B.w + x;
    if (z >= B.z[k]) continue;
    B.z[k] = z; B.id[k] = id;
    B.col.set(shade(w0, w1, w2), 3 * k);
  }
}

function line(B: Buffers, x0: number, y0: number, x1: number, y1: number, color: RGB, width = 1) {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))) + 1, r = Math.floor(width / 2);
  for (let i = 0; i <= n; i++) {
    const x = Math.round(x0 + ((x1 - x0) * i) / n), y = Math.round(y0 + ((y1 - y0) * i) / n);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < B.w && Y < B.h) B.col.set(color, 3 * (Y * B.w + X));
    }
  }
}

function text(B: Buffers, s: string, x: number, y: number, scale: number, color: RGB, halo: RGB | null) {
  const glyphs = s.toUpperCase().split('').map(ch => GLYPHS[ch] ?? GLYPHS[' ']);
  const put = (X: number, Y: number, c: RGB) => { if (X >= 0 && Y >= 0 && X < B.w && Y < B.h) B.col.set(c, 3 * (Y * B.w + X)); };
  const each = (fn: (X: number, Y: number) => void) => glyphs.forEach((g, k) => {
    for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) if (g[r * 3 + q] === '1')
      for (let i = 0; i < scale; i++) for (let j = 0; j < scale; j++) fn(x + (k * 4 + q) * scale + i, y + r * scale + j);
  });
  if (halo) each((X, Y) => { for (let i = -scale; i <= scale; i++) for (let j = -scale; j <= scale; j++) put(X + i, Y + j, halo); });
  each((X, Y) => put(X, Y, color));
}
const textWidth = (s: string, scale: number) => (s.length * 4 - 1) * scale;

export interface RenderOptions {size?: number; pitch: number; labels?: boolean; title?: string}

/** Render one view of the pieces (world mm, z up, floor at z = 0). */
export function renderView(pieces: RenderPiece[], camera: Camera, o: RenderOptions): Image {
  const out = o.size ?? 512, ss = 2, W = out * ss;
  const f = viewDir(camera), worldUp: V3 = Math.abs(f[2]) > 0.99 ? [0, 1, 0] : [0, 0, 1];
  const right = norm(cross(f, worldUp)), up = cross(right, f);
  const proj = (p: V3): [number, number, number] => [dot(p, right), dot(p, up), dot(p, f)];

  // Fit the model and its floor patch, with a margin.
  const vs = pieces.flatMap(r => panelVertices(r.panel));
  const lo = [0, 1].map(k => Math.min(...vs.map(v => v[k]))), hi = [0, 1].map(k => Math.max(...vs.map(v => v[k])));
  const m = 0.6 * o.pitch, fx0 = lo[0] - m, fx1 = hi[0] + m, fy0 = lo[1] - m, fy1 = hi[1] + m;
  const floor: V3[] = [[fx0, fy0, 0], [fx1, fy0, 0], [fx1, fy1, 0], [fx0, fy1, 0]];
  const pts = [...vs, ...floor].map(proj);
  const sx0 = Math.min(...pts.map(q => q[0])), sx1 = Math.max(...pts.map(q => q[0])), sy0 = Math.min(...pts.map(q => q[1])), sy1 = Math.max(...pts.map(q => q[1]));
  const pad = 0.08 * W, k = Math.min((W - 2 * pad) / Math.max(sx1 - sx0, 1), (W - 2 * pad) / Math.max(sy1 - sy0, 1));
  const cx = (sx0 + sx1) / 2, cy = (sy0 + sy1) / 2;
  const screen = (p: V3): [number, number, number] => { const q = proj(p); return [W / 2 + (q[0] - cx) * k, W / 2 - (q[1] - cy) * k, q[2]]; };

  const B = newBuffers(W, W, [250, 250, 248]);
  // Floor: a checker of lattice cells, shaded lighter far from the model.
  const fl = floor.map(screen), cell = (x: number, y: number) => (Math.round(x / o.pitch) + Math.round(y / o.pitch)) & 1;
  for (const tri of [[0, 1, 2], [0, 2, 3]]) {
    const P = tri.map(i => fl[i]), Wd = tri.map(i => floor[i]);
    triangle(B, P, -2, (b0, b1, b2) => {
      const x = b0 * Wd[0][0] + b1 * Wd[1][0] + b2 * Wd[2][0], y = b0 * Wd[0][1] + b1 * Wd[1][1] + b2 * Wd[2][1];
      return cell(x, y) ? [222, 224, 228] : [236, 238, 241];
    });
  }
  // Light: a key light from above front left, plus a headlight so faces seen edge-on stay readable.
  const L = norm([-0.45, -0.55, 0.7]);
  pieces.forEach((r, i) => {
    const P = r.panel, h = P.t / 2, n = P.frame.n;
    const faceColor = (normal: V3): RGB => {
      const nn = dot(normal, f) > 0 ? ([-normal[0], -normal[1], -normal[2]] as V3) : normal;
      const s = 0.5 + 0.32 * Math.max(0, dot(nn, L)) + 0.18 * Math.abs(dot(normal, f));
      return r.color.map(c => Math.min(255, Math.round(c * s))) as RGB;
    };
    const top = faceColor(n), bottom = faceColor([-n[0], -n[1], -n[2]]);
    for (const q of P.pieces) {
      const T = q.map(v => screen(toWorld(P.frame, v, h))), Bt = q.map(v => screen(toWorld(P.frame, v, -h)));
      for (let j = 1; j + 1 < q.length; j++) {
        triangle(B, [T[0], T[j], T[j + 1]], i * 4, () => top);
        triangle(B, [Bt[0], Bt[j], Bt[j + 1]], i * 4 + 1, () => bottom);
      }
      for (let j = 0; j < q.length; j++) {
        const a = q[j], b = q[(j + 1) % q.length], ex = b[0] - a[0], ey = b[1] - a[1], l = Math.hypot(ex, ey) || 1;
        const side = norm([P.frame.u[0] * (ey / l) - P.frame.v[0] * (ex / l), P.frame.u[1] * (ey / l) - P.frame.v[1] * (ex / l), P.frame.u[2] * (ey / l) - P.frame.v[2] * (ex / l)]);
        const c = faceColor(side), A0 = T[j], A1 = T[(j + 1) % q.length], B0 = Bt[j], B1 = Bt[(j + 1) % q.length];
        triangle(B, [A0, A1, B1], i * 4 + 2, () => c);
        triangle(B, [A0, B1, B0], i * 4 + 2, () => c);
      }
    }
  });
  // Outlines where the visible piece or face changes (and the floor's edge).
  const edge: RGB = [52, 48, 44], col = B.col, id = B.id;
  const ink = new Uint8Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const kk = y * W + x, a = id[kk];
    const differs = (b: number) => b !== a && (a >= 0 || b >= 0);
    if ((x + 1 < W && differs(id[kk + 1])) || (y + 1 < W && differs(id[kk + W]))) ink[kk] = 1;
  }
  for (let kk = 0; kk < W * W; kk++) if (ink[kk]) col.set(edge, 3 * kk);
  // Floor line when the floor is seen edge-on.
  if (Math.abs(f[2]) < 0.2) { const a = screen([fx0, fy0, 0]), b = screen([fx1, fy1, 0]), c = screen([fx1, fy0, 0]), d = screen([fx0, fy1, 0]); const xs = [a, b, c, d]; line(B, Math.min(...xs.map(p => p[0])), a[1], Math.max(...xs.map(p => p[0])), a[1], [120, 120, 120], ss); }

  const img = downsample(B, ss);
  const I: Buffers = {w: out, h: out, z: new Float32Array(0), id: new Int32Array(0), col: img.rgb};
  // Piece numbers at the middle of each piece's visible area.
  if (o.labels !== false) {
    const sum = pieces.map(() => [0, 0, 0]);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const a = id[y * W + x]; if (a >= 0) { const s = sum[a >> 2]; s[0] += x; s[1] += y; s[2]++; } }
    pieces.forEach((r, i) => {
      const [sx, sy, n] = sum[i];
      if (!r.label || n < 400 * ss * ss) return;
      let X = sx / n, Y = sy / n;
      if (id[Math.floor(Y) * W + Math.floor(X)] >> 2 !== i) {
        // The middle is hidden or a hole: use the visible pixel of this piece nearest to it.
        let best = Infinity;
        for (let y = 0; y < W; y += 2) for (let x = 0; x < W; x += 2) if (id[y * W + x] >= 0 && id[y * W + x] >> 2 === i) { const d = (x - sx / n) ** 2 + (y - sy / n) ** 2; if (d < best) { best = d; X = x; Y = y; } }
      }
      const sc = 2, tw = textWidth(r.label, sc);
      text(I, r.label, Math.round(X / ss - tw / 2), Math.round(Y / ss - 2.5 * sc), sc, [20, 20, 20], [255, 255, 255]);
    });
  }
  // Axis gizmo and view name.
  const gx = 34, gy = out - 34, axes: [V3, RGB, string][] = [[[1, 0, 0], [205, 50, 40], 'X'], [[0, 1, 0], [40, 150, 60], 'Y'], [[0, 0, 1], [50, 90, 200], 'Z']];
  for (const [v, c, s] of axes) {
    const q = [dot(v, right), -dot(v, up)];
    if (Math.hypot(q[0], q[1]) < 0.15) { text(I, s, gx - 4, gy - 4, 2, c, [255, 255, 255]); continue; }
    line(I, gx, gy, gx + q[0] * 22, gy + q[1] * 22, c, 2);
    text(I, s, Math.round(gx + q[0] * 30 - 3), Math.round(gy + q[1] * 30 - 5), 2, c, null);
  }
  if (o.title) text(I, o.title, 10, 10, 3, [90, 90, 90], null);
  return img;
}

function downsample(B: Buffers, ss: number): Image {
  const w = B.w / ss, h = B.h / ss, rgb = new Uint8Array(w * h * 3), n = ss * ss;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) s += B.col[3 * ((y * ss + j) * B.w + x * ss + i) + c];
    rgb[3 * (y * w + x) + c] = Math.round(s / n);
  }
  return {width: w, height: h, rgb};
}

/** Tile images into a grid, `cols` across, with a 2 px gutter. */
export function tile(images: Image[], cols: number): Image {
  const w = images[0].width, h = images[0].height, rows = Math.ceil(images.length / cols), g = 2;
  const W = cols * w + (cols - 1) * g, H = rows * h + (rows - 1) * g, rgb = new Uint8Array(W * H * 3).fill(200);
  images.forEach((im, k) => {
    const ox = (k % cols) * (w + g), oy = Math.floor(k / cols) * (h + g);
    for (let y = 0; y < h; y++) rgb.set(im.rgb.subarray(3 * y * w, 3 * (y + 1) * w), 3 * ((oy + y) * W + ox));
  });
  return {width: W, height: H, rgb};
}

/** The four standard views as one contact sheet. */
export function contactSheet(pieces: RenderPiece[], o: RenderOptions): Image {
  return tile(SHEET_VIEWS.map(v => renderView(pieces, v.camera, {...o, title: v.name})), 2);
}
