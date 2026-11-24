/**
 * Form counts from the atlas run Slot Studio is pinned to (query.ts STUDIO_RUN): only its counting fields are
 * bundled, not its forms. The path must be written out (an import cannot use a constant), so it is checked against
 * STUDIO_RUN and gives no rows if the two disagree.
 */
import {levels as RUN_LEVELS, params as RUN_PARAMS} from '../../atlas-runs/2026-11-22T20-24-38-no-notched/atlas.json';
import {ENUMERATE_CAP} from '../slots/atlas/explore';
import {formCounts, type CountRow} from './counts';
import {STUDIO_RUN} from './query';

export type Level = {n: number; forms: number};
const PINNED = '2026-11-22T20-24-38-no-notched' === STUDIO_RUN;

export const pinnedLevels: Level[] = PINNED ? RUN_LEVELS : [];

/** Rows from 2 to 30 pieces, exact where counted; [] if the import and STUDIO_RUN disagree. */
export function pinnedCounts(): CountRow[] {
  if (pinnedLevels.length < 3) return [];
  const counted = Math.max(...pinnedLevels.map(l => l.n));
  // The run stopped counting before countTo: the next level passed the cap, so it holds more than that.
  const atLeast = RUN_PARAMS.countTo > counted ? {n: counted + 1, forms: ENUMERATE_CAP} : undefined;
  return formCounts(pinnedLevels, 2, 30, atLeast);
}
