import {generate, type Options} from './engine';
import {parsePrompt} from './prompt';

/** Runs the candidate search off the UI thread. */
self.onmessage = (event: MessageEvent<Options & {prompt: string}>) => {
  try {
    self.postMessage({ok: true, result: generate(parsePrompt(event.data.prompt), event.data)});
  } catch (error) {
    self.postMessage({ok: false, error: error instanceof Error ? error.message : 'Generation failed.'});
  }
};
