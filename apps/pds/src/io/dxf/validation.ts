import { boundarySegments, findPoint, type PatternDocument, type PatternPiece } from '@/pattern';
import { countBySeverity } from '@/diagnostics';
import { unverifiedBindings, type PatternConcept } from './layerMapping';
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

/**
 * Everything that would block or degrade an export of `document`.
 *
 * `writtenConcepts` is the set of layer bindings the writer will actually use.
 * The layer gate is scoped to those, and deliberately so: blocking an export
 * because `drill-hole` is unverified, when the writer emits nothing on that
 * layer, refuses a file for a risk it does not carry. What matters is whether
 * the concepts being *written* rest on something real.
 *
 * Within that set the gate has two levels, because "unverified" covers two
 * very different states:
 *
 *   error    a written concept with no evidence at all — neither checked
 *            against ASTM D6673 nor observed in a real file. Writing to a
 *            guessed layer number puts the guess in someone else's cutting
 *            room, which is worse than refusing.
 *   warning  a written concept observed in real vendor files but still not
 *            checked against the standard. That is the strongest evidence
 *            anything in this table has; it is not certainty, and it is said
 *            out loud on every export.
 *
 * Omitting `writtenConcepts` keeps the original all-or-nothing behaviour, so
 * a caller asking "could this document export at all" still gets the strict
 * answer.
 */
export const validateForExport = (
  document: PatternDocument,
  options: Pick<DxfExportOptions, 'flavour' | 'includeGradedSizes'>,
  writtenConcepts?: readonly PatternConcept[],
): readonly ConversionIssue[] => {
  const issues: ConversionIssue[] = [];

  const unverified = unverifiedBindings(options.flavour);
  const relevant =
    writtenConcepts === undefined
      ? unverified
      : unverified.filter((binding) => writtenConcepts.includes(binding.concept));

  const guessed = relevant.filter((binding) => (binding.observedInFixtures?.length ?? 0) === 0);
  const observedOnly = relevant.filter((binding) => (binding.observedInFixtures?.length ?? 0) > 0);

  if (guessed.length > 0) {
    issues.push({
      severity: 'error',
      code: 'unverified-layer-map',
      message: `${guessed.length} layer binding(s) this export would write to (${guessed
        .map((b) => `${b.concept} → layer ${b.layer}`)
        .join(', ')}) have no evidence behind them — neither checked against ASTM D6673 nor observed in a real file. See io/dxf/layerMapping.ts.`,
    });
  }
  if (observedOnly.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'layer-map-observed-not-verified',
      message: `${observedOnly.length} layer binding(s) this export writes to (${observedOnly
        .map((b) => `${b.concept} → layer ${b.layer}, seen in ${b.observedInFixtures!.length} real file(s)`)
        .join(', ')}) match real vendor files but have still not been checked against the ASTM D6673 text. That is the strongest evidence this table has; it is not the standard.`,
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
