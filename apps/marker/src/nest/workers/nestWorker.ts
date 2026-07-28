/// <reference lib="webworker" />

/**
 * Auto-nest, off the main thread.
 *
 * The search is a grid scan per piece per rotation against every obstacle
 * already down — seconds of solid CPU on a real order. On the main thread that
 * is a frozen window with a progress bar that cannot paint.
 *
 * The worker picks no engine of its own: it forwards whatever the caller asked
 * for to the pipeline, so the two sides cannot drift.
 */

import type { NestWorkerRequest, NestWorkerResponse } from '../nestProtocol';
import { runMode } from '../pipeline';

const post = (message: NestWorkerResponse): void => {
  self.postMessage(message);
};

self.onmessage = (event: MessageEvent<NestWorkerRequest>) => {
  const message = event.data;
  if (message.type !== 'NEST') return;

  try {
    // Progress ticks once per piece placed, which is the only boundary either
    // algorithm actually has — anything finer would be invented.
    const run = runMode(message.request, message.mode, (percent) =>
      post({ type: 'PROGRESS', percent }),
    );
    post({ type: 'RESULT', run });
  } catch (error) {
    post({
      type: 'ERROR',
      message: error instanceof Error ? error.message : 'Unknown error while nesting',
    });
  }
};
