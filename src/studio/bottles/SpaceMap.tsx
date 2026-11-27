import {useEffect, useRef} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';

export interface MapPoints {
  pos: Float32Array; // x, y, z per point
  col: Float32Array; // r, g, b, a per point
  size: Float32Array;
  ring: Float32Array; // 1 draws an ink ring (market products, fits, the selection)
  keys: string[];
}

const VERT = `
attribute float size; attribute vec4 rgba; attribute float ring;
varying vec4 vC; varying float vRing;
uniform float scale;
void main() {
  vC = rgba; vRing = ring;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying vec4 vC; varying float vRing;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  vec3 c = vC.rgb;
  if (vRing > 0.5 && r > 0.34) c = vec3(0.17);
  gl_FragColor = vec4(c, vC.a);
}`;

/**
 * The design space in 3D: one point per design (and markers for market products, sketch fits and
 * the selection), axes labelled by what each end means. Drag to turn, scroll to zoom.
 */
export function SpaceMap({points, axes, onHover, onPick}: {
  points: MapPoints | null; axes: [string, string][];
  onHover: (key: string | null, x: number, y: number) => void; onPick: (key: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const api = useRef<{set: (p: MapPoints) => void; setAxes: (a: [string, string][]) => void} | null>(null);
  const cb = useRef({onHover, onPick});
  cb.current = {onHover, onPick};

  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
    camera.position.set(1.7, 1.1, 2.3);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.enablePan = false; controls.minDistance = 0.8; controls.maxDistance = 6;
    const geom = new THREE.BufferGeometry();
    const mat = new THREE.ShaderMaterial({vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, uniforms: {scale: {value: 3}}});
    const cloud = new THREE.Points(geom, mat);
    scene.add(cloud);
    const axisMat = new THREE.LineBasicMaterial({color: 0x2b2b2b, transparent: true, opacity: 0.35});
    const ends: THREE.Vector3[] = [];
    for (let i = 0; i < 3; i++) {
      const a = new THREE.Vector3(), b = new THREE.Vector3();
      a.setComponent(i, -1.1); b.setComponent(i, 1.1);
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), axisMat));
      ends.push(a, b);
    }
    let keys: string[] = [], pending = false;
    const placeLabels = () => {
      const box = labels.current;
      if (!box) return;
      const w = el.clientWidth, h = el.clientHeight;
      Array.from(box.children).forEach((node, i) => {
        const v = ends[i].clone().project(camera);
        (node as HTMLElement).style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%)`;
      });
    };
    const render = () => { pending = false; controls.update(); renderer.render(scene, camera); placeLabels(); };
    const request = () => { if (!pending) { pending = true; requestAnimationFrame(render); } };
    controls.addEventListener('change', request);

    const ray = new THREE.Raycaster();
    ray.params.Points = {threshold: 0.025};
    const pick = (e: PointerEvent): string | null => {
      const r = renderer.domElement.getBoundingClientRect();
      const m = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(m, camera);
      const hits = ray.intersectObject(cloud);
      if (!hits.length) return null;
      // Prefer markers (drawn larger) over plain designs under the cursor.
      const sizes = geom.getAttribute('size') as THREE.BufferAttribute;
      const alpha = geom.getAttribute('rgba') as THREE.BufferAttribute;
      let best = hits[0];
      for (const h of hits.slice(0, 12)) if (alpha.getW(h.index!) > 0.2 && sizes.getX(h.index!) > sizes.getX(best.index!)) best = h;
      return alpha.getW(best.index!) > 0.05 ? keys[best.index!] : null;
    };
    let down = {x: 0, y: 0};
    const onMove = (e: PointerEvent) => { const k = pick(e); cb.current.onHover(k, e.clientX, e.clientY); renderer.domElement.style.cursor = k ? 'pointer' : 'grab'; };
    const onDown = (e: PointerEvent) => { down = {x: e.clientX, y: e.clientY}; };
    const onUp = (e: PointerEvent) => { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) { const k = pick(e); if (k) cb.current.onPick(k); } };
    const onLeave = () => cb.current.onHover(null, 0, 0);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointerleave', onLeave);

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      // A size-4 point is about 4 css px at the starting distance (about 3 units away).
      mat.uniforms.scale.value = 3 * renderer.getPixelRatio() * Math.max(0.7, h / 600);
      request();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    api.current = {
      set: (p: MapPoints) => {
        keys = p.keys;
        geom.setAttribute('position', new THREE.BufferAttribute(p.pos, 3));
        geom.setAttribute('rgba', new THREE.BufferAttribute(p.col, 4));
        geom.setAttribute('size', new THREE.BufferAttribute(p.size, 1));
        geom.setAttribute('ring', new THREE.BufferAttribute(p.ring, 1));
        geom.computeBoundingSphere();
        request();
      },
      setAxes: () => request(),
    };
    return () => {
      ro.disconnect(); controls.dispose(); geom.dispose(); mat.dispose(); renderer.dispose();
      el.removeChild(renderer.domElement); api.current = null;
    };
  }, []);

  useEffect(() => { if (points) api.current?.set(points); }, [points]);
  useEffect(() => { api.current?.setAxes(axes); }, [axes]);

  return (
    <div className="bs-map">
      <div ref={host} className="bs-map-canvas" />
      <div ref={labels} className="bs-map-axes" aria-hidden>
        {axes.flatMap(([lo, hi], i) => [<span key={i + 'a'}>{lo}</span>, <span key={i + 'b'}>{hi}</span>])}
      </div>
    </div>
  );
}
