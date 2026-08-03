/**
 * The worker half of the nest protocol.
 *
 * No DOM and no real worker: the module installs a handler on `self` and talks
 * back through `self.postMessage`, so a stub for both is the whole harness.
 * That keeps `nest/` unit-testable without a DOM, which is what the vitest
 * config asks for.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Point } from '@/marker/schema';
import { NO_SPACING, type NestPiece, type NestRequest } from '../model';
import type { NestWorkerRequest, NestWorkerResponse } from '../nestProtocol';

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

const request = (over: Partial<NestRequest> = {}): NestRequest => ({
  sheet: { width: 100 },
  pieces: [piece('a', 20, 30), piece('b', 25, 25)],
  spacing: NO_SPACING,
  obstacles: [],
  spliceLines: [],
  effort: 1,
  ...over,
});

let posted: NestWorkerResponse[] = [];
let deliver: (data: unknown) => void;

beforeAll(async () => {
  const stub = {
    postMessage: (message: NestWorkerResponse) => {
      posted.push(message);
    },
    onmessage: null as ((event: { data: unknown }) => void) | null,
  };
  vi.stubGlobal('self', stub);

  // Imported after the stub is in place: the module installs its handler at
  // import time, so a static import would run before `self` exists.
  await import('./nestWorker');

  if (!stub.onmessage) throw new Error('nestWorker did not install a handler on self');
  const handler = stub.onmessage;
  deliver = (data: unknown) => handler({ data });
});

beforeEach(() => {
  posted = [];
});

const nestMessage = (over: Partial<NestWorkerRequest> = {}): NestWorkerRequest => ({
  type: 'NEST',
  request: request(),
  mode: 'heuristic',
  ...over,
});

describe('a NEST message', () => {
  it('answers with a RESULT carrying the engine, plan and score', () => {
    deliver(nestMessage());

    const result = posted.at(-1);
    expect(result?.type).toBe('RESULT');
    if (result?.type !== 'RESULT') throw new Error('expected a RESULT');
    // The whole ScoredRun shape crosses the boundary, not just the plan: a
    // best-of-both run picks its engine here, and the main thread cannot
    // report what won unless it is told.
    expect(result.run.engine).toBe('heuristic');
    expect(result.run.plan.placements).toHaveLength(2);
    expect(result.run.plan.sheet).toEqual({ width: 100 });
    expect(result.run.score.stability).toBe(1);
    expect(result.run.score.placementCount).toBe(2);
  });

  it('reports progress before the result, once per piece', () => {
    deliver(nestMessage());

    const progress = posted.filter((message) => message.type === 'PROGRESS');
    expect(progress).toHaveLength(2);
    expect(progress.map((message) => (message.type === 'PROGRESS' ? message.percent : -1))).toEqual([
      50, 100,
    ]);
    // Every progress tick lands before the single terminal message.
    expect(posted.slice(0, -1).every((message) => message.type === 'PROGRESS')).toBe(true);
    expect(posted.filter((message) => message.type === 'RESULT')).toHaveLength(1);
  });

  it('runs whichever mode it was handed, and picks none of its own', () => {
    deliver(nestMessage({ mode: 'shelf' }));
    const shelf = posted.at(-1);
    expect(shelf?.type === 'RESULT' && shelf.run.engine).toBe('shelf');

    posted = [];
    deliver(nestMessage({ mode: 'best' }));
    const best = posted.at(-1);
    // `best` runs both and reports the winner, so progress spans one 0-100.
    expect(best?.type).toBe('RESULT');
    expect(posted.filter((message) => message.type === 'RESULT')).toHaveLength(1);
  });

  it('is deterministic — the same message twice gives the same answer', () => {
    deliver(nestMessage());
    const first = posted.at(-1);
    posted = [];
    deliver(nestMessage());
    const second = posted.at(-1);

    if (first?.type !== 'RESULT' || second?.type !== 'RESULT') {
      throw new Error('expected two RESULTs');
    }
    expect(second.run.plan).toEqual(first.run.plan);
    // Runtime is measured, so it is the one field allowed to differ.
    expect({ ...second.run.score, runtimeMs: 0 }).toEqual({ ...first.run.score, runtimeMs: 0 });
  });

  it('turns a failure into an ERROR rather than throwing into the worker', () => {
    // A mode the pipeline does not know: malformed, but well-typed enough to
    // get past the type gate, which is exactly the case worth covering.
    expect(() => deliver(nestMessage({ mode: 'sideways' as never }))).not.toThrow();

    const last = posted.at(-1);
    expect(last?.type).toBe('ERROR');
    expect(last?.type === 'ERROR' && last.message.length).toBeGreaterThan(0);
  });
});

describe('a message it cannot handle', () => {
  it('answers with an ERROR instead of going quiet', () => {
    // Silence is indistinguishable from a long search, so the runner would
    // wait out its whole timeout for a worker that had already given up.
    deliver({ type: 'SOMETHING_ELSE' });

    expect(posted).toHaveLength(1);
    expect(posted[0]?.type).toBe('ERROR');
    expect(posted[0]?.type === 'ERROR' && posted[0].message).toContain('SOMETHING_ELSE');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'NEST'],
    ['a number', 7],
    ['an object with no type', { request: null }],
  ])('answers rather than throwing on %s', (_label, data) => {
    expect(() => deliver(data)).not.toThrow();
    expect(posted).toHaveLength(1);
    expect(posted[0]?.type).toBe('ERROR');
  });

  it('names what arrived without echoing the payload back', () => {
    deliver({ type: 'NEST_PLEASE', secret: 'customer-order-4471' });

    const error = posted[0];
    if (error?.type !== 'ERROR') throw new Error('expected an ERROR');
    expect(error.message).toContain('NEST_PLEASE');
    expect(error.message).not.toContain('customer-order-4471');
  });
});
