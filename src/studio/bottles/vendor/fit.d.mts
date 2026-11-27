// Types for fit.mjs, copied from bottle-rulebook/stainless by sync-studio.mjs. Kept by hand here.
import type {Params, Profile, Measures, Rulebook, RuleState, Evaluation} from './model.mjs';
export interface Point { x: number; y: number }
export interface Read { r: number[]; twoSided: boolean; top: number; bot: number; center: number }
export interface Judged { cfg: Params; prof: Profile; m: Measures; ev: Evaluation }
export interface PoolDesign { id: string; p: Params; m: Measures; family: string; sig: number[] }
export interface Pick { p: Params; m: Measures; ev: Evaluation; sig: number[]; g: number; minNorm: number; fitted: boolean; parent: string; family: string }
export interface MarketProduct { brand: string; name: string; capacity_ml: number; wall: string; url: string; image: string | null; form?: string | null; sig?: number[] | null; height_mm?: number; diameter_mm?: number; mouth_mm?: number; mass_g?: number }
export interface MarketRecord extends MarketProduct { sig: number[] | null; form: string; cfg: Params; prof: Profile; m: Measures; source: 'photo' | 'dimensions' }
export const K: number;
export const FRACS: number[];
export const CANVAS: {w: number; h: number; axis: number};
export const EXAMPLES: Record<string, {label: string; pts: number[][]}>;
export function silhouette(strokes: Point[][], axisX?: number): Read | null;
export function traceImage(px: Uint8ClampedArray, W: number, H: number): Point[][] | null;
export function signature(prof: Profile): number[];
export function gap(a: number[], b: number[]): number;
export function procOf(book: Rulebook): Record<string, number>;
export function scaleToCapacity(sig: number[], form: string, cfg: Params, targetMl: number, proc: Record<string, number>): {prof: Profile; m: Measures; scale: number};
export function judgeSketch(sig: number[], o: {capacity: number; book: Rulebook; state: RuleState}): {form: string; single: Judged; double: Judged};
export function findDesigns(sk: number[], o: {pool: PoolDesign[]; book: Rulebook; state: RuleState; cap?: number; capTol?: number; k?: number; seed?: number}): {picks: Pick[]; seeds: number; pool: number};
export function marketRecords(market: {products: MarketProduct[]}, book: Rulebook): MarketRecord[];
export function marketMatches(sk: number[], records: MarketRecord[], k?: number, form?: string): {p: MarketRecord; g: number}[];
export function exampleStrokes(name: string): Point[][];
