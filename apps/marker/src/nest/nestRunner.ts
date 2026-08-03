import type { NestRequest } from './model';
import type { NestWorkerRequest, NestWorkerResponse } from './nestProtocol';
import type { NestMode, ScoredRun } from './pipeline';

/**
 * Main-thread orchestration for auto-nest.
 *
 * Same shape as the DXF importer: a worker per run, terminated on settle.
 * Nesting is a deliberate, occasional action, so startup cost is irrelevant
 * next to holding a worker and its obstacle set alive between runs.
 *
 * Named `runNestWorker`, not `runNest`: `pipeline.runNest` is the one that
 * actually nests. This only moves the work off the main thread.
 */

export interface NestRunOptions {
  readonly request: NestRequest;
  readonly mode: NestMode;
  readonly onProgress?: (percent: number) => void;
  readonly timeoutMs?: number;
}

/** Generous: a large order at effort 5 is a genuinely long search. */
const DEFAULT_TIMEOUT_MS = 300_000;

export class NestCancelled extends Error {
  constructor() {
    super('Auto-nest cancelled');
    this.name = 'NestCancelled';
  }
}

export interface NestRun {
  readonly result: Promise<ScoredRun>;
  /** Stop a run that is taking longer than the user is willing to wait. */
  readonly cancel: () => void;
}

export const runNestWorker = (options: NestRunOptions): NestRun => {
  const worker = new Worker(new URL('./workers/nestWorker.ts', import.meta.url), {
    type: 'module',
  });

  let settled = false;
  let finish: (action: () => void) => void = () => undefined;
  let rejectRun: (error: Error) => void = () => undefined;

  const result = new Promise<ScoredRun>((resolve, reject) => {
    rejectRun = reject;
    finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      action();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error('Auto-nest timed out')));
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<NestWorkerResponse>) => {
      const message = event.data;
      if (message.type === 'PROGRESS') {
        options.onProgress?.(message.percent);
        return;
      }
      if (message.type === 'RESULT') {
        finish(() => resolve(message.run));
        return;
      }
      finish(() => reject(new Error(message.message)));
    };

    worker.onerror = (event) => {
      finish(() => reject(new Error(event.message || 'Nest worker failed to start')));
    };

    // A reply that cannot be deserialised arrives here rather than at
    // `onmessage`. Without this the run has been answered and nobody heard it,
    // and the caller waits out the full timeout for a worker that is done.
    worker.onmessageerror = () => {
      finish(() => reject(new Error('Auto-nest sent a reply that could not be read')));
    };

    const message: NestWorkerRequest = {
      type: 'NEST',
      request: options.request,
      mode: options.mode,
    };
    try {
      worker.postMessage(message);
    } catch (error) {
      // A request that will not structured-clone throws synchronously. Route
      // it through `finish` so the worker is terminated: throwing straight out
      // of the executor rejects the promise but leaves the worker running with
      // nothing listening to it.
      finish(() =>
        reject(error instanceof Error ? error : new Error('Auto-nest could not start')),
      );
    }
  });

  return {
    result,
    // Rejects rather than resolving: a promise left unsettled would leak the
    // caller's await forever.
    cancel: () => finish(() => rejectRun(new NestCancelled())),
  };
};
