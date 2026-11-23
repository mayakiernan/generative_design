/**
 * A finished Slotwright build as the rest of the slot code sees a design: through the form atlas's path (atlasDesign
 * → the engine's evaluate), so the 3D build scene, cut sheets and assembly guide work unchanged.
 */
import type {BuildStep} from '../slots/atlas/assembly.js';
import {fromKey, pieceId, type Form, type Kit} from '../slots/atlas/lattice.js';
import {atlasDesign} from '../slots/atlas/view.js';
import type {Design} from '../slots/engine.js';
import {marksFor} from '../slots/engrave.js';
import type {GalleryItem} from '../slots/gallery.js';

/** A key fromKey (lattice.ts) reads back in this order, so build steps keep their piece numbers. */
export function formKey(form: Form): string {
  return form.discs.map(p => `${p.c.join(',')},${p.a},${p.m}${p.k === 'H1' ? ',H1' : ''}`).join(';');
}

/** The finished design for `kit`, as a gallery item (design, parts, steps, engraving marks). */
export function finishedItem(kit: Kit, key: string, steps: BuildStep[], title: string): GalleryItem {
  const d: Design = atlasDesign(kit, {key, steps, top: null}, title);
  const types = fromKey(key).discs.map(p => pieceId(p)!);
  const counts = new Map<string, number>();
  for (const id of types) counts.set(id, (counts.get(id) ?? 0) + 1);
  return {
    id: key, seed: 0, design: d, stands: true,
    parts: [...counts.entries()].map(([id, count]) => ({id, name: `${kit.pieces.get(id)!.name} (${id})`, count})),
    steps: d.steps.map(s => ({text: s.how})),
    marks: marksFor(types, kit.pieces, kit.size),
  };
}
