/// <reference lib="webworker" />

/**
 * Auto-nest, off the main thread.
 *
 * The search is a grid scan per piece per rotation against every obstacle
 * already down — seconds of solid CPU on a real order. On the main thread that
 * is a frozen window with a progress bar that cannot paint.
 */

import { nest } from '../heuristic';
import type { NestWorkerRequest, NestWorkerResponse } from '../nestProtocol';

const post = (message: NestWorkerResponse): void => {
  self.postMessage(message);
};

self.onmessage = (event: MessageEvent<NestWorkerRequest>) => {
  const request = event.data;
  if (request.type !== 'NEST') return;

  try {
    // Progress ticks once per piece placed, which is the only boundary the
    // algorithm actually has — reporting anything finer would be invented.
    const result = nest(request.input, (percent) => post({ type: 'PROGRESS', percent }));
    post({ type: 'RESULT', result });
  } catch (error) {
    post({
      type: 'ERROR',
      message: error instanceof Error ? error.message : 'Unknown error while nesting',
    });
  }
};
