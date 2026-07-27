import type { PatternDocument } from './document';
import type { SizeId } from './ids';
import type { MeasurementLink } from './measurement';
import { gradePiece } from './nest';
import { findPiece, findPoint, findSegment, segmentLength } from './resolve';

/**
 * Evaluate a measurement link against the document.
 *
 * Each ref contributes either the arc length of a run of segments or the
 * straight distance between a pair of points, scaled by its `factor` — that is
 * how a quarter-pattern girth adds up to a garment measurement.
 *
 * Returns null when nothing resolved, so the UI can distinguish "not linked to
 * geometry yet" from "measures zero".
 */
export const evaluateMeasurement = (
  document: PatternDocument,
  link: MeasurementLink,
): number | null => {
  let total = 0;
  let resolved = false;

  for (const ref of link.refs) {
    const piece = findPiece(document, ref.pieceId);
    if (!piece) continue;
    const factor = ref.factor ?? 1;

    for (const segmentId of ref.segmentIds ?? []) {
      const segment = findSegment(piece, segmentId);
      if (!segment) continue;
      total += segmentLength(piece, segment) * factor;
      resolved = true;
    }

    const pointIds = ref.pointIds ?? [];
    if (pointIds.length === 2) {
      const a = findPoint(piece, pointIds[0] ?? '');
      const b = findPoint(piece, pointIds[1] ?? '');
      if (a && b) {
        total += Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y) * factor;
        resolved = true;
      }
    }
  }

  return resolved ? total : null;
};

export interface MeasurementResult {
  readonly link: MeasurementLink;
  /** Measured from the pattern, or null when the refs do not resolve. */
  readonly measured: number | null;
  /** measured − spec, when both are known. */
  readonly deviation: number | null;
  readonly withinTolerance: boolean | null;
}

export const evaluateMeasurements = (
  document: PatternDocument,
): readonly MeasurementResult[] =>
  document.measurements.map((link) => {
    const measured = evaluateMeasurement(document, link);
    const deviation =
      measured !== null && link.spec !== undefined ? measured - link.spec : null;
    const withinTolerance =
      deviation !== null && link.tolerance !== undefined
        ? Math.abs(deviation) <= link.tolerance
        : null;
    return { link, measured, deviation, withinTolerance };
  });

/**
 * Evaluates a measurement against one size's graded geometry instead of the
 * base pattern.
 *
 * Grading is non-destructive — `gradePiece` returns a new piece and never
 * touches the document — so this builds a throwaway document whose pieces
 * are swapped for their graded selves and hands it to `evaluateMeasurement`,
 * rather than re-implementing ref-walking a second time for the graded case.
 * A spec sheet's tolerance is defined at the base size; nothing here re-checks
 * it against a graded value; that judgement belongs to whoever reads the
 * number, not to this function.
 */
export const evaluateMeasurementAtSize = (
  document: PatternDocument,
  link: MeasurementLink,
  sizeId: SizeId,
): number | null => {
  if (sizeId === document.sizeRange.baseSizeId) return evaluateMeasurement(document, link);

  const graded: PatternDocument = {
    ...document,
    pieces: document.pieces.map((piece) => gradePiece(piece, document.gradeRules, sizeId)),
  };
  return evaluateMeasurement(graded, link);
};

/** Every measurement's graded value at one size, spec and tolerance still read at base. */
export const evaluateMeasurementsAtSize = (
  document: PatternDocument,
  sizeId: SizeId,
): readonly MeasurementResult[] =>
  document.measurements.map((link) => {
    const measured = evaluateMeasurementAtSize(document, link, sizeId);
    const deviation =
      measured !== null && link.spec !== undefined ? measured - link.spec : null;
    const withinTolerance =
      deviation !== null && link.tolerance !== undefined
        ? Math.abs(deviation) <= link.tolerance
        : null;
    return { link, measured, deviation, withinTolerance };
  });
