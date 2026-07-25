import type { PatternDocument } from '@/pattern';
import { FormatNotImplementedError } from '../errors';
import { layerMapFor } from './layerMapping';
import { validateForExport } from './validation';
import type { ConversionIssue, DxfExportOptions, DxfFlavour } from './types';
import { DXF_FLAVOUR_LABEL } from './types';

/**
 * DXF export — NOT IMPLEMENTED.
 *
 * Intended responsibilities, in order:
 *
 *  1. Run `validateForExport` and refuse on any error-severity issue. Writing a
 *     knowingly broken file is the one outcome worse than refusing.
 *  2. Emit HEADER with $INSUNITS, $EXTMIN/$EXTMAX and the ASTM version marker.
 *  3. Emit one BLOCK per piece, named from the piece code.
 *  4. Within each block, write geometry onto the layers `layerMapping` assigns:
 *     boundary polyline, turn and curve points, notches, grain, internals,
 *     annotation text.
 *  5. Flatten curves to polylines at an agreed chord tolerance — DXF has ARC and
 *     SPLINE, but apparel readers are far more reliable with dense polylines,
 *     and tolerance choice is a real decision to make deliberately, not silently.
 *  6. Optionally emit the seam-allowance line and each graded size, per options.
 *  7. Convert millimetres into the requested output unit on the way out.
 *
 * Export is the easier half — we own the topology, so there is nothing to
 * infer — but it is still gated on the layer table being verified, since a file
 * written to wrong layer numbers is silently wrong in someone else's CAD.
 */
export const exportDxf = (
  _document: PatternDocument,
  options: DxfExportOptions,
): string => {
  throw new FormatNotImplementedError(
    DXF_FLAVOUR_LABEL[options.flavour],
    'export',
    'the DXF writer is not written yet',
  );
};

export interface ExportPlan {
  readonly flavour: DxfFlavour;
  readonly label: string;
  readonly blocksToWrite: number;
  readonly layersUsed: number;
  readonly issues: readonly ConversionIssue[];
  readonly wouldSucceed: boolean;
}

/**
 * What an export of this document would involve, including the real validation
 * result. Useful before the writer exists: it tells a pattern maker what would
 * block them today.
 */
export const describeExportPlan = (
  document: PatternDocument,
  options: Pick<DxfExportOptions, 'flavour' | 'includeGradedSizes'>,
): ExportPlan => {
  const issues = validateForExport(document, options);
  return {
    flavour: options.flavour,
    label: DXF_FLAVOUR_LABEL[options.flavour],
    blocksToWrite: document.pieces.length,
    layersUsed: layerMapFor(options.flavour).length,
    issues,
    // False regardless of issues while the writer is missing — stated plainly
    // rather than implied by an empty issue list.
    wouldSucceed: false,
  };
};
