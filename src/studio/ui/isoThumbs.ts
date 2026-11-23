/**
 * Still isometric renders of designs for the atlas grid: one off-screen WebGL renderer for all of them (a canvas
 * per card would run out of WebGL contexts), drawing grey pieces with black rims and slits on a clear
 * background, saved as an image. Renders run one at a time with a pause between, so the page stays responsive (a timer, not an animation frame, so
 * they still finish in a background tab).
 */
import * as THREE from 'three';
import {fromKey} from '../../slots/atlas/lattice';
import type {Verdict} from '../../slots/atlas/judge';
import {makePanel, turnPanel, type Panel} from '../../slots/panel';
import type {V2} from '../../slots/math';
import {kitFor} from '../query';

/** A design to draw: its closed key, its cut-to-fit top, and the disc diameter (mm). */
export interface IsoJob {key: string; top: Verdict['top']; rest?: number[]; diameter: number}

const inside = (q: V2, poly: V2[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};

/**
 * A lattice panel as geometry, straight from its outline and slit cuts (no engine run): faces from its convex
 * pieces (group 0), and walls (group 1) along the rim outside every slit and down each slit inside the disc.
 */
function panelGeometry(p: Panel): {mesh: THREE.BufferGeometry; lines: THREE.BufferGeometry} {
  const {o, u, v, n} = p.frame, h = p.t / 2;
  const at = (q: V2, s: number): number[] => [o[0] + u[0] * q[0] + v[0] * q[1] + n[0] * s, o[1] + u[1] * q[0] + v[1] * q[1] + n[1] * s, o[2] + u[2] * q[0] + v[2] * q[1] + n[2] * s];
  const pos: number[] = [], nor: number[] = [], edges: number[] = [];
  const tri = (a: number[], b: number[], c: number[], nn: number[]) => { pos.push(...a, ...b, ...c); nor.push(...nn, ...nn, ...nn); };
  const nNeg = [-n[0], -n[1], -n[2]];
  for (const pc of p.pieces) for (let i = 1; i + 1 < pc.length; i++) { tri(at(pc[0], h), at(pc[i], h), at(pc[i + 1], h), n); tri(at(pc[0], -h), at(pc[i + 1], -h), at(pc[i], -h), nNeg); }
  const faces = pos.length / 3;
  const cuts = p.cuts.map(c => c.poly);
  const segs: [V2, V2][] = [];
  const ring = (loop: V2[], keep: (m: V2) => boolean) => loop.forEach((a, i) => { const b = loop[(i + 1) % loop.length]; if (keep([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])) segs.push([a, b]); });
  ring(p.outline, m => !cuts.some(c => inside(m, c)));
  for (const c of cuts) ring(c, m => inside(m, p.outline));
  for (const [a, b] of segs) {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const out = [(u[0] * dy - v[0] * dx) / l, (u[1] * dy - v[1] * dx) / l, (u[2] * dy - v[2] * dx) / l];
    const a0 = at(a, -h), b0 = at(b, -h), a1 = at(a, h), b1 = at(b, h);
    tri(a0, b0, b1, out); tri(a0, b1, a1, out); tri(a0, b1, b0, out.map(x => -x)); tri(a0, a1, b1, out.map(x => -x));
    edges.push(...a1, ...b1, ...a0, ...b0);
  }
  const mesh = new THREE.BufferGeometry();
  mesh.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  mesh.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  mesh.addGroup(0, faces, 0);
  mesh.addGroup(faces, pos.length / 3 - faces, 1);
  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
  return {mesh, lines};
}

function panelsOf(job: IsoJob): Panel[] {
  const kit = kitFor(job.diameter), R = job.rest, panels = fromKey(job.key).panels(kit).map(p => (R ? turnPanel(p, R) : p));
  if (job.top) panels.push(makePanel(panels.length, 'Top', 'top', job.top.outline, job.top.frame, kit.t));
  return panels;
}

const PX = 720;
const GREYS = ['#bdbdb9', '#c7c7c3', '#b2b2ae', '#c2c2be', '#b7b7b3'];
const TOP = '#dcdcd8', CUT = '#151515';

let renderer: THREE.WebGLRenderer | null = null;
function getRenderer(): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({antialias: true, alpha: true, preserveDrawingBuffer: true});
    renderer.setPixelRatio(1);
    renderer.setSize(PX, PX, false);
    renderer.setClearColor(0x000000, 0);
  }
  return renderer;
}

/** Render one design isometrically (from the front right, above) and return it as a PNG data URL. */
export function renderIso(job: IsoJob): string {
  const r = getRenderer(), scene = new THREE.Scene(), disposables: {dispose(): void}[] = [];
  scene.add(new THREE.AmbientLight(0xffffff, 1.35));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1.2, 2.4, 1.6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.7);
  fill.position.set(-1.6, 0.8, -1);
  scene.add(fill);
  // Designs are z up; three.js is y up.
  const group = new THREE.Group();
  group.rotation.x = -Math.PI / 2;
  const cut = new THREE.MeshStandardMaterial({color: CUT, roughness: 0.8});
  const lineMat = new THREE.LineBasicMaterial({color: CUT, transparent: true, opacity: 0.8});
  disposables.push(cut, lineMat);
  panelsOf(job).forEach((p, i) => {
    const {mesh, lines} = panelGeometry(p);
    const face = new THREE.MeshStandardMaterial({color: p.role === 'top' ? TOP : GREYS[i % GREYS.length], roughness: 0.8});
    group.add(new THREE.Mesh(mesh, [face, cut]), new THREE.LineSegments(lines, lineMat));
    disposables.push(mesh, lines, face);
  });
  scene.add(group);
  scene.updateMatrixWorld(true);

  // An isometric camera, framed to the design's bounds as seen from that direction.
  const box = new THREE.Box3().setFromObject(group), centre = box.getCenter(new THREE.Vector3());
  const dir = new THREE.Vector3(1, 0.82, 1).normalize(), reach = box.getSize(new THREE.Vector3()).length();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, reach * 4);
  cam.position.copy(centre).addScaledVector(dir, reach * 2);
  cam.up.set(0, 1, 0);
  cam.lookAt(centre);
  cam.updateMatrixWorld(true);
  const inv = cam.matrixWorldInverse;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const q = new THREE.Vector3(x, y, z).applyMatrix4(inv);
    x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
  }
  const half = Math.max(x1 - x0, y1 - y0) * 0.5 * 1.04, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  Object.assign(cam, {left: cx - half, right: cx + half, top: cy + half, bottom: cy - half});
  cam.updateProjectionMatrix();

  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  disposables.forEach(x => x.dispose());
  return url;
}

const queue: {job: IsoJob; done: (url: string) => void}[] = [];
let busy = false;
/** Queue a render; `done` gets the image when its turn comes. */
export function queueIso(job: IsoJob, done: (url: string) => void) {
  queue.push({job, done});
  if (busy) return;
  busy = true;
  const next = () => {
    const job = queue.shift();
    if (!job) { busy = false; return; }
    try { job.done(renderIso(job.job)); } catch { /* a failed render leaves the line drawing in place */ }
    setTimeout(next, 16);
  };
  setTimeout(next, 16);
}
