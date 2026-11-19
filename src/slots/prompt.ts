/**
 * Rule-based prompt reading. It recognises a fixed vocabulary (typologies, sizes, dimensions, plan shapes,
 * counts, materials, slit words) and reports what it understood. It is not general language understanding.
 */
import type {SlitType} from './panel';

export type Typology = 'table' | 'tower' | 'sphere';
export type Plan = 'round' | 'square' | 'rect' | 'hex' | 'tri';

export interface Brief {
  prompt: string;
  typology: Typology;
  /** Human label: "coffee table", "small tower", … */
  label: string;
  /** mm. Table: top surface height, top width × depth. Tower: height, base width. Sphere: diameter in width. */
  height: number;
  width: number;
  depth: number;
  plan: Plan | null;
  /** Degrees of extra rotation per level; 0 = none. */
  twist: number;
  taper: number | null;
  count: number | null;
  levels: number | null;
  thickness: number | null;
  windows: boolean | null;
  slit: SlitType | null;
  /** Polygon named for a pinwheel kit ("hexagon kit"). */
  kitSides: number | null;
  heard: string[];
  unsupported: string | null;
}

const NUM: Record<string, number> = {one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10};
const UNIT: Record<string, number> = {mm: 1, millimeter: 1, millimeters: 1, millimetre: 1, millimetres: 1, cm: 10, centimeter: 10, centimeters: 10, centimetre: 10, centimetres: 10, m: 1000, meter: 1000, meters: 1000, metre: 1000, metres: 1000, in: 25.4, inch: 25.4, inches: 25.4, '"': 25.4, ft: 304.8, foot: 304.8, feet: 304.8, "'": 304.8};

interface Preset {label: string; height: number; width: number; depth?: number; plan?: Plan}
const TABLES: [RegExp, Preset][] = [
  [/\bcoffee\b/, {label: 'coffee table', height: 420, width: 900, depth: 560, plan: 'rect'}],
  [/\b(side|end|bedside|night ?stand|accent)\b/, {label: 'side table', height: 520, width: 460}],
  [/\bdining\b/, {label: 'dining table', height: 740, width: 1500, depth: 850, plan: 'rect'}],
  [/\b(desk|console|work ?bench)\b/, {label: 'desk', height: 740, width: 1200, depth: 600, plan: 'rect'}],
  [/\bstool\b/, {label: 'stool', height: 450, width: 340, plan: 'round'}],
  [/\bbench\b/, {label: 'bench', height: 440, width: 1100, depth: 340, plan: 'rect'}],
  [/\b(plant ?stand|pedestal|plinth)\b/, {label: 'plant stand', height: 600, width: 320}],
];

