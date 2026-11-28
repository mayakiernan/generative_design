// Types for model.mjs, copied from bottle-rulebook/stainless by sync-studio.mjs. Kept by hand here.
export type Params = Record<string, number | string>;
export interface Profile { z: number[]; r: number[]; form: string }
export type Measures = Record<string, number | null> & { mouth_family: string };
export interface Rule {
  id: string; tier: 'make' | 'standard' | 'tooling' | 'precedent' | 'use'; name: string; measure: string; op: '<=' | '>=' | 'between';
  limit: number | [number, number]; by_form?: Record<string, [number, number]>; scale: number; unit: string; confidence: string;
  source: string; plain: string; note: string; applies?: Record<string, string[]>; market?: string; default_on?: boolean;
}
export interface Rulebook { process: string; version: string; date: string; about: string; tiers: Record<string, string>; process_params: Record<string, {value: number; confidence: string; note: string}>; rules: Rule[] }
export interface RuleState { __market?: string; [id: string]: {on?: boolean; limit?: number | [number, number]} | string | undefined }
export interface RuleResult { rule: Rule; value: number; raw: number; ok: boolean }
export interface Evaluation { rules: RuleResult[]; fails: Record<'make' | 'standard' | 'tooling' | 'precedent' | 'use', string[]>; minNorm: number; canMake: boolean; feasible: boolean }
export const PARAMS: {name: string; kind: 'float' | 'choice'; lo?: number; hi?: number; choices?: string[]; unit?: string; label: string}[];
export const TYPICAL: Record<'single' | 'double', Params>;
export const STANDARD_MOUTHS: number[];
export const GROUPS: {id: string; label: string}[];
export const SHAPE_FRACS: number[];
export function buildProfile(p: Params): Profile;
export function sketchProfile(sig: number[], fracs: number[], H: number, form: string): Profile;
export function scaleProfile(prof: Profile, s: number): Profile;
export function formOf(prof: Profile): string;
export function interp(x: number, xs: number[], ys: number[]): number;
export function measure(prof: Profile, cfg: Params, proc: Record<string, number>): Measures;
export function evaluate(m: Measures, ctx: Params, book: Rulebook, state?: RuleState): Evaluation;
export function ctxOf(p: Params): Params;
export function features(prof: Profile, p: Params, m: Measures): [string, string, number][];
