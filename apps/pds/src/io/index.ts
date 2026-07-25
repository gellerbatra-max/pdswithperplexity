import type { PatternDocument } from '@/pattern';
import { jsonAdapter } from './json';
import type { FormatAdapter, FormatDescriptor, FormatId } from './types';

const planned = (
  id: FormatId,
  label: string,
  extension: string,
  canImport: boolean,
  canExport: boolean,
): FormatAdapter => ({
  descriptor: { id, label, extension, status: 'planned', canImport, canExport },
});

/** Format registry. Adding a format means adding an adapter here — nothing else changes. */
const ADAPTERS: readonly FormatAdapter[] = [
  jsonAdapter,
  planned('dxf-aama', 'DXF (AAMA)', '.dxf', true, true),
  planned('astm', 'DXF (ASTM)', '.dxf', true, true),
  planned('svg', 'SVG', '.svg', false, true),
  planned('pdf', 'PDF (tiled plot)', '.pdf', false, true),
];

export const listFormats = (): readonly FormatDescriptor[] =>
  ADAPTERS.map((adapter) => adapter.descriptor);

export const getAdapter = (id: FormatId): FormatAdapter => {
  const adapter = ADAPTERS.find((a) => a.descriptor.id === id);
  if (!adapter) throw new Error(`Unknown format: ${id}`);
  return adapter;
};

export const exportDocument = (document: PatternDocument, id: FormatId = 'pds-json'): string => {
  const adapter = getAdapter(id);
  if (!adapter.serialize) throw new Error(`${adapter.descriptor.label} export is not implemented yet`);
  return adapter.serialize(document);
};

export const importDocument = (payload: string, id: FormatId = 'pds-json'): PatternDocument => {
  const adapter = getAdapter(id);
  if (!adapter.deserialize) throw new Error(`${adapter.descriptor.label} import is not implemented yet`);
  return adapter.deserialize(payload);
};

export type { FormatAdapter, FormatDescriptor, FormatId, FormatStatus } from './types';
