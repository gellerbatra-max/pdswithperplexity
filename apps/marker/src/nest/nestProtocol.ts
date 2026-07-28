/**
 * The message contract between the main thread and the nest worker.
 *
 * Its own module so neither side imports the other, which would drag the
 * algorithms into the main bundle.
 *
 * The request carries a `NestRequest` and a mode rather than one engine's
 * private input shape, so adding an engine never touches this file.
 *
 * The result carries the winning engine and its score alongside the plan: a
 * best-of-both run picks an engine on the worker, and the main thread cannot
 * report what won unless it is told.
 */

import type { NestRequest } from './model';
import type { NestMode, ScoredRun } from './pipeline';

export interface NestWorkerRequest {
  readonly type: 'NEST';
  readonly request: NestRequest;
  readonly mode: NestMode;
}

export type NestWorkerResponse =
  | { readonly type: 'PROGRESS'; readonly percent: number }
  | { readonly type: 'RESULT'; readonly run: ScoredRun }
  | { readonly type: 'ERROR'; readonly message: string };
