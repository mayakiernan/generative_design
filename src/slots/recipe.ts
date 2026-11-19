/**
 * A gallery recipe: the settings the kit gallery grows designs from. Claude writes one from a plain-language brief
 * (scripts/kit-recipe.ts); the page can also be set by hand. Dependency-free so both the browser and the API
 * function can import it.
 */
export const KIT_IDS = ['circle', 'triangle', 'pentagon', 'hexagon', 'decagon'] as const;
/** Kits the page offers. The others stay in the engine but are hidden; recipes are held to these. */
export const VISIBLE_KITS = ['circle'] as const;
export const FORMS = ['any', 'tower', 'spread', 'compact', 'table', 'random'] as const;
export const BRANCHING = ['chain', 'mixed', 'bushy'] as const;
export const PIECES_BY_KIT = {
  circle: ['C1', 'C2L', 'C2I', 'C3T', 'H'],
  triangle: ['T1', 'T2', 'T3', 'TP'],
  pentagon: ['P5'],
  hexagon: ['P6'],
  decagon: ['P10'],
} as const;
export const PIECE_IDS = [...PIECES_BY_KIT.circle, ...PIECES_BY_KIT.triangle, 'P5', 'P6', 'P10'] as const;
export type PieceId = (typeof PIECE_IDS)[number];

export interface Recipe {
  kit: (typeof KIT_IDS)[number];
  form: (typeof FORMS)[number];
  pieces: number;
  pieceSizeMm: number;
  /** Random form: diameter of the circle on the floor the design must fit inside. */
  footprintMm: number;
  sheetMm: number;
  favour: PieceId[];
  avoid: PieceId[];
  branching: (typeof BRANCHING)[number];
  title: string;
  rationale: string;
}

export const LIMITS = {pieces: [4, 30], pieceSizeMm: [40, 600], sheetMm: [1, 20]} as const;
/** Random form's footprint circle, in piece sizes: its range and the page's starting value. */
export const FOOTPRINT_X = {min: 2, max: 8, start: 4} as const;
/** The smallest braced stacked-grid table has about ten pieces (three columns, two layers, their bridges). */
export const TABLE_MIN_PIECES = 10;
const clamp = (x: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo));

/** Keep a recipe inside what the generator supports: ranges, and piece ids that belong to the chosen kit. */
export function clampRecipe(recipe: Recipe): Recipe {
  const r = {...recipe, kit: (VISIBLE_KITS as readonly string[]).includes(recipe.kit) ? recipe.kit : VISIBLE_KITS[0]};
  const own = new Set<string>(PIECES_BY_KIT[r.kit] as readonly string[]);
  const avoid = r.avoid.filter(id => own.has(id));
  // Never avoid every piece that can grow: at least one piece with two or more slits must stay.
  const growers = (PIECES_BY_KIT[r.kit] as readonly string[]).filter(id => id !== 'C1' && id !== 'T1');
  const safeAvoid = growers.every(id => (avoid as string[]).includes(id)) ? avoid.filter(id => !growers.includes(id)) : avoid;
  const size = Math.round(clamp(r.pieceSizeMm, LIMITS.pieceSizeMm));
  return {
    ...r,
    pieces: Math.round(clamp(r.pieces, r.form === 'table' ? [TABLE_MIN_PIECES, LIMITS.pieces[1]] : LIMITS.pieces)),
    pieceSizeMm: size,
    footprintMm: Math.round(clamp(r.footprintMm ?? FOOTPRINT_X.start * size, [FOOTPRINT_X.min * size, FOOTPRINT_X.max * size])),
    sheetMm: Math.round(clamp(r.sheetMm, LIMITS.sheetMm) * 10) / 10,
    favour: r.favour.filter(id => own.has(id) && !safeAvoid.includes(id)),
    avoid: safeAvoid,
    title: r.title.slice(0, 60),
    rationale: r.rationale.slice(0, 600),
  };
}

/** Piece weights for growth: favoured pieces three times as likely, avoided ones never used. */
export function recipeWeights(r: Pick<Recipe, 'favour' | 'avoid'>): Record<string, number> {
  const w: Record<string, number> = {};
  for (const id of r.favour) w[id] = 3;
  for (const id of r.avoid) w[id] = 0;
  return w;
}
