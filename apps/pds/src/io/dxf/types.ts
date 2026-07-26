import type { Unit } from '@/geometry';
import type { Severity } from '@/diagnostics';

/**
 * Types shared by the DXF import and export halves.
 *
 * "DXF" here means the apparel-industry profile of DXF — AAMA's convention and
 * the ASTM D6673 standard that grew out of it — not general-purpose CAD DXF.
 * Both put pattern semantics in *layer numbers* rather than in entity types,
 * which is why `layerMapping.ts` is the centre of this module.
 */

/**
 * Which industry profile a file follows. They share a container and most layer
 * assignments but differ in metadata conventions and in how piece-level data is
 * carried, so the flavour has to be known at both ends.
 */
export type DxfFlavour = 'aama' | 'astm';

export const DXF_FLAVOUR_LABEL: Record<DxfFlavour, string> = {
  aama: 'DXF (AAMA)',
  astm: 'DXF (ASTM D6673)',
};

/**
 * DXF entity kinds this module will need to read and write. Anything outside
 * this set is ignored on import rather than guessed at.
 */
export type DxfEntityKind = 'POLYLINE' | 'LWPOLYLINE' | 'LINE' | 'ARC' | 'POINT' | 'TEXT';

export interface DxfImportOptions {
  readonly flavour: DxfFlavour;
  /**
   * Unit the file's coordinates are in. DXF carries $INSUNITS, but apparel
   * files are inconsistent about setting it, so the caller can override.
   */
  readonly assumeUnit?: Unit;
  /** Treat unknown layer numbers as an error rather than skipping them. */
  readonly strict?: boolean;
}

export interface DxfExportOptions {
  readonly flavour: DxfFlavour;
  /** Unit written into the file. Geometry is stored in mm and converted on the way out. */
  readonly unit: Unit;
  /** Write the cut line (net + seam allowance) as well as the net line. */
  readonly includeSeamAllowance: boolean;
  /** Write every size in the range rather than the base size alone. */
  readonly includeGradedSizes: boolean;
}

export const DEFAULT_IMPORT_OPTIONS: Omit<DxfImportOptions, 'flavour'> = {
  assumeUnit: 'mm',
  strict: false,
};

export const DEFAULT_EXPORT_OPTIONS: Omit<DxfExportOptions, 'flavour'> = {
  unit: 'mm',
  includeSeamAllowance: true,
  includeGradedSizes: false,
};

/** One problem found by validation, on either side of the conversion. */
export interface ConversionIssue {
  readonly severity: Severity;
  readonly code: string;
  readonly message: string;
  /** Piece the issue belongs to, when it is piece-scoped. */
  readonly pieceId?: string;
}
