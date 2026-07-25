import type { GrainLineId, InternalLineId, NotchId, PointId, SegmentId } from './ids';

/**
 * Marks that live on or inside a piece: grain, notches and internal lines.
 * All of them anchor to points or segments by id so they travel with the
 * geometry when it moves or grades.
 */

export type GrainLineKind = 'grain' | 'cross-grain' | 'bias' | 'fold';

/**
 * Direction the piece is laid on the fabric. Anchored to two points so the
 * grain rotates with the piece and grades with it.
 */
export interface GrainLine {
  readonly id: GrainLineId;
  readonly kind: GrainLineKind;
  readonly from: PointId;
  readonly to: PointId;
  /** Grain markers usually point both ways; fold lines carry none. */
  readonly arrows: 'none' | 'start' | 'end' | 'both';
}

export type NotchKind = 'slit' | 'v' | 'castle' | 'u' | 't';

/**
 * A registration mark on the outline, positioned along a segment rather than at
 * a fixed coordinate, so it stays put when the segment is reshaped or graded.
 */
export interface Notch {
  readonly id: NotchId;
  readonly segmentId: SegmentId;
  /** Position along the segment: 0 at `from`, 1 at `to`. */
  readonly t: number;
  readonly kind: NotchKind;
  /** Millimetres into the piece. */
  readonly depth: number;
  readonly width: number;
  /** Degrees from the inward normal; 0 follows the normal. */
  readonly angle: number;
  readonly label?: string;
  /** The matching notch on the piece this seam joins, for walk and verify. */
  readonly pairedWith?: NotchId;
}

export type InternalLineRole =
  | 'dart'
  | 'fold'
  | 'placement'
  | 'stitch'
  | 'drill'
  | 'button'
  | 'buttonhole'
  | 'construction';

/**
 * A path inside the piece — dart legs, pocket placement, fold lines, drill
 * marks. Built from the piece's own point pool so internal geometry grades
 * with the outline instead of drifting away from it.
 */
export interface InternalLine {
  readonly id: InternalLineId;
  readonly role: InternalLineRole;
  readonly points: readonly PointId[];
  readonly closed: boolean;
  readonly label?: string;
  /** Whether the cutter should cut this path rather than just draw it. */
  readonly cut: boolean;
}
