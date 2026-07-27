/// <reference lib="webworker" />

/**
 * DXF parsing, off the main thread.
 *
 * Factory DXF files run past 50 MB. Parsing one on the main thread freezes the
 * UI for seconds, so the whole pipeline runs here and reports progress as it
 * goes. All the real work is in io/dxf/, which stays pure and testable — this
 * file is only the message boundary.
 */

import { importDxf } from '../dxf/importDxf';
import type { DxfWorkerRequest, DxfWorkerResponse } from '../dxfProtocol';

const post = (message: DxfWorkerResponse): void => {
  self.postMessage(message);
};

self.onmessage = (event: MessageEvent<DxfWorkerRequest>) => {
  const request = event.data;
  if (request.type !== 'PARSE_DXF') return;

  try {
    // The pipeline is synchronous, so progress marks stage boundaries rather
    // than streaming. Honest about what it knows: the file is in, then parsed.
    post({ type: 'PROGRESS', percent: 10 });

    const result = importDxf(request.dxfText, request.rulText);

    post({ type: 'PROGRESS', percent: 90 });
    post({
      type: 'RESULT',
      pieces: result.pieces,
      warnings: result.warnings,
      units: result.units,
    });
  } catch (error) {
    post({
      type: 'ERROR',
      message: error instanceof Error ? error.message : 'Unknown error while parsing DXF',
    });
  }
};
