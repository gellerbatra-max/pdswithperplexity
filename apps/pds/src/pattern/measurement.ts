import type { MeasurementId, PieceId, PointId, SegmentId } from './ids';

/**
 * Measurement links bind a point of measure from the spec sheet to the geometry
 * that produces it, so a measurement is derived from the pattern rather than
 * typed in beside it. When the pattern changes, the measured value follows.
 */

export type MeasurementKind =
  /** Straight-line distance between two points. */
  | 'point-to-point'
  /** Arc length along a run of segments. */
  | 'path-length'
  /** Sum of several runs, e.g. a chest girth across front and back. */
  | 'girth';

/** The geometry one measurement reads from; a girth spans several of these. */
export interface MeasurementRef {
  readonly pieceId: PieceId;
  readonly pointIds?: readonly PointId[];
  readonly segmentIds?: readonly SegmentId[];
  /** Multiplier for the contribution, e.g. 2 for a piece cut as a mirrored pair. */
  readonly factor?: number;
}

export interface MeasurementLink {
  readonly id: MeasurementId;
  /** Spec sheet code, e.g. 'POM-01'. */
  readonly code: string;
  readonly label: string;
  readonly kind: MeasurementKind;
  readonly refs: readonly MeasurementRef[];
  /** Target from the spec sheet, in document units. */
  readonly spec?: number;
  readonly tolerance?: number;
  /** Measure over the cut line rather than the net line. */
  readonly includeSeamAllowance: boolean;
  readonly notes?: string;
}
