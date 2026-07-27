import { boundarySegments, findPoint, type PatternDocument, type PatternPiece } from '@/pattern';
import { countBySeverity } from '@/diagnostics';
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

/** How close two points must be, in millimetres, to call them the same vertex. */
const SAME_POINT_TOLERANCE_MM = 1e-6;

/**
 * Points that repeat an earlier point in the ring without being adjacent to
 * it — a boundary that visits the same coordinate twice is either a real,
 * unusual piece (a binding strip with a return path) or an export mistake,
 * and this module cannot tell those apart. What it can do is say so, rather
 * than silently importing a self-overlapping outline as if it were an
 * ordinary simple polygon — seen in real production files (a fixture under
 * `scripts/fixtures/dxf/` has two pieces that trip this).
 */
const nonAdjacentRepeatCount = (piece: PatternPiece): number => {
  const n = piece.points.length;
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      const a = piece.points[i]!.position;
      const b = piece.points[j]!.position;
      if (
        Math.abs(a.x - b.x) <= SAME_POINT_TOLERANCE_MM &&
        Math.abs(a.y - b.y) <= SAME_POINT_TOLERANCE_MM
      ) {
        count += 1;
      }
    }
  }
  return count;
};

/**
 * Checks to run on a document produced by the importer.
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
      continue;
    }

    const repeats = nonAdjacentRepeatCount(piece);
    if (repeats > 0) {
      issues.push({
        severity: 'warning',
        code: 'self-overlapping-boundary',
        message: `"${piece.name}" revisits an earlier point ${repeats} time(s) without being adjacent to it — its boundary is not a simple polygon. This may be intentional (e.g. a binding strip's return path) or a source-file issue; review before cutting.`,
        pieceId: piece.id,
      });
    }
  }

  return issues;
};

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
