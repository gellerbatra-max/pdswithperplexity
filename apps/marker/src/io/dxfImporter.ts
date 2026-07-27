import type { ImportedPiece } from './dxf/importDxf';
import type { DxfWorkerRequest, DxfWorkerResponse } from './dxfProtocol';

/**
 * Main-thread orchestration for DXF import.
 *
 * Owns the worker's lifetime and turns its message stream into a promise. The
 * worker is spawned per import and terminated on settle: an import is a rare,
 * bursty operation, and a resident worker holding a 50 MB string alive is a
 * worse trade than a few milliseconds of startup.
 */

export interface DxfImportOptions {
  readonly dxfText: string;
  readonly rulText?: string;
  readonly onProgress?: (percent: number) => void;
  /** Guards against a malformed file wedging the worker. */
  readonly timeoutMs?: number;
}

export interface DxfImportOutcome {
  readonly pieces: ImportedPiece[];
  readonly warnings: string[];
  readonly units: 'cm' | 'in';
}

const DEFAULT_TIMEOUT_MS = 120_000;

export const importDxfFile = (options: DxfImportOptions): Promise<DxfImportOutcome> =>
  new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./workers/dxfWorker.ts', import.meta.url), {
      type: 'module',
    });

    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      action();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error('DXF import timed out')));
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<DxfWorkerResponse>) => {
      const message = event.data;
      if (message.type === 'PROGRESS') {
        options.onProgress?.(message.percent);
        return;
      }
      if (message.type === 'RESULT') {
        finish(() =>
          resolve({
            pieces: message.pieces,
            warnings: message.warnings,
            units: message.units,
          }),
        );
        return;
      }
      finish(() => reject(new Error(message.message)));
    };

    // A worker that fails to start reports here, not through onmessage.
    worker.onerror = (event) => {
      finish(() => reject(new Error(event.message || 'DXF worker failed to start')));
    };

    const request: DxfWorkerRequest = {
      type: 'PARSE_DXF',
      dxfText: options.dxfText,
      ...(options.rulText === undefined ? {} : { rulText: options.rulText }),
    };
    worker.postMessage(request);
  });
