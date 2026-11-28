import {useEffect, useRef} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';
import type {Params, Profile} from './vendor/model.mjs';

/**
 * One bottle in 3D: the profile lathed round the axis, in brushed steel on a soft ground shadow.
 * A bottle gets a thread and a simple cap: an outer thread rolled on the neck with a cap over it, or
 * an inner thread in the mouth with a cap whose plug screws into it. A tumbler gets a press-on lid.
 * In section the near half is cut away, so the walls show in ink: one shell for single wall, two
 * shells and the vacuum gap for double wall (shells drawn at least 1.6 mm thick so they read at
 * this scale), and the cap in grey.
 */
export type Thread = 'outer' | 'inner';
export function Viewer({prof, cfg, section, cap = true, thread = 'outer', className}: {prof: Profile; cfg: Params; section: boolean; cap?: boolean; thread?: Thread; className?: string}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{show: (prof: Profile, cfg: Params, section: boolean, cap: boolean, thread: Thread) => void; dispose: () => void} | null>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.NeutralToneMapping;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    const camera = new THREE.PerspectiveCamera(28, 1, 1, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.enablePan = false; controls.maxPolarAngle = Math.PI * 0.62;
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    scene.add(key);

    const brushed = brushTexture();
    const metal = new THREE.MeshStandardMaterial({color: 0xd9dbdf, metalness: 1, roughness: 0.34, roughnessMap: brushed, side: THREE.DoubleSide});
    const lining = new THREE.MeshStandardMaterial({color: 0xa7abb1, metalness: 0.2, roughness: 0.8, side: THREE.DoubleSide});
    const plastic = new THREE.MeshStandardMaterial({color: 0x2b2b2b, metalness: 0, roughness: 0.55, side: THREE.DoubleSide});
    const ink = new THREE.MeshBasicMaterial({color: 0x2b2b2b, side: THREE.DoubleSide});
    const capInk = new THREE.MeshBasicMaterial({color: 0x8a8983, side: THREE.DoubleSide});
    const shadowTex = shadowTexture();
    const shadowMat = new THREE.MeshBasicMaterial({map: shadowTex, transparent: true, depthWrite: false});
    let group: THREE.Group | null = null, pending = false, H = 200, R = 40, sec = false, touched = false;

    const render = () => { pending = false; controls.update(); renderer.render(scene, camera); };
    const request = () => { if (!pending) { pending = true; requestAnimationFrame(render); } };
    controls.addEventListener('change', request);
    controls.addEventListener('start', () => { touched = true; });

    const frame = () => {
      const half = Math.tan((camera.fov * Math.PI) / 360);
      const dist = Math.max((H * 0.66) / half, (R * 1.8) / (half * camera.aspect));
      const az = sec ? -Math.PI / 2 + 0.35 : 0.55, el2 = 0.16;
      controls.target.set(0, H * 0.5, 0);
      camera.position.set(dist * Math.sin(az) * Math.cos(el2), H * 0.5 + dist * Math.sin(el2), dist * Math.cos(az) * Math.cos(el2));
      camera.near = dist / 50; camera.far = dist * 10; camera.updateProjectionMatrix();
      controls.minDistance = dist * 0.3; controls.maxDistance = dist * 2.5;
      key.position.set(H * 0.6, H * 1.6, H * 0.9);
      touched = false;
      request();
    };

    const lathe = (pts: [number, number][], mat: THREE.Material, phiLen: number) =>
      new THREE.Mesh(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(Math.max(x, 0.01), y)), 128, 0, phiLen), mat);

    // A wall band in the cut plane (x = 0), from radius a(z) out to b(z), on both cut edges.
    const band = (zs: number[], inner: number[], outer: number[]) => {
      const g = new THREE.Group();
      for (const side of [1, -1]) {
        const shape = new THREE.Shape();
        shape.moveTo(side * outer[0], zs[0]);
        for (let i = 1; i < zs.length; i++) shape.lineTo(side * outer[i], zs[i]);
        for (let i = zs.length - 1; i >= 0; i--) shape.lineTo(side * inner[i], zs[i]);
        g.add(cutFace(shape, ink));
      }
      return g;
    };
    // A closed (radius, height) outline, filled in the cut plane on both edges.
    const outline = (pts: [number, number][], mat: THREE.Material) => {
      const g = new THREE.Group();
      for (const side of [1, -1]) {
        const shape = new THREE.Shape();
        pts.forEach(([x, y], i) => (i ? shape.lineTo(side * x, y) : shape.moveTo(side * x, y)));
        g.add(cutFace(shape, mat));
      }
      return g;
    };
    const cutFace = (shape: THREE.Shape, mat: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
      mesh.rotation.y = -Math.PI / 2; // shape x -> world z, so the face lies in the x = 0 plane
      mesh.position.x = -0.05;        // just in front of the lathed halves
      return mesh;
    };

    const show = (p: Profile, c: Params, s: boolean, withCap: boolean, thread: Thread) => {
      if (group) { scene.remove(group); group.traverse(o => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); }); }
      group = new THREE.Group();
      const {z, r} = p;
      const n = z.length;
      const dbl = c.wall === 'double';
      // Shells are under a millimetre; drawn at least 1.6 mm so the section reads (a diagram, not to scale).
      const tO = Math.max(Number(dbl ? c.t_outer_mm : c.t_mm) || 0.5, 1.6);
      const gapMm = dbl ? Number(c.gap_mm) || 2.5 : 0;
      const tI = dbl ? Math.max(Number(c.t_inner_mm) || 0.4, 1.6) : 0;
      const stack = tO + gapMm + tI;
      const phi = s ? Math.PI : Math.PI * 2;
      const outer: [number, number][] = [[0.01, 0], ...z.map((zz, i) => [r[i], zz] as [number, number])];
      group.add(lathe(outer, metal, phi));
      const cav: [number, number][] = [];
      for (let i = n - 1; i >= 0; i--) if (z[i] >= stack) cav.push([Math.max(r[i] - stack, 0.5), z[i]]);
      cav.push([0.01, stack]);
      group.add(lathe(cav, lining, phi));
      group.add(lathe([[r[n - 1], z[n - 1]], [Math.max(r[n - 1] - stack, 0.5), z[n - 1]]], metal, phi));
      if (s) {
        const at = (off: number) => r.map(v => Math.max(v - off, 0.2));
        group.add(band(z, at(tO), at(0)));
        const baseBand = (y0: number, y1: number, rr: number) => band([y0, y1], [0, 0], [rr, rr]);
        group.add(baseBand(0, tO, r[0]));
        if (dbl) {
          group.add(band(z, at(tO + gapMm + tI), at(tO + gapMm)));
          group.add(baseBand(tO + gapMm, stack, Math.max(r[0] - tO - gapMm, 0.5)));
        }
      }

      // The finish: thread and cap on a bottle, a lid on a tumbler.
      const rTop = r[n - 1], zTop = z[n - 1];
      let top = zTop;
      if (c.form === 'tumbler') {
        if (withCap) {
          const lid = tumblerLid(rTop, zTop);
          group.add(lathe(lid, plastic, phi));
          if (s) group.add(outline(lid, capInk));
          top = zTop + 9;
        }
      } else {
        const neck = neckLength(z, r);
        const inner = thread === 'inner';
        const rIn = Math.max(rTop - stack, 2);
        const pitch = rTop > 26 ? 4.2 : 3.4;
        const z0 = zTop - neck + 2, z1 = zTop - 3;
        if (z1 - z0 > pitch * 0.8) {
          // The thread starts just under the lip and winds down the neck.
          const turns = Math.min((z1 - z0 - 1.6) / pitch, 2.75);
          const start = z1 - 0.8 - turns * pitch;
          for (const [a, b] of threadSpans(turns, s)) {
            const curve = new Helix(inner ? rIn - 0.4 : rTop + 0.4, start, pitch, a, b);
            group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, Math.round(((b - a) / (2 * Math.PI)) * 72)), 0.9, 8, false), metal));
          }
        }
        if (withCap) {
          let prof2: [number, number][], capH: number;
          if (inner) {
            capH = Math.max(10, Math.min(16, 20 - rTop * 0.2));
            prof2 = plugCap(rTop, rIn, zTop, Math.max(z0, zTop - 22), zTop + capH);
          } else {
            capH = Math.max(12, Math.min(22, 26 - rTop * 0.25));
            const skirt = Math.min(zTop - 8, Math.max(zTop - neck + 0.5, zTop - 26));
            prof2 = screwCap(rTop, zTop, skirt, zTop + capH);
          }
          group.add(lathe(prof2, plastic, phi));
          if (s) group.add(outline(prof2, capInk));
          top = zTop + capH;
        }
      }

      const Rmax = Math.max(...r);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(Rmax * 4.2, Rmax * 4.2), shadowMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = 0.05;
      group.add(ground);

      scene.add(group);
      H = top; R = Rmax; sec = s;
      frame();
    };

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      if (!touched) frame(); else request();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    api.current = {show, dispose: () => {
      ro.disconnect(); controls.dispose(); brushed.dispose(); shadowTex.dispose(); renderer.dispose(); el.removeChild(renderer.domElement);
    }};
    return () => { api.current?.dispose(); api.current = null; };
  }, []);

  useEffect(() => { api.current?.show(prof, cfg, section, cap, thread); }, [prof, cfg, section, cap, thread]);

  return <div ref={host} className={'bs-viewer ' + (className ?? '')} />;
}

