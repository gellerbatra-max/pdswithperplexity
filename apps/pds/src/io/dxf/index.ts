import type { PatternDocument } from '@/pattern';
import type { FormatAdapter } from '../types';
import { exportDxf } from './export';
import { importDxf } from './import';
import { DEFAULT_EXPORT_OPTIONS, DEFAULT_IMPORT_OPTIONS, type DxfFlavour } from './types';

/**
 * DXF adapters.
 *
 * Both flavours share one implementation and differ only by the flavour flag
 * threaded through import, export and the layer table. The adapters are wired
 * up now so the format registry, the export list and the command palette all
 * reach real code — which fails honestly — instead of a placeholder object that
 * silently does nothing.
 */
const dxfAdapter = (
  id: 'dxf-aama' | 'astm',
  label: string,
  flavour: DxfFlavour,
): FormatAdapter => ({
  descriptor: {
    id,
    label,
    extension: '.dxf',
    // Still 'planned': the adapter exists, the conversion does not.
    status: 'planned',
    canImport: true,
    canExport: true,
  },
  serialize: (document: PatternDocument) =>
    exportDxf(document, { ...DEFAULT_EXPORT_OPTIONS, flavour }),
  deserialize: (payload: string) =>
    importDxf(payload, { ...DEFAULT_IMPORT_OPTIONS, flavour }),
});

export const aamaAdapter = dxfAdapter('dxf-aama', 'DXF (AAMA)', 'aama');
export const astmAdapter = dxfAdapter('astm', 'DXF (ASTM)', 'astm');

export { importDxf, importDxfWithDiagnostics, describeImportPlan, TREATMENT_LABEL } from './import';
export { parseRuleTable } from './ruleTable';
export type { ParsedRuleTable } from './ruleTable';
export type {
  ImportPlan,
  ImportPlanStep,
  DxfImportResult,
  LayerObservation,
  LayerUsageRow,
  LayerTreatment,
} from './import';
export { exportDxf, describeExportPlan } from './export';
export type { ExportPlan } from './export';
export {
  layerMapFor,
  layerForConcept,
  conceptForLayer,
  isMappingVerified,
  unverifiedBindings,
} from './layerMapping';
export type { LayerBinding, PatternConcept } from './layerMapping';
export {
  validateForExport,
  validateImportedDocument,
  blocksConversion,
  summariseIssues,
} from './validation';
// Severity counting is shared vocabulary, not a DXF concern.
export { countBySeverity } from '@/diagnostics';
export type {
  DxfFlavour,
  DxfImportOptions,
  DxfExportOptions,
  DxfEntityKind,
  ConversionIssue,
} from './types';
export { DXF_FLAVOUR_LABEL, DEFAULT_IMPORT_OPTIONS, DEFAULT_EXPORT_OPTIONS } from './types';
