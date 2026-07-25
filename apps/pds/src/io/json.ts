import type { PatternDocument } from '@/pattern';
import type { FormatAdapter } from './types';

export const PDS_JSON_VERSION = 1;

interface Envelope {
  readonly format: 'pds-json';
  readonly version: number;
  readonly document: PatternDocument;
}

/** The native document format. Lossless, versioned, and the basis for autosave. */
export const jsonAdapter: FormatAdapter = {
  descriptor: {
    id: 'pds-json',
    label: 'PDS document (JSON)',
    extension: '.pds.json',
    status: 'available',
    canImport: true,
    canExport: true,
  },

  serialize: (document) =>
    JSON.stringify(
      { format: 'pds-json', version: PDS_JSON_VERSION, document } satisfies Envelope,
      null,
      2,
    ),

  deserialize: (payload) => {
    const parsed = JSON.parse(payload) as Partial<Envelope>;
    if (parsed.format !== 'pds-json' || !parsed.document) {
      throw new Error('Not a PDS document');
    }
    if (parsed.version !== PDS_JSON_VERSION) {
      throw new Error(`Unsupported document version: ${String(parsed.version)}`);
    }
    return parsed.document;
  },
};
