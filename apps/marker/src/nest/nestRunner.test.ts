/**
 * The main-thread half of the nest protocol.
 *
 * `runNestWorker` is orchestration, not algorithm: it owns the settle-once
 * rule, the timeout, cancellation and worker teardown. A stub `Worker` lets
 * every one of those be driven directly, which a real worker cannot — a real
 * one would make the timeout test take five minutes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Point } from '@/marker/schema';
import { NO_SPACING, type NestPiece, type NestRequest } from './model';
import type { NestWorkerRequest, NestWorkerResponse } from './nestProtocol';
import { runScored, type ScoredRun } from './pipeline';
import { NestCancelled, runNestWorker } from './nestRunner';

const rect = (width: number, height: number): Point[] => [
  { x: 0, y: 0 },
  { x: width, y: 0 },
  { x: width, y: height },
  { x: 0, y: height },
];

const piece = (id: string, width: number, height: number): NestPiece => ({
  id,
  geometry: rect(width, height),
  rotation: 'half-turn',
  quantity: 1,
});

const request = (): NestRequest => ({
  sheet: { width: 100 },
  pieces: [piece('a', 20, 30)],
  spacing: NO_SPACING,
  obstacles: [],
  spliceLines: [],
  effort: 1,
});

/** A genuine run, so what crosses the boundary is the real result shape. */
const scoredRun = (): ScoredRun => runScored(request(), 'shelf');

class FakeWorker {
  static live: FakeWorker[] = [];

