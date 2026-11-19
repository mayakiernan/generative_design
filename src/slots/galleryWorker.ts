import {gallery, type GalleryOptions} from './gallery';

/** Streams verified designs to the page as they are found. */
self.onmessage = (event: MessageEvent<GalleryOptions>) => {
  try {
    let found = 0;
    for (const x of gallery(event.data)) {
      if ('design' in x) { found++; self.postMessage({type: 'item', item: x}); }
      else self.postMessage({type: 'done', found, tried: x.tried, failed: x.failed});
    }
  } catch (error) {
    self.postMessage({type: 'error', error: error instanceof Error ? error.message : 'Generation failed.'});
  }
};
