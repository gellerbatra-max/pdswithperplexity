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

/** Enough to name what arrived, without putting a caller's payload in a string. */
const describeType = (message: unknown): string => {
  if (message === null || typeof message !== 'object') return typeof message;
  const type = (message as { type?: unknown }).type;
  return typeof type === 'string' ? type : 'untyped';
};

self.onmessage = (event: MessageEvent<NestWorkerRequest>) => {
  const message = event.data;
  if (message?.type !== 'NEST') {
    // Answer rather than ignore. The runner cannot tell "still searching" from
    // "will never reply", so silently dropping a message it does not
    // understand cost the caller the whole timeout before anything surfaced.
    post({
      type: 'ERROR',
      message: `Nest worker cannot handle a ${describeType(message)} message`,
    });
    return;
  }

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
