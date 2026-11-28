import {useEffect, useRef} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';
import type {Params, Profile} from './vendor/model.mjs';

/**
 * One bottle in 3D: the profile lathed round the axis. In section the near half is cut away, so
 * the walls show in ink: one shell for single wall, two shells and the vacuum gap for double wall
 * (shells drawn at least 1.6 mm thick so they read at this scale).
 */
export function Viewer({prof, cfg, section, className}: {prof: Profile; cfg: Params; section: boolean; className?: string}) {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<{show: (prof: Profile, cfg: Params, section: boolean) => void; dispose: () => void} | null>(null);

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
    const metal = new THREE.MeshStandardMaterial({color: 0xd9dbdf, metalness: 1, roughness: 0.32, side: THREE.DoubleSide});
    const lining = new THREE.MeshStandardMaterial({color: 0xa7abb1, metalness: 0.2, roughness: 0.8, side: THREE.DoubleSide});
    const ink = new THREE.MeshBasicMaterial({color: 0x2b2b2b, side: THREE.DoubleSide});
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
        const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), ink);
        mesh.rotation.y = -Math.PI / 2; // shape x -> world z, so the band lies in the x = 0 plane
        g.add(mesh);
      }
      return g;
    };

    const show = (p: Profile, c: Params, s: boolean) => {
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
        const zs = z;
        const at = (off: number) => r.map(v => Math.max(v - off, 0.2));
        group.add(band(zs, at(tO), at(0)));
        // base discs
        const baseBand = (y0: number, y1: number, rr: number) => band([y0, y1], [0, 0], [rr, rr]);
        group.add(baseBand(0, tO, r[0]));
        if (dbl) {
          group.add(band(zs, at(tO + gapMm + tI), at(tO + gapMm)));
          group.add(baseBand(tO + gapMm, stack, Math.max(r[0] - tO - gapMm, 0.5)));
        }
      }
      scene.add(group);
      H = z[n - 1]; R = Math.max(...r); sec = s;
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
    api.current = {show, dispose: () => { ro.disconnect(); controls.dispose(); renderer.dispose(); el.removeChild(renderer.domElement); }};
    return () => { api.current?.dispose(); api.current = null; };
  }, []);

  useEffect(() => { api.current?.show(prof, cfg, section); }, [prof, cfg, section]);

  return <div ref={host} className={'bs-viewer ' + (className ?? '')} />;
}
