/**
 * The message contract between the main thread and the DXF worker.
 *
 * Kept in its own module so neither side imports the other: the worker would
 * otherwise drag the importer's dependencies into the main bundle.
 */

import type { ImportedPiece } from './dxf/importDxf';

export interface DxfWorkerRequest {
  readonly type: 'PARSE_DXF';
  readonly dxfText: string;
  readonly rulText?: string;
}

export type DxfWorkerResponse =
  | { readonly type: 'PROGRESS'; readonly percent: number }
  | {
      readonly type: 'RESULT';
      readonly pieces: ImportedPiece[];
      readonly warnings: string[];
      readonly units: 'cm' | 'in';
    }
  | { readonly type: 'ERROR'; readonly message: string };
