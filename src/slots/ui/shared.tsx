/** Shared by both tabs of the slots page: the 3D build scene, the cut sheet drawing and file downloads. */
import {useEffect, useMemo, useRef} from 'react';
import {useFrame, useThree} from '@react-three/fiber';
import {Line, OrbitControls} from '@react-three/drei';
import * as THREE from 'three';
import type {Design, PanelOut} from '../engine';
import type {V2} from '../math';
import {loopPath, onSheet, packSheet, type Mark} from '../svg';

export const WOOD = ['#e7d2ac', '#dcc296', '#e2caa0', '#d6ba8c', '#ead8b6'];
const ACCENT = '#e95319';

/* ---------- geometry ---------- */

function buildPanel(p: PanelOut) {
  const {o, u, v, n} = p.frame, h = p.t / 2;
  const at = (q: V2, s: number): [number, number, number] => [o[0] + u[0] * q[0] + v[0] * q[1] + n[0] * s, o[1] + u[1] * q[0] + v[1] * q[1] + n[1] * s, o[2] + u[2] * q[0] + v[2] * q[1] + n[2] * s];
  const pos: number[] = [], nor: number[] = [], edges: number[] = [];
  const tri = (a: number[], b: number[], c: number[], nn: number[]) => { pos.push(...a, ...b, ...c); nor.push(...nn, ...nn, ...nn); };
  const nNeg = [-n[0], -n[1], -n[2]];
  for (const pc of p.pieces) for (let i = 1; i + 1 < pc.length; i++) {
    tri(at(pc[0], h), at(pc[i], h), at(pc[i + 1], h), n);
    tri(at(pc[0], -h), at(pc[i + 1], -h), at(pc[i], -h), nNeg);
  }
  for (const loop of p.loops) for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const out = [(u[0] * dy - v[0] * dx) / l, (u[1] * dy - v[1] * dx) / l, (u[2] * dy - v[2] * dx) / l];
    const a0 = at(a, -h), b0 = at(b, -h), a1 = at(a, h), b1 = at(b, h);
    tri(a0, b0, b1, out); tri(a0, b1, a1, out);
    edges.push(...a1, ...b1, ...a0, ...b0, ...a0, ...a1);
  }
  const mesh = new THREE.BufferGeometry();
  mesh.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  mesh.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  const lines = new THREE.BufferGeometry();
  lines.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
  return {mesh, lines};
}

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

/* ---------- 3D scene (design coordinates are z-up; the group turns them y-up) ---------- */