// The neck: the run below the mouth where the outline stays within 4% of the mouth's radius.
function neckLength(z: number[], r: number[]): number {
  const n = z.length, rTop = r[n - 1], zTop = z[n - 1];
  let k = n - 1;
  while (k > 0 && r[k - 1] <= rTop * 1.04 && zTop - z[k - 1] < 30) k--;
  return zTop - z[k];
}

// A thread helix round the neck, matching the lathe's angle (x = r sin φ, z = r cos φ).
class Helix extends THREE.Curve<THREE.Vector3> {
  constructor(private R: number, private y0: number, private pitch: number, private a: number, private b: number) { super(); }
  getPoint(t: number, target = new THREE.Vector3()) {
    const phi = this.a + (this.b - this.a) * t;
    return target.set(this.R * Math.sin(phi), this.y0 + (phi / (2 * Math.PI)) * this.pitch, this.R * Math.cos(phi));
  }
}
// The thread's angle spans: all of it, or in section only the half kept (sin φ ≥ 0).
function threadSpans(turns: number, section: boolean): [number, number][] {
  const end = turns * 2 * Math.PI;
  if (!section) return [[0, end]];
  const out: [number, number][] = [];
  for (let a = 0; a < end; a += 2 * Math.PI) out.push([a, Math.min(a + Math.PI, end)]);
  return out;
}

