// Loading the stainless dataset and market references, and the records the page shows: dataset
// designs, designs fitted to a sketch, the sketch itself and market products all become a Rec.
import * as S from './vendor/model.mjs';
import * as F from './vendor/fit.mjs';
import type {Params, Profile, Measures, Rulebook, RuleState, Evaluation} from './vendor/model.mjs';
import type {MarketRecord} from './vendor/fit.mjs';
import marketJson from './vendor/market.json';

export interface Dataset {
  meta: {total: number; counts: Record<string, number>};
  rulebook: Rulebook;
  params: {name: string}[];
  measures: string[];
  designs: {id: string[]; source: string[]; parent: string[]; p: (number | string)[][]; m: (number | null)[][]; family: string[]};
}

export type Kind = 'design' | 'fit' | 'sketch' | 'market';
export interface Rec {
  key: string; kind: Kind; label: string; sub: string;
  p: Params; prof: Profile; m: Measures; ev?: Evaluation; sig?: number[];
  index?: number; market?: MarketRecord; g?: number; parent?: string;
}

export async function loadDataset(): Promise<Dataset> {
  const mod = await import('./vendor/stainless-v0.json');
  return (mod.default ?? mod) as unknown as Dataset;
}

export const market = marketJson as unknown as {about: string; products: F.MarketProduct[]};

export function paramsOf(D: Dataset, i: number): Params {
  const o: Params = {};
  D.params.forEach((q, k) => { o[q.name] = D.designs.p[i][k]; });
  return o;
}
export function measuresOf(D: Dataset, i: number): Measures {
  const o = {} as Measures;
  D.measures.forEach((n, k) => { (o as Record<string, number | null>)[n] = D.designs.m[i][k]; });
  o.mouth_family = D.designs.family[i];
  return o;
}
export function designRec(D: Dataset, i: number): Rec {
  const p = paramsOf(D, i);
  return {key: D.designs.id[i], kind: 'design', label: D.designs.id[i], sub: describe(p), p, prof: S.buildProfile(p), m: measuresOf(D, i), index: i};
}

export function describe(p: Params): string {
  return (p.wall === 'double' ? 'Double wall ' : 'Single wall ') + (p.form === 'tumbler' ? 'tumbler' : 'bottle') + (p.route === 'drawn' ? ', drawn' : '');
}

export const FAMILY: Record<string, string> = {narrow: 'Narrow mouth', wide: 'Wide mouth', off: 'Non-standard mouth', rim: 'Tumbler rim', 'rim-off': 'Non-standard rim'};

export function fmt(v: number | null | undefined, unit = ''): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  const a = Math.abs(v);
  const s = Number.isInteger(v) ? String(v) : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(3);
  return unit ? s + ' ' + unit : s;
}

// A rule's plain sentence with its value filled in.
export function plain(rule: S.Rule, value: number): string {
  const v = rule.measure === 'bulge_expansion' ? Math.round(value * 100) + '%'
    : rule.measure === 'heat_margin_c' ? fmt(-value, '°C')
    : rule.unit === '°' ? value.toFixed(1) + '°' : fmt(value, rule.unit);
  return rule.plain.replace('{v}', v);
}

export const TIER_ORDER: ('make' | 'standard' | 'tooling' | 'precedent' | 'use')[] = ['make', 'standard', 'use', 'tooling', 'precedent'];

export function marketRecs(book: Rulebook): Rec[] {
  return F.marketRecords(market, book).filter(r => r.sig).map((r, i) => ({
    key: 'mk-' + i, kind: 'market' as const, label: r.brand + ' ' + r.name, sub: (r.wall === 'double' ? 'Double wall' : 'Single wall') + ' · ' + Math.round(r.capacity_ml) + ' mL',
    p: r.cfg, prof: r.prof, m: r.m, sig: r.sig ?? undefined, market: r,
  }));
}

export function evaluateRec(rec: Rec, book: Rulebook, state: RuleState): Evaluation {
  return S.evaluate(rec.m, S.ctxOf(rec.p), book, state);
}
