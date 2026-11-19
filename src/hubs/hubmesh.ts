// Printable hubs: a core sphere plus one sleeve per stick, with each bore starting at its stop depth.
import type {Manifold, ManifoldToplevel, Mat4, Mesh} from 'manifold-3d';
import type {Hole} from './design';
import type {HubParams} from './params';
import {cross, norm, type V3} from './vec';

/** Column-major transform taking +Z to `dir`, then moving `along` units down it. */
function frame(dir: V3, along = 0): Mat4 {
  const w = norm(dir), helper: V3 = Math.abs(w[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm(cross(helper, w)), v = cross(w, u);
  return [u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, w[0], w[1], w[2], 0, w[0] * along, w[1] * along, w[2] * along, 1];
}

export function buildHub(wasm: ManifoldToplevel, holes: Hole[], p: HubParams): Manifold {
  const {Manifold} = wasm;
  const rb = p.boreDiameter / 2, rt = rb + p.wall, seg = p.segments;
  const core = Manifold.sphere(Math.max(rt * 1.45, p.minStop + 0.4), seg);
  const solids: Manifold[] = [core], cuts: Manifold[] = [];
  for (const h of holes) {
    const reach = h.stop + p.insertion;
    solids.push(Manifold.cylinder(reach, rt, rt, seg).transform(frame(h.dir)));
    // Bore from the stop out past the mouth, with a 0.4 mm lead-in chamfer at the mouth.
    cuts.push(Manifold.cylinder(p.insertion + 1, rb, rb, seg).transform(frame(h.dir, h.stop)));
    // The cone runs past the mouth so no cut surface ends exactly on the sleeve's end face.
    cuts.push(Manifold.cylinder(1, rb, rb + 0.4 / 0.6, seg).transform(frame(h.dir, reach - 0.6)));
  }
  const body = Manifold.union(solids), holesCut = Manifold.union(cuts);
  const hub = body.subtract(holesCut);
  hub.status(); // Booleans are deferred; evaluate before freeing their inputs.
  [...solids, ...cuts, body, holesCut].forEach(m => m.delete());
  return hub;
}

/** Lay hubs out in a grid on z = 0 for one print job. */
export function printPlate(wasm: ManifoldToplevel, hubs: Manifold[], gap = 4): Manifold {
  const cols = Math.ceil(Math.sqrt(hubs.length));
  const size = Math.max(...hubs.map(h => { const b = h.boundingBox(); return Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]); }));
  const placed = hubs.map((h, i) => {
    const b = h.boundingBox();
    return h.translate([(i % cols) * (size + gap) - b.min[0], Math.floor(i / cols) * (size + gap) - b.min[1], -b.min[2]]);
  });
  const plate = wasm.Manifold.union(placed);
  plate.status();
  placed.forEach(m => m.delete());
  return plate;
}

/** Binary STL. */
export function toSTL(mesh: Mesh): Uint8Array {
  const tris = mesh.triVerts.length / 3, buf = new ArrayBuffer(84 + 50 * tris), view = new DataView(buf);
  view.setUint32(80, tris, true);
  const P = (i: number, k: number) => mesh.vertProperties[i * mesh.numProp + k];
  for (let t = 0; t < tris; t++) {
    const o = 84 + 50 * t, [a, b, c] = [0, 1, 2].map(k => mesh.triVerts[3 * t + k]);
    const e1: V3 = [P(b, 0) - P(a, 0), P(b, 1) - P(a, 1), P(b, 2) - P(a, 2)], e2: V3 = [P(c, 0) - P(a, 0), P(c, 1) - P(a, 1), P(c, 2) - P(a, 2)];
    const n = norm(cross(e1, e2));
    for (let k = 0; k < 3; k++) view.setFloat32(o + 4 * k, n[k], true);
    [a, b, c].forEach((v, j) => { for (let k = 0; k < 3; k++) view.setFloat32(o + 12 + 12 * j + 4 * k, P(v, k), true); });
  }
  return new Uint8Array(buf);
}
