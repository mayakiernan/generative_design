/**
 * The starting build.mjs and the agent's first message, shared by the command line and Slot Studio. On the command
 * line the SDK is imported by a path relative to the record; in the studio by the bare name 'slotlayer', which the
 * Web Worker supplies.
 */
import type {Material} from './validate.js';

export const WEB_SDK = 'slotlayer';

/** Slot Studio: disc sizes it offers (its 160 mm least, up to the SDK's 600 mm), its sheet and check clearance. */
export const STUDIO = {minDisc: 160, maxDisc: 600, sheetMm: 6.35, clearance: 0.2, maxPieces: 30, maxTurns: 60, maxBody: 4_000_000, turnSeconds: 285};

/** The studio's material for a run: the disc size and circle count the page sends. */
export function studioMaterial(discMm: number, circles: number): Material {
  return {discMm: Math.round(discMm * 10) / 10, sheetMm: STUDIO.sheetMm, clearance: STUDIO.clearance, maxPieces: Math.min(STUDIO.maxPieces, Math.max(1, Math.floor(circles)))};
}

export function template(prompt: string, sdkImport: string, material?: Material): string {
  const disc = material?.discMm ?? 80, sheet = material?.sheetMm ?? 3;
  return `// Slotwright build for: ${prompt.replace(/\s+/g, ' ')}
import {SlotBuild} from '${sdkImport}';

export const title = 'Untitled';

export function createBuild() {
  const b = new SlotBuild({discMm: ${disc}, sheetMm: ${sheet}});
  // TODO: place the pieces. A disc's plane follows from its cell; neighbouring discs are slotted together.
  b.disc([0, 0, 0], {name: 'base'});
  b.disc([1, 0, 0]);
  return b;
}

export function runTests(model, t) {
  // Checks for this request, e.g.:
  // t.check('at least 12 pieces', model.count >= 12, \`only \${model.count} pieces\`);
}
`;
}

export const numbered = (src: string, from = 1, to = Infinity) =>
  src.split('\n').map((l, i) => [i + 1, l] as const).filter(([n]) => n >= from && n <= to).map(([n, l]) => `${String(n).padStart(4)}  ${l}`).join('\n');

/** The first user message: the request, the material when the page sets one, and the starting file. */
export function firstMessage(prompt: string, source: string, material?: Material): string {
  const mat = material
    ? `\n\nMaterial, set by the user: discs ${material.discMm} mm across (${Math.round((material.discMm / 25.4) * 10) / 10} in) in ${material.sheetMm} mm (1/4 in) plywood; they have ${material.maxPieces} circles, so use at most ${material.maxPieces} pieces. Keep new SlotBuild({discMm: ${material.discMm}, sheetMm: ${material.sheetMm}}) as in the template; validation checks both.`
    : '';
  return `Request: ${prompt}${mat}\n\nbuild.mjs now holds the starting template:\n\n${numbered(source)}`;
}