// A screw cap over the neck: inside face at the axis, down the skirt, rounded top edge.
function screwCap(rTop: number, zTop: number, skirt: number, top: number): [number, number][] {
  const rIn = rTop + 1.4, rOut = rTop + 3.6, e = 3;
  const pts: [number, number][] = [[0.01, zTop + 2.2], [rIn, zTop + 2.2], [rIn, skirt], [rOut - 0.7, skirt], [rOut, skirt + 0.9], [rOut, top - e]];
  for (let k = 1; k <= 6; k++) { const a = (k / 6) * (Math.PI / 2); pts.push([rOut - e + e * Math.cos(a), top - e + e * Math.sin(a)]); }
  pts.push([0.01, top]);
  return pts;
}
// A cap with a plug that screws into an inner thread: the plug down the mouth, a flat cap on the lip.
function plugCap(rTop: number, rIn: number, zTop: number, plugBottom: number, top: number): [number, number][] {
  const rPlug = Math.max(rIn - 1.4, 1), rOut = rTop + 0.8, e = 2.5;
  const pts: [number, number][] = [[0.01, plugBottom], [rPlug - 1, plugBottom], [rPlug, plugBottom + 1], [rPlug, zTop], [rOut, zTop], [rOut, top - e]];
  for (let k = 1; k <= 6; k++) { const a = (k / 6) * (Math.PI / 2); pts.push([rOut - e + e * Math.cos(a), top - e + e * Math.sin(a)]); }
  pts.push([0.01, top]);
  return pts;
}
// A press-on tumbler lid: a skirt over the rim, a raised ring and a recessed centre.
function tumblerLid(rTop: number, zTop: number): [number, number][] {
  return [[0.01, zTop + 4], [rTop - 6, zTop + 4], [rTop - 4, zTop + 9], [rTop + 0.6, zTop + 9], [rTop + 1.6, zTop + 7.8], [rTop + 1.6, zTop - 6], [rTop + 0.2, zTop - 6], [rTop + 0.2, zTop + 1.5], [0.01, zTop + 1.5]];
}
// Fine streaks round the circumference, as a roughness map (the lathe's v runs up the profile).
function brushTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 512;
  const g = c.getContext('2d')!;
  let s = 11;
  const rand = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let y = 0; y < 512; y++) { const v = Math.round(150 + 105 * rand()); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, 4, 1); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 6);
  return t;
}
// A soft round shadow for the ground.
function shadowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(20,20,18,0.42)');
  grad.addColorStop(0.42, 'rgba(20,20,18,0.22)');
  grad.addColorStop(1, 'rgba(20,20,18,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