export function parsePrompt(raw: string): Brief {
  const s = ` ${raw.toLowerCase().replace(/[,;]/g, ' ')} `;
  const heard: string[] = [];
  const has = (re: RegExp) => re.test(s);

  let typology: Typology | null = null, label = '', unsupported: string | null = null;
  if (has(/\b(sphere|ball|orb|globe|ornament|bauble)s?\b/)) typology = 'sphere';
  else if (has(/\b(tower|column|pillar|spire|totem|pagoda|obelisk|lantern|skyscraper|ziggurat)s?\b/)) typology = 'tower';
  else if (has(/\b(table|desk|stool|bench|nightstand|console|pedestal|plinth|plant ?stand)s?\b/)) typology = 'table';
  if (!typology && has(/\b(shelf|shelves|bookcase|bookshelf|chair|lamp|box|bridge)\b/)) {
    unsupported = `${(s.match(/\b(shelf|shelves|bookcase|bookshelf|chair|lamp|box|bridge)\b/) ?? [''])[0]} is not a form this prototype generates yet. It makes tables, towers and spheres.`;
  }
  typology ??= 'table';

  const small = has(/\b(tiny|mini|miniature|small|little|desktop|tabletop)\b/), big = has(/\b(large|big|huge|giant|grand)\b/), tall = has(/\btall\b/), low = has(/\b(low|short|squat)\b/);
  let height = 0, width = 0, depth = 0;
  let plan: Plan | null = null;
  if (typology === 'table') {
    const hit = TABLES.find(([re]) => re.test(s));
    const p: Preset = hit ? hit[1] : {label: 'table', height: 480, width: 560};
    label = p.label; height = p.height; width = p.width; depth = p.depth ?? p.width; plan = p.plan ?? null;
    if (small) { height *= 0.75; width *= 0.7; depth *= 0.7; }
    if (big) { width *= 1.3; depth *= 1.3; }
    if (low) height *= 0.8;
    if (tall) height *= 1.25;
  } else if (typology === 'tower') {
    label = small ? 'small tower' : big || tall ? 'tall tower' : 'tower';
    height = small ? 300 : big || tall ? 900 : 480;
    width = height * 0.4;
  } else {
    label = small ? 'small sphere' : big ? 'large sphere' : 'sphere';
    width = depth = height = small ? 160 : big ? 420 : 260;
  }
  if (small || big || tall || low) heard.push([small && 'small', big && 'large', tall && 'tall', low && 'low'].filter(Boolean).join(', '));

  // Dimensions with units, optionally qualified: "40cm tall", "3 inch", "600 mm wide", "1.2m across".
  const dimRe = /(\d+(?:\.\d+)?)\s*(millimet(?:er|re)s?|centimet(?:er|re)s?|met(?:er|re)s?|mm|cm|inches|inch|in|feet|foot|ft|m|"|')(?![a-z])(\s*(?:tall|high|in height|height|wide|width|across|diameter|long|deep|thick))?/g;
  for (const m of s.matchAll(dimRe)) {
    const mm = parseFloat(m[1]) * (UNIT[m[2]] ?? 1), q = (m[3] ?? '').trim();
    if (/thick/.test(q) || (mm <= 25 && /\b(ply|plywood|mdf|acrylic|cardboard|board|sheet|material)\b/.test(s.slice(m.index!, m.index! + 40)))) { continue; }
    if (/tall|high|height/.test(q) || (!q && typology === 'tower')) { height = mm; if (typology === 'tower' && !/wide|width|across/.test(s)) width = mm * 0.4; heard.push(`${Math.round(mm)} mm tall`); }
    else if (/deep/.test(q)) { depth = mm; heard.push(`${Math.round(mm)} mm deep`); }
    else {
      const ratio = depth / Math.max(width, 1);
      width = mm;
      if (typology === 'sphere') height = depth = mm;
      else if (!/deep/.test(s)) depth = mm * ratio;
      heard.push(`${Math.round(mm)} mm ${typology === 'sphere' ? 'across' : 'wide'}`);
    }
  }

  let thickness: number | null = null;
  const th = s.match(/(\d+(?:\.\d+)?)\s*mm\s*(?:thick|ply|plywood|mdf|acrylic|cardboard|board|sheet|material)/) ?? s.match(/(?:thickness|thick)\s*(?:of\s*)?(\d+(?:\.\d+)?)\s*mm/);
  if (th) { thickness = parseFloat(th[1]); heard.push(`${thickness} mm sheet`); }
  else if (has(/\bcardboard\b/)) { thickness = 4; heard.push('cardboard, 4 mm'); }
  else if (has(/\bacrylic\b/)) { thickness = 3; heard.push('acrylic, 3 mm'); }

  const planWords: [RegExp, Plan][] = [[/\b(round|circular|circle|disc|disk|oval)\b/, 'round'], [/\b(hex|hexagon|hexagonal|six-sided)\b/, 'hex'], [/\b(triangle|triangular|three-sided)\b/, 'tri'], [/\b(square)\b/, 'square'], [/\b(rectangular|rectangle|oblong|long)\b/, 'rect']];
  for (const [re, p] of planWords) if (re.test(s)) { plan = p; heard.push(`${p} plan`); break; }

  let twist = 0;
  if (has(/\b(twist|twisted|twisting|spiral|helix|helical|turning|rotating)\b/)) {
    const d = s.match(/(\d+(?:\.\d+)?)\s*(?:deg|degrees|°)/);
    twist = d ? parseFloat(d[1]) : 20;
    heard.push(`twist ${twist}° per level`);
  }
  let taper: number | null = null;
  if (has(/\b(taper|tapered|tapering|pyramid|obelisk|spire|narrowing)\b/)) { taper = 0.45; heard.push('tapered'); }
  else if (has(/\b(straight|uniform|parallel)\b/)) { taper = 0; heard.push('straight sides'); }

  let count: number | null = null, levels: number | null = null;
  for (const m of s.matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)[\s-]*(legs?|fins?|blades?|walls?|sides?|discs?|disks?|meridians?|panels?|levels?|tiers?|floors?|stor(?:e)?ys?|stories|layers?|rings?)\b/g)) {
    const n = NUM[m[1]] ?? parseInt(m[1], 10);
    if (/level|tier|floor|stor|layer|ring/.test(m[2])) { levels = n; heard.push(`${n} levels`); }
    else { count = n; heard.push(`${n} ${m[2]}`); }
  }

  let windows: boolean | null = null;
  if (has(/\b(windows?|openings?|perforated|holes|lattice|cut-?outs?)\b/)) { windows = true; heard.push('windows'); }
  else if (has(/\b(solid|plain|closed)\b/)) { windows = false; heard.push('solid panels'); }

  let kitSides: number | null = null;
  const poly: [RegExp, number][] = [[/\b(triangles?|triangular)\b/, 3], [/\b(pentagons?|pentagonal)\b/, 5], [/\b(hexagons?|hexagonal|hex)\b/, 6], [/\b(octagons?|octagonal)\b/, 8], [/\b(decagons?|decagonal)\b/, 10]];
  for (const [re, n] of poly) if (re.test(s)) { kitSides = n; break; }

  let slit: SlitType | null = null;
  if (has(/\b(kit|pinwheel|identical|modules?|modular|interlocking)\b/)) { slit = 'kit'; if (kitSides) heard.push(`${kitSides}-sided pieces`); }
  else if (has(/\b(tabs?|mortise|tab and slot|tab-and-slot)\b/)) slit = 'tab';
  else if (has(/\b(radial|star|fins?|meridians?)\b/)) slit = 'radial';
  else if (has(/\b(corner|ring|crib|log ?cabin|edge)\b/)) slit = 'edge';
  else if (has(/\b(cross|egg ?-?crate|half-?lap|crossed|x-?base)\b/)) slit = 'cross';
  if (slit) heard.push(`${slit} slits`);

  return {prompt: raw, typology, label, height, width, depth: depth || width, plan, twist, taper, count, levels, thickness, windows, slit, kitSides, heard, unsupported};
}

/** Sheet thickness when the prompt does not give one. */
export function defaultThickness(b: Brief) {
  if (b.typology === 'table') return b.height >= 600 || b.width >= 900 ? 18 : 12;
  const m = Math.max(b.height, b.width);
  return m < 400 ? 4 : m < 800 ? 6 : 9;
}
