import {PHYSICAL} from '../engine/physical';

/** Physical dimensions for variable-angle hubs, in millimeters. */
export interface HubParams {
  /** Uncut stick length. */
  stickLength: number;
  /** Bore diameter. 2.1 matches the user's 18-hole test connector. */
  boreDiameter: number;
  /** Sleeve wall around each bore. */
  wall: number;
  /** How far a stick goes into its sleeve. */
  insertion: number;
  /** Smallest distance from hub center to a bore's stop. */
  minStop: number;
  /** Largest distance from hub center to a bore's stop; caps hub size. */
  maxStop: number;
  /** Spans this far outside what the hub can absorb still count as a fit: the stick seats a little shallower or the frame flexes. */
  tolerance: number;
  /** Circle resolution for printed geometry. */
  segments: number;
}

export const DEFAULT_HUB: HubParams = {
  stickLength: PHYSICAL.rodLength,
  boreDiameter: 2.1,
  wall: 0.9,
  insertion: PHYSICAL.insertionDepth,
  minStop: 2.5,
  maxStop: 12,
  tolerance: 1,
  segments: 24,
};

/**
 * Smallest stop distance for a bore whose nearest neighbouring bore is `theta` radians away.
 * Two bores at the same depth s keep a wall between them when s·sin(θ/2) ≥ r_bore + wall/2.
 */
export function stopFloor(theta: number, p: HubParams = DEFAULT_HUB) {
  const need = p.boreDiameter / 2 + p.wall / 2;
  return Math.max(p.minStop, theta >= Math.PI ? 0 : need / Math.sin(theta / 2));
}

/** Hub-center spacings one uncut stick can span, for bores with no tight neighbours. */
export function band(p: HubParams = DEFAULT_HUB) {
  const lo = p.stickLength + 2 * p.minStop, hi = p.stickLength + 2 * p.maxStop;
  return {lo, hi, target: (lo + hi) / 2};
}

/** Smallest angle between two sticks at one hub that the hub can still hold. */
export function minAngle(p: HubParams = DEFAULT_HUB) {
  return 2 * Math.asin((p.boreDiameter / 2 + p.wall / 2) / p.maxStop);
}
