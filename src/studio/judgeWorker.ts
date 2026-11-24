import {judgeAt, type Judged} from './query.js';
import type {FunctionSpec} from './spec.js';

/** `rests`: each key's resting pose from the archive, when known (tried first). */
export interface JudgeRequest {keys: string[]; rests?: Record<string, number[]>; spec: FunctionSpec; diameter: number; stable: boolean; want: number}
export type JudgeMessage =
  | {type: 'item'; judged: Judged; tried: number}
  | {type: 'miss'; tried: number}
  | {type: 'done'; found: number; tried: number}
  | {type: 'error'; error: string};

/** Judges forms in the order given at the real kit, streaming each pass, until `want` pass or the list runs out. */
self.onmessage = (event: MessageEvent<JudgeRequest>) => {
  const {keys, rests, spec, diameter, stable, want} = event.data;
  const post = (m: JudgeMessage) => self.postMessage(m);
  try {
    let found = 0, tried = 0;
    for (const key of keys) {
      if (found >= want) break;
      const judged = judgeAt(key, spec, diameter, stable, rests?.[key]);
      tried++;
      if (judged.ok) { found++; post({type: 'item', judged, tried}); }
      else post({type: 'miss', tried});
    }
    post({type: 'done', found, tried});
  } catch (error) {
    post({type: 'error', error: error instanceof Error ? error.message : 'Judging failed.'});
  }
};
