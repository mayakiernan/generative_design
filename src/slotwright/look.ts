/** How a resolved build is drawn: set on the floor, coloured by piece (numbered) or as plain plywood or paint. */
import {panelBox} from '../slots/collide.js';
import type {Panel} from '../slots/panel.js';
import {parseColor, pieceColor, WOOD, type RenderPiece} from './render.js';
import type {Resolved} from './sdk.js';

/** Panels set on the floor (lowest point at z = 0), keeping x, y on the lattice. */
export function floored(panels: Panel[]): Panel[] {
  const z0 = Math.min(...panels.map(p => panelBox(p).lo[2]));
  return panels.map(p => ({...p, frame: {...p.frame, o: [p.frame.o[0], p.frame.o[1], p.frame.o[2] - z0]}}));
}

export type Look = 'pieces' | 'plain';
export function renderPieces(r: Resolved, look: Look): RenderPiece[] {
  return floored(r.panels).map((panel, i) => ({
    panel,
    color: parseColor(r.pieces[i].color) ?? (look === 'pieces' ? pieceColor(i) : WOOD[i % WOOD.length]),
    label: look === 'pieces' ? String(i + 1) : undefined,
  }));
}

/** What a render shows, in the words the model reads with it. */
export const viewsText = (o: {azimuth?: number; elevation?: number; look?: Look}) => `${o.azimuth !== undefined
  ? `one view from azimuth ${o.azimuth}°, elevation ${o.elevation ?? 20}° (azimuth 0 looks from −y, 90 from +x, 180 from +y, 270 from −x; elevation 90 looks straight down)`
  : 'contact sheet: FRONT top left (from −y: x right, z up), SIDE top right (from +x: y right, z up), TOP bottom left (looking down: x right, y up), ISO bottom right (from −y, +x, above)'}. ${o.look === 'plain' ? 'Plain plywood (or painted) look, no numbers.' : 'Each piece has its own colour and its number (#).'} The floor checker squares are lattice cells, each centred on a cell's (x, y).`;
