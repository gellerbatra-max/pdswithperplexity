import type { PatternDocument } from './document';
import type { MeasurementLink } from './measurement';
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
