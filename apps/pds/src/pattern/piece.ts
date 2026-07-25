import type { Vec2 } from '@/geometry';
import type { SegmentGeometry } from './curve';
import type { GradeRuleId, PieceId, PointId, SegmentId } from './ids';
import type { GrainLine, InternalLine, Notch } from './annotations';

/**
 * What a point is for. `corner` and `curve` shape the outline; `construction`
 * points position darts, drills and internal lines without being on it.
 */
export type PointRole = 'corner' | 'curve' | 'construction' | 'intersection';

/**
 * A positioned, identified point in the piece's local coordinate space
 * (millimetres, y-down, origin at the piece's own reference point).
 *
 * Points are the single source of truth for position. Segments, notches,
 * internal lines and grade rules all reference points by id rather than
 * copying coordinates, so moving a point propagates everywhere at once.
 */
export interface PiecePoint {
  readonly id: PointId;
  readonly position: Vec2;
  readonly role: PointRole;
  /** Pattern-maker's name for the point, e.g. 'HPS', 'Dart apex'. */
  readonly label?: string;
  /** Grade rule driving this point across the size range, when graded. */
  readonly gradeRuleId?: GradeRuleId;
}

/** How a seam is finished; drives allowance defaults and the cut file. */
export type SeamFinish = 'plain' | 'overlock' | 'felled' | 'bound' | 'taped' | 'none';

/**
 * A directed edge between two points. Segments are stored in a pool and
 * ordered by the piece's `boundary`, so a segment can later be shared between
 * loops or referenced by a mating piece for seam walking.
 */
export interface PieceSegment {
  readonly id: SegmentId;
  readonly from: PointId;
  readonly to: PointId;
  readonly geometry: SegmentGeometry;
  /** Pattern-maker's name for the edge, e.g. 'Shoulder', 'Armhole'. */
  readonly label?: string;
  /** Overrides the piece default when present. Millimetres. */
  readonly seamAllowance?: number;
  readonly seamFinish?: SeamFinish;
  /** Segment on the piece this one is sewn to — the basis for walk/verify. */
  readonly mateSegmentId?: SegmentId;
}

export type PieceCategory = 'shell' | 'lining' | 'interlining' | 'trim';

/** Production data for a piece — what the cutter and the BOM need. */
export interface PieceMeta {
  readonly code: string;
  readonly category: PieceCategory;
  readonly fabric: string;
  /** Cut quantity per garment. */
  readonly quantity: number;
  readonly onFold: boolean;
  /** Cut as a mirrored pair. */
  readonly mirrored: boolean;
  readonly description?: string;
}

/**
 * A pattern piece: a point pool, a segment pool, an ordered boundary over those
 * segments, and the annotations that sit on or inside it.
 *
 * `boundary` holds segment ids rather than the segments themselves so that
 * multi-loop pieces (a panel with a cut-out) can be added later as an optional
 * `holes: SegmentId[][]` without breaking anything that reads the model today.
 */
export interface PatternPiece {
  readonly id: PieceId;
  readonly name: string;
  readonly points: readonly PiecePoint[];
  readonly segments: readonly PieceSegment[];
  /** Ordered segment ids tracing the outline; head-to-tail, closed when `closed`. */
  readonly boundary: readonly SegmentId[];
  readonly closed: boolean;
  /** Default allowance in millimetres; 0 means net line only. */
  readonly seamAllowance: number;
  readonly grainLine?: GrainLine;
  readonly notches: readonly Notch[];
  readonly internalLines: readonly InternalLine[];
  readonly meta: PieceMeta;
}
