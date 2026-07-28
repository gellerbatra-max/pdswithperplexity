/**
 * The message contract between the main thread and the nest worker.
 *
 * Its own module so neither side imports the other, which would drag the
 * algorithms into the main bundle.
 *
 * The request carries a `NestRequest` and an engine name rather than one
 * engine's private input shape, so adding an engine never touches this file.
 */

import type { NestPlan, NestRequest } from './model';
import type { NestEngine } from './pipeline';

export interface NestWorkerRequest {
  readonly type: 'NEST';
  readonly request: NestRequest;
  readonly engine: NestEngine;
}

export type NestWorkerResponse =
  | { readonly type: 'PROGRESS'; readonly percent: number }
  | { readonly type: 'RESULT'; readonly plan: NestPlan }
  | { readonly type: 'ERROR'; readonly message: string };
