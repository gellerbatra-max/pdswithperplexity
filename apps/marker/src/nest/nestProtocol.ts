/**
 * The message contract between the main thread and the nest worker.
 *
 * Its own module so neither side imports the other, which would drag the
 * algorithm into the main bundle.
 */

import type { NestInput, NestResult } from './heuristic';

export interface NestWorkerRequest {
  readonly type: 'NEST';
  readonly input: NestInput;
}

export type NestWorkerResponse =
  | { readonly type: 'PROGRESS'; readonly percent: number }
  | { readonly type: 'RESULT'; readonly result: NestResult }
  | { readonly type: 'ERROR'; readonly message: string };
