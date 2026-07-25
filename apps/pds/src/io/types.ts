import type { PatternDocument } from '@/pattern';

export type FormatId = 'pds-json' | 'dxf-aama' | 'astm' | 'svg' | 'pdf';

export type FormatStatus = 'available' | 'planned';

export interface FormatDescriptor {
  readonly id: FormatId;
  readonly label: string;
  readonly extension: string;
  readonly status: FormatStatus;
  readonly canImport: boolean;
  readonly canExport: boolean;
}

/** Every file format plugs in behind this interface — one adapter per format. */
export interface FormatAdapter {
  readonly descriptor: FormatDescriptor;
  serialize?: (document: PatternDocument) => string;
  deserialize?: (payload: string) => PatternDocument;
}