  onmessage: ((event: { data: NestWorkerResponse }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;

  readonly posted: NestWorkerRequest[] = [];
  terminations = 0;
  /** Set to make `postMessage` throw, as a non-cloneable request would. */
  postThrows: Error | null = null;

  constructor(
    readonly url: URL | string,
    readonly options?: { type?: string },
  ) {
    FakeWorker.live.push(this);
  }

  postMessage(message: NestWorkerRequest): void {
    if (this.postThrows) throw this.postThrows;
    this.posted.push(message);
  }

  terminate(): void {
    this.terminations += 1;
  }
}

/** The worker the run under test created. */
const spawned = (): FakeWorker => {
  const worker = FakeWorker.live.at(-1);
  if (!worker) throw new Error('no worker was created');
  return worker;
};

const start = (over: Partial<Parameters<typeof runNestWorker>[0]> = {}) =>
  runNestWorker({ request: request(), mode: 'heuristic', ...over });

beforeEach(() => {
  FakeWorker.live = [];
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('starting a run', () => {
  it('spawns one module worker and sends one NEST message', () => {
    const run = start({ mode: 'best' });

    expect(FakeWorker.live).toHaveLength(1);
    expect(spawned().options?.type).toBe('module');
    expect(spawned().posted).toEqual([
      { type: 'NEST', request: request(), mode: 'best' },
    ]);

    run.cancel();
    return expect(run.result).rejects.toBeInstanceOf(NestCancelled);
  });

  it('terminates the worker when the request cannot be sent', async () => {
    // A request that will not structured-clone throws out of `postMessage`.
    // The promise has to reject *and* the worker has to be torn down —
    // rejecting alone leaves it running with nobody listening.
    const failure = new Error('could not be cloned');
    FakeWorker.live = [];
    vi.stubGlobal(
      'Worker',
      class extends FakeWorker {
        constructor(url: URL | string, options?: { type?: string }) {
          super(url, options);
          this.postThrows = failure;
        }
      },
    );

    const run = start();
    await expect(run.result).rejects.toThrow('could not be cloned');
    expect(spawned().terminations).toBe(1);
  });
});

describe('a run that finishes', () => {
  it('resolves with the run the worker sent back', async () => {
    const expected = scoredRun();
    const run = start();

    spawned().onmessage?.({ data: { type: 'RESULT', run: expected } });

    await expect(run.result).resolves.toEqual(expected);
    expect(spawned().terminations).toBe(1);
  });

  it('forwards progress without settling the run', async () => {
    const seen: number[] = [];
    const run = start({ onProgress: (percent) => seen.push(percent) });

    spawned().onmessage?.({ data: { type: 'PROGRESS', percent: 25 } });
    spawned().onmessage?.({ data: { type: 'PROGRESS', percent: 80 } });
    expect(seen).toEqual([25, 80]);
    expect(spawned().terminations).toBe(0);

    const expected = scoredRun();
    spawned().onmessage?.({ data: { type: 'RESULT', run: expected } });
    await expect(run.result).resolves.toEqual(expected);
  });

  it('survives a run with no progress listener', async () => {
    const run = start();
    expect(() => spawned().onmessage?.({ data: { type: 'PROGRESS', percent: 50 } })).not.toThrow();

    spawned().onmessage?.({ data: { type: 'RESULT', run: scoredRun() } });
    await expect(run.result).resolves.toBeDefined();
  });

  it('stops the timeout once it has an answer', async () => {
    vi.useFakeTimers();
    const run = start({ timeoutMs: 1000 });

    spawned().onmessage?.({ data: { type: 'RESULT', run: scoredRun() } });
    await expect(run.result).resolves.toBeDefined();

    // Long past the deadline, and the settled result still stands.
    await vi.advanceTimersByTimeAsync(5000);
    await expect(run.result).resolves.toBeDefined();
    expect(spawned().terminations).toBe(1);
  });
});

describe('a run that fails', () => {
  it('rejects with the message the worker reported', async () => {
    const run = start();
    spawned().onmessage?.({ data: { type: 'ERROR', message: 'nothing fits' } });

    await expect(run.result).rejects.toThrow('nothing fits');
    expect(spawned().terminations).toBe(1);
  });

  it('rejects when the worker itself errors', async () => {
    const run = start();
    spawned().onerror?.({ message: 'worker blew up' });

    await expect(run.result).rejects.toThrow('worker blew up');
    expect(spawned().terminations).toBe(1);
  });

  it('names the failure when the worker errors with no message', async () => {
    const run = start();
    spawned().onerror?.({ message: '' });

    await expect(run.result).rejects.toThrow('Nest worker failed to start');
  });

  it('rejects on a reply it cannot deserialise', async () => {
    // Without this the run has been answered and nobody heard it, and the
    // caller waits out the whole timeout for a worker that is already done.
    const run = start();
    spawned().onmessageerror?.();

    await expect(run.result).rejects.toThrow('could not be read');
    expect(spawned().terminations).toBe(1);
  });
});

describe('the timeout', () => {
  it('rejects once the deadline passes, and terminates the worker', async () => {
    vi.useFakeTimers();
    const run = start({ timeoutMs: 1000 });
    const rejects = expect(run.result).rejects.toThrow('Auto-nest timed out');

    await vi.advanceTimersByTimeAsync(1000);
    await rejects;
    expect(spawned().terminations).toBe(1);
  });

  it('waits the full 300 seconds by default', async () => {
    vi.useFakeTimers();
    const run = start();
    let settled = false;
    const rejects = run.result.catch(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(299_999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await rejects;
    expect(settled).toBe(true);
  });

  it('ignores a result that arrives after the deadline', async () => {
    vi.useFakeTimers();
    const run = start({ timeoutMs: 1000 });
    const rejects = expect(run.result).rejects.toThrow('Auto-nest timed out');

    await vi.advanceTimersByTimeAsync(1000);
    spawned().onmessage?.({ data: { type: 'RESULT', run: scoredRun() } });

    await rejects;
    expect(spawned().terminations).toBe(1);
  });
});

describe('cancelling', () => {
  it('rejects with NestCancelled rather than leaving the caller waiting', async () => {
    const run = start();
    run.cancel();

    await expect(run.result).rejects.toBeInstanceOf(NestCancelled);
    await expect(run.result).rejects.toThrow('Auto-nest cancelled');
    expect(spawned().terminations).toBe(1);
  });

  it('terminates the worker so an abandoned run stops burning CPU', async () => {
    const run = start();
    const rejects = expect(run.result).rejects.toBeInstanceOf(NestCancelled);

    run.cancel();
    expect(spawned().terminations).toBe(1);
    await rejects;
  });

  it('is idempotent — cancelling twice terminates once', async () => {
    const run = start();
    const rejects = expect(run.result).rejects.toBeInstanceOf(NestCancelled);

    run.cancel();
    run.cancel();
    run.cancel();

    expect(spawned().terminations).toBe(1);
    await rejects;
  });

  it('cannot take back a result that already arrived', async () => {
    const expected = scoredRun();
    const run = start();
    spawned().onmessage?.({ data: { type: 'RESULT', run: expected } });

    run.cancel();

    await expect(run.result).resolves.toEqual(expected);
    expect(spawned().terminations).toBe(1);
  });

  it('ignores a result that arrives after the cancel', async () => {
    const run = start();
    const rejects = expect(run.result).rejects.toBeInstanceOf(NestCancelled);

    run.cancel();
    spawned().onmessage?.({ data: { type: 'RESULT', run: scoredRun() } });

    await rejects;
    expect(spawned().terminations).toBe(1);
  });

  it('stops the timeout, so a cancelled run never times out as well', async () => {
    vi.useFakeTimers();
    const run = start({ timeoutMs: 1000 });
    const rejects = expect(run.result).rejects.toBeInstanceOf(NestCancelled);

    run.cancel();
    await vi.advanceTimersByTimeAsync(5000);

    await rejects;
    expect(spawned().terminations).toBe(1);
  });
});
