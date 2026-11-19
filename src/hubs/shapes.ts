// Stand-ins for the generative step. A text-to-3D model would supply `TriMesh`;
// a vision or language model that labels parts would supply `Part[]`.
import type {V3} from './vec';

export interface TriMesh { positions: Float32Array; indices: Uint32Array }
/** Axis-aligned box primitive with a functional name (seat, leg, ...). */
export interface Part { name: string; min: V3; max: V3 }

export type ShapeSource =
  | {kind: 'mesh'; name: string; mesh: TriMesh; sticks: number}
  | {kind: 'parts'; name: string; parts: Part[]};

/** A closed, curved tube with a slightly pentagonal section, thick in the middle, a stub stem at one end. */
export function bananaMesh(rings = 48, sides = 20): TriMesh {
  const pos: number[] = [], idx: number[] = [];
  const R = 160, sweep = 1.25; // arc radius (mm) and sweep (rad); size is rescaled later anyway
  const center = (t: number): V3 => { const a = -sweep / 2 + sweep * t; return [R * Math.sin(a), 0, R * (1 - Math.cos(a))]; };
  const radius = (t: number) => 24 * Math.pow(Math.sin(Math.PI * t), 0.55) + (t > 0.93 ? 4 : 0);
  for (let i = 0; i <= rings; i++) {
    const t = i / rings, c = center(t), a = -sweep / 2 + sweep * t;
    const n: V3 = [-Math.sin(a), 0, Math.cos(a)], b: V3 = [0, 1, 0];
    const r = radius(t);
    for (let j = 0; j < sides; j++) {
      const phi = (2 * Math.PI * j) / sides;
      const pent = 1 + 0.06 * Math.cos(5 * phi); // banana ridges
      const x = Math.cos(phi) * r * pent, y = Math.sin(phi) * r * pent;
      pos.push(c[0] + n[0] * x + b[0] * y, c[1] + n[1] * x + b[1] * y, c[2] + n[2] * x + b[2] * y);
    }
  }
  const tip0 = pos.length / 3; { const c = center(0); pos.push(...c); }
  const tip1 = pos.length / 3; { const c = center(1); pos.push(c[0] + 6, c[1], c[2] + 2); }
  for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
    const a = i * sides + j, b = i * sides + ((j + 1) % sides), c = a + sides, d = b + sides;
    idx.push(a, c, b, b, c, d);
  }
  for (let j = 0; j < sides; j++) {
    idx.push(tip0, j, (j + 1) % sides);
    const o = rings * sides;
    idx.push(tip1, o + ((j + 1) % sides), o + j);
  }
  return {positions: new Float32Array(pos), indices: new Uint32Array(idx)};
}

/** A chair as named boxes, sized so spans land near one stick. Legs sit on the seat's corners. */
export function chairParts(): Part[] {
  const w = 160, d = 160, seat = 160, back = 170, t = 8;
  const leg = (name: string, x: number, y: number, top: number): Part => ({name, min: [x - t / 2, y - t / 2, 0], max: [x + t / 2, y + t / 2, top]});
  return [
    leg('leg front left', 0, 0, seat), leg('leg front right', w, 0, seat),
    leg('leg back left', 0, d, seat), leg('leg back right', w, d, seat),
    {name: 'seat', min: [0, 0, seat - t / 2], max: [w, d, seat + t / 2]},
    {name: 'backrest', min: [0, d - t / 2, seat], max: [w, d + t / 2, seat + back]},
    {name: 'stretcher front', min: [0, -t / 2, seat / 2 - t / 2], max: [w, t / 2, seat / 2 + t / 2]},
    {name: 'stretcher back', min: [0, d - t / 2, seat / 2 - t / 2], max: [w, d + t / 2, seat / 2 + t / 2]},
    {name: 'stretcher left', min: [-t / 2, 0, seat / 2 - t / 2], max: [t / 2, d, seat / 2 + t / 2]},
    {name: 'stretcher right', min: [w - t / 2, 0, seat / 2 - t / 2], max: [w + t / 2, d, seat / 2 + t / 2]},
  ];
}

export const SHAPES: Record<string, () => ShapeSource> = {
  banana: () => ({kind: 'mesh', name: 'banana', mesh: bananaMesh(), sticks: 48}),
  chair: () => ({kind: 'parts', name: 'chair', parts: chairParts()}),
};
