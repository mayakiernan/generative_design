/**
 * Purpose text → function spec (docs/function-spec.md), for the purposes the atlas judge can check today: one
 * level surface on top, or none at all (a sculpture, which only has to stand). Shelves and chairs are recognised but need checks that do not exist yet (stack, back), so
 * they come back as `unsupported`. Rule-based: a fixed vocabulary of purposes, plus heights and widths written with
 * a unit ("60 cm tall", "a top 40 cm wide").
 */

export type PurposeId = 'side table' | 'coffee table' | 'dining table' | 'desk' | 'stool' | 'bench' | 'plant stand' | 'table' | 'sculpture';

export interface FunctionSpec {
  purpose: PurposeId;
  label: string;
  /** 'none': no surface (a sculpture); it only has to stand, and the height and width limits are open. */
  role: 'top' | 'seat' | 'none';
  /** Surface height above the floor, mm: the band and where the score peaks. */
  minH: number; maxH: number; target: number;
  /** Least width of the surface, mm. */
  minWidth: number;
  /** Load it is meant for, kg (shown; the checks are for balance, not strength). */
  kg: number;
  /** Room for knees under the top is wanted but not yet checked. */
  knee: boolean;
  /** Words that set something, for the page to show what it understood. */
  heard: string[];
}

export type Parsed = {ok: true; spec: FunctionSpec} | {ok: false; reason: string; heard: string[]};

interface Preset {id: PurposeId; words: RegExp; role: 'top' | 'seat' | 'none'; minH: number; maxH: number; target: number; minWidth: number; kg: number; knee?: boolean}

/** Starting values from the purpose library in docs/function-spec.md. Order matters: the first match wins. */
export const PRESETS: Preset[] = [
  {id: 'coffee table', words: /\bcoffee\b/, role: 'top', minH: 380, maxH: 480, target: 420, minWidth: 400, kg: 25},
  {id: 'dining table', words: /\b(dining|kitchen) table\b|\bdining\b/, role: 'top', minH: 720, maxH: 760, target: 740, minWidth: 750, kg: 50, knee: true},
  {id: 'desk', words: /\b(desk|work ?bench|console)\b/, role: 'top', minH: 720, maxH: 760, target: 740, minWidth: 500, kg: 40, knee: true},
  {id: 'side table', words: /\b(side|end|bedside|night ?stand|accent)\b/, role: 'top', minH: 450, maxH: 600, target: 520, minWidth: 300, kg: 15},
  {id: 'plant stand', words: /\b(plant|pot|planter|pedestal|plinth)\b/, role: 'top', minH: 300, maxH: 900, target: 600, minWidth: 250, kg: 15},
  {id: 'stool', words: /\bstool\b/, role: 'seat', minH: 430, maxH: 480, target: 450, minWidth: 280, kg: 100},
  {id: 'bench', words: /\bbench\b/, role: 'seat', minH: 420, maxH: 460, target: 440, minWidth: 280, kg: 200},
  {id: 'sculpture', words: /\b(sculpture|sculptural|object|art|artwork|ornament|centre ?piece|center ?piece|decor|totem|form)\b/, role: 'none', minH: 0, maxH: Infinity, target: 0, minWidth: 0, kg: 0},
  {id: 'table', words: /\btable\b/, role: 'top', minH: 450, maxH: 760, target: 600, minWidth: 300, kg: 20},
];

const NOT_YET: [RegExp, string][] = [
  [/\b(shel(f|ves)|bookcase|book ?shelf|rack|cubby|storage)\b/, 'Shelves need surfaces stacked above each other, which is not checked yet.'],
  [/\b(chair|armchair|seat with a back|lounger)\b/, 'Chairs need a back to lean on, which is not checked yet.'],
];

const UNIT: Record<string, number> = {mm: 1, cm: 10, m: 1000, in: 25.4, inch: 25.4, inches: 25.4, '"': 25.4, ft: 304.8, foot: 304.8, feet: 304.8};
const LEN = String.raw`(\d+(?:\.\d+)?)\s*(mm|cm|m|inches|inch|in|"|ft|foot|feet)(?![a-z])`;

/** A length followed (or preceded) by a word, in mm, or null. */
function lengthNear(s: string, words: string): number | null {
  const after = new RegExp(`${LEN}\\s*(?:${words})`).exec(s) ?? new RegExp(`(?:${words})\\s*(?:of|at|about)?\\s*${LEN}`).exec(s);
  return after ? Number(after[1]) * UNIT[after[2]] : null;
}

export function parsePurpose(raw: string): Parsed {
  const s = ` ${raw.toLowerCase().replace(/[,;]/g, ' ')} `;
  // Naming a sculpture wins over the words around it ("a sculpture for the shelf" is a sculpture, not shelves).
  const sculpture = PRESETS.find(p => p.id === 'sculpture')!.words.test(s);
  if (!sculpture) for (const [re, reason] of NOT_YET) if (re.test(s)) return {ok: false, reason, heard: [re.exec(s)![0].trim()]};
  const preset = sculpture ? PRESETS.find(p => p.id === 'sculpture')! : PRESETS.find(p => p.words.test(s));
  if (!preset) {
    return {ok: false, reason: 'Try a table, side table, coffee table, dining table, desk, stool, bench, plant stand or sculpture.', heard: []};
  }
  const heard: string[] = [preset.id];
  let {minH, maxH, target, minWidth} = preset;
  const h = lengthNear(s, 'tall|high|height');
  if (h) { target = h; minH = h * 0.95; maxH = h * 1.05; heard.push(`${Math.round(h)} mm tall`); }
  else if (/\b(tall|high)\b/.test(s)) { minH = target; heard.push('tall'); }
  else if (/\blow\b/.test(s)) { maxH = target; heard.push('low'); }
  const w = lengthNear(s, 'wide|across|width|top');
  if (w) { minWidth = w; heard.push(`top at least ${Math.round(w)} mm wide`); }
  else if (/\b(small|little|tiny)\b/.test(s)) { minWidth = Math.round(minWidth * 0.7); heard.push('small'); }
  else if (/\b(large|big|wide)\b/.test(s)) { minWidth = Math.round(minWidth * 1.3); heard.push('large'); }
  const label = preset.id === 'table' ? 'table' : preset.id;
  return {ok: true, spec: {purpose: preset.id, label, role: preset.role, minH, maxH, target, minWidth, kg: preset.kg, knee: !!preset.knee, heard}};
}
