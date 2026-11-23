/**
 * Can one person build it? A build sequence (assembly.ts) only checks that each piece or group can slide into
 * place; it says nothing about whether what is already built stays put while the next piece goes in. This walks
 * the sequence and, after every step, judges the part built so far as it stands on the bench (as built, z up):
 *  - falls:  it does not stand on its own (no margin over the floor contacts);
 *  - loose:  gravity can pull a piece out of it (lattice.ts looseDiscs);
 *  - sags:   a slit joint can swing under its own weight (hinges.ts).
 * A step where any of these holds needs a hand: someone has to hold the part built so far until a later step
 * braces it. Groups built on the bench are judged once placed, as part of the whole.
 */
import {hingeModes} from '../hinges.js';
import {groundSupport} from '../stability.js';
import type {BuildStep} from './assembly.js';
import {Form, looseDiscs, type Kit} from './lattice.js';

export interface StepHold {
  /** Someone has to hold the part built so far after this step. */
  needs: boolean;
  falls: boolean;
  sags: boolean;
  /** Pieces (disc indices in the form) that can drop out. */
  loose: number[];
}

export function stepHolds(kit: Kit, form: Form, steps: BuildStep[]): StepHold[] {
  const panels = form.panels(kit), placed: number[] = [], out: StepHold[] = [];
  for (const s of steps) {
    placed.push(...s.group);
    const sub = new Form(placed.map(i => form.discs[i])), subPanels = placed.map(i => panels[i]);
    // One piece alone is held by hand by definition only if it cannot stand: a flat disc lies there fine.
    const sup = groundSupport(subPanels), falls = !(sup.margin > 0);
    const loose = looseDiscs(kit, sub, subPanels).map(j => placed[j]);
    const sags = placed.length > 1 && hingeModes(subPanels).sags;
    out.push({needs: falls || sags || loose.length > 0, falls, sags, loose});
  }
  return out;
}

/** Steps that need a hand, as a count, and whether one person can build it without help. */
export function holdSummary(holds: StepHold[]): {steps: number; total: number; alone: boolean} {
  const steps = holds.filter(h => h.needs).length;
  return {steps, total: holds.length, alone: steps === 0};
}