export function Scene({d, step, playing, explode, picked, onPick, onStepDone, colors = WOOD}: {d: Design; step: number; playing: boolean; explode: boolean; picked: number | null; onPick: (i: number | null) => void; onStepDone: () => void; colors?: string[]}) {
  const geo = useMemo(() => d.panels.map(buildPanel), [d]);
  useEffect(() => () => geo.forEach(g => { g.mesh.dispose(); g.lines.dispose(); }), [geo]);
  // A panel appears at its own step; a panel in a group step (a layer built on the bench) waits raised above its
  // place until that step lowers the whole group.
  const rank = useMemo(() => {
    const m = new Map<number, number>();
    d.steps.forEach((s, i) => { if (!s.group && !m.has(s.panel)) m.set(s.panel, i); });
    d.steps.forEach((s, i) => { for (const q of s.group ?? []) if (!m.has(q)) m.set(q, i); });
    return m;
  }, [d]);
  const lowered = useMemo(() => new Map(d.steps.flatMap((s, i) => (s.group ?? []).map(q => [q, i] as const))), [d]);
  const size = Math.max(d.size.width, d.size.depth, d.size.height);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const anim = useRef({t: 1, step: -1});
  const done = useRef(onStepDone);
  done.current = onStepDone;
  const {camera} = useThree();

  useEffect(() => {
    const r = Math.hypot(d.size.width, d.size.depth, d.size.height) * 1.9;
    camera.position.set(r * 0.62, d.size.height * 0.75 + r * 0.32, r * 0.8);
    camera.lookAt(0, d.size.height * 0.42, 0);
  }, [camera, d, size]);

  useEffect(() => { anim.current = {t: playing ? 0 : 1, step}; }, [step, playing]);

  useFrame((_, dt) => {
    const a = anim.current, was = a.t;
    if (a.t < 1) a.t = Math.min(1, a.t + dt / 0.75);
    d.panels.forEach((p, i) => {
      const g = groups.current[i];
      if (!g) return;
      const k = rank.get(p.id) ?? 0, s = d.steps[k];
      g.visible = k < step;
      let off = 0;
      if (k === step - 1 && a.t < 1 && !s.group) off = Math.min(s.distance, size * 0.7) * (1 - ease(a.t));
      // Later panels move further out along their own insertion path, so stacks spread apart too.
      if (explode && k > 0) off += size * (0.12 + (0.5 * k) / Math.max(1, d.steps.length - 1));
      const pos = [-s.travel[0] * off, -s.travel[1] * off, -s.travel[2] * off];
      const gi = lowered.get(p.id);
      if (gi !== undefined && !explode) {
        const G = d.steps[gi], lift = G.distance * (gi >= step ? 1 : gi === step - 1 && a.t < 1 ? 1 - ease(a.t) : 0);
        for (let c = 0; c < 3; c++) pos[c] -= G.travel[c] * lift;
      }
      g.position.set(pos[0], pos[1], pos[2]);
    });
    if (was < 1 && a.t >= 1) done.current();
  });

  const hull = d.support.hull, com = d.support.com, stands = d.support.margin > 0;
  return (
    <>
      <ambientLight intensity={1.25} />
      <directionalLight position={[size * 1.2, size * 2.2, size * 1.4]} intensity={2.4} />
      <directionalLight position={[-size * 1.5, size * 0.8, -size]} intensity={0.8} />
      <group rotation={[-Math.PI / 2, 0, 0]}>
        {d.panels.map((p, i) => {
          const hit = d.hits.some(h => h.a === p.id || h.b === p.id), on = picked === p.id;
          const color = hit ? '#c81e1e' : on ? ACCENT : colors[i % colors.length];
          return (
            <group key={`${d.title}-${i}`} ref={el => { groups.current[i] = el; }} onClick={e => { e.stopPropagation(); onPick(on ? null : p.id); }}>
              <mesh geometry={geo[i].mesh}><meshStandardMaterial color={color} roughness={0.78} metalness={0} /></mesh>
              <lineSegments geometry={geo[i].lines}><lineBasicMaterial color="#5b4a36" transparent opacity={0.55} /></lineSegments>
            </group>
          );
        })}
        {hull.length >= 3 && step >= d.steps.length && !explode && (
          <>
            <Line points={[...hull, hull[0]].map(q => [q[0], q[1], 0.4] as [number, number, number])} color={stands ? '#3c8a5a' : '#c81e1e'} lineWidth={1.6} />
            <Line points={[[com[0], com[1], com[2]], [com[0], com[1], 0.4]]} color={stands ? '#3c8a5a' : '#c81e1e'} lineWidth={1} dashed dashSize={size * 0.02} gapSize={size * 0.015} />
            <mesh position={[com[0], com[1], com[2]]}><sphereGeometry args={[size * 0.012, 16, 12]} /><meshBasicMaterial color={stands ? '#3c8a5a' : '#c81e1e'} /></mesh>
          </>
        )}
        <mesh position={[0, 0, -0.2]}><circleGeometry args={[size * 1.6, 64]} /><meshStandardMaterial color="#f1efe9" roughness={1} /></mesh>
      </group>
      <OrbitControls makeDefault target={[0, d.size.height * 0.42, 0]} />
    </>
  );
}

/* ---------- page ---------- */

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], {type}));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function CutSheet({d, marks}: {d: Design; marks?: Mark[]}) {
  const sheet = useMemo(() => packSheet(d, 12), [d]);
  const byId = new Map(sheet.items.map(it => [it.id, it]));
  return (
    <svg className="sheet" viewBox={`0 0 ${sheet.width} ${sheet.height}`} role="img" aria-label="Cut sheet">
      {sheet.items.map(it => (
        <g key={it.id}>
          <path d={loopPath(it.loops, it.x, it.y)} fillRule="evenodd" />
          {!marks && <text x={it.x + it.w / 2} y={it.y + it.h / 2} fontSize={Math.max(5, Math.min(14, it.w / 9))}>{it.name}</text>}
        </g>
      ))}
      {marks?.map((m, i) => { const it = byId.get(m.panel); if (!it) return null; const [x, y] = onSheet(it, m.at); return <text key={i} x={x} y={y} fontSize={m.size}>{m.text}</text>; })}
    </svg>
  );
}

