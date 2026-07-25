import { boundarySegments, findPoint, type PatternDocument, type PatternPiece } from '@/pattern';
import { unverifiedBindings } from './layerMapping';
import type { ConversionIssue, DxfExportOptions, DxfFlavour } from './types';

/**
 * Pre-flight validation.
 *
 * Unlike the parser and writer, this is implemented for real — it inspects our
 * own document against what an AAMA/ASTM file requires, which needs no DXF
 * knowledge beyond the layer table. Running it before a conversion exists is
 * still useful: it tells a pattern maker what would block an export today.
 *
 * Import-side validation (`validateImportedDocument`) runs on the document a
 * parser produces, so it is written now and will be wired up when the parser
 * lands.
 */

const pieceIssues = (piece: PatternPiece): ConversionIssue[] => {
  const issues: ConversionIssue[] = [];

  if (piece.boundary.length === 0) {
    issues.push({
      severity: 'error',
      code: 'empty-boundary',
      message: `"${piece.name}" has no boundary, so it has nothing to write on the piece-boundary layer.`,
      pieceId: piece.id,
    });
  }

  // A boundary segment referencing a missing point would emit a broken polyline.
  const dangling = boundarySegments(piece).filter(
    (segment) => !findPoint(piece, segment.from) || !findPoint(piece, segment.to),
  );
  if (dangling.length > 0) {
    issues.push({
      severity: 'error',
      code: 'dangling-segment',
      message: `"${piece.name}" has ${dangling.length} boundary segment(s) pointing at a missing point.`,
      pieceId: piece.id,
    });
  }

  if (!piece.closed) {
    issues.push({
      severity: 'warning',
      code: 'open-boundary',
      message: `"${piece.name}" is an open outline; most cutting rooms expect closed pieces.`,
      pieceId: piece.id,
    });
  }

  if (!piece.grainLine) {
    issues.push({
      severity: 'warning',
      code: 'missing-grain',
      message: `"${piece.name}" has no grain line, so nothing is written on the grain layer.`,
      pieceId: piece.id,
    });
  }

  if (piece.meta.code.trim() === '') {
    issues.push({
      severity: 'warning',
      code: 'missing-code',
      message: `"${piece.name}" has no piece code; downstream systems key on it.`,
      pieceId: piece.id,
    });
  }

  return issues;
};

/** Everything that would block or degrade an export of `document`. */
export const validateForExport = (
  document: PatternDocument,
  options: Pick<DxfExportOptions, 'flavour' | 'includeGradedSizes'>,
): readonly ConversionIssue[] => {
  const issues: ConversionIssue[] = [];

  // The mapping itself is unverified, which blocks any real write.
  const unverified = unverifiedBindings(options.flavour);
  if (unverified.length > 0) {
    issues.push({
      severity: 'error',
      code: 'unverified-layer-map',
      message: `${unverified.length} layer binding(s) are unverified against the standard. See io/dxf/layerMapping.ts.`,
    });
  }

  if (document.pieces.length === 0) {
    issues.push({
      severity: 'error',
      code: 'no-pieces',
      message: 'The document has no pieces to export.',
    });
  }

  const seen = new Map<string, string>();
  for (const piece of document.pieces) {
    issues.push(...pieceIssues(piece));

    const code = piece.meta.code.trim();
    if (code !== '') {
      const previous = seen.get(code);
      if (previous) {
        issues.push({
          severity: 'warning',
          code: 'duplicate-piece-code',
          message: `Piece code "${code}" is used by both "${previous}" and "${piece.name}".`,
          pieceId: piece.id,
        });
      } else {
        seen.set(code, piece.name);
      }
    }
  }

  if (options.includeGradedSizes && document.gradeRules.length === 0) {
    issues.push({
      severity: 'warning',
      code: 'no-grade-rules',
      message: 'Graded sizes were requested but the document has no grade rules; every size would be identical.',
    });
  }

  return issues;
};

/**
 * Checks to run on a document produced by the importer. Written now so the
 * parser has a target to satisfy; it is not called until one exists.
 */
export const validateImportedDocument = (
  document: PatternDocument,
): readonly ConversionIssue[] => {
  const issues: ConversionIssue[] = [];

  if (document.pieces.length === 0) {
    issues.push({
      severity: 'error',
      code: 'import-empty',
      message: 'No pieces were read from the file.',
    });
  }

  for (const piece of document.pieces) {
    if (piece.points.length === 0) {
      issues.push({
        severity: 'error',
        code: 'import-no-points',
        message: `"${piece.name}" was read with no points.`,
        pieceId: piece.id,
      });
    }
  }

  return issues;
};

export const countBySeverity = (
  issues: readonly ConversionIssue[],
): Record<ConversionIssue['severity'], number> => ({
  error: issues.filter((i) => i.severity === 'error').length,
  warning: issues.filter((i) => i.severity === 'warning').length,
  info: issues.filter((i) => i.severity === 'info').length,
});

export const blocksConversion = (issues: readonly ConversionIssue[]): boolean =>
  issues.some((issue) => issue.severity === 'error');

/** Convenience for the command palette and future export dialog. */
export const summariseIssues = (
  issues: readonly ConversionIssue[],
  flavour: DxfFlavour,
): string => {
  const counts = countBySeverity(issues);
  if (issues.length === 0) return `${flavour.toUpperCase()}: no issues found`;
  return `${flavour.toUpperCase()}: ${counts.error} error(s), ${counts.warning} warning(s)`;
};
