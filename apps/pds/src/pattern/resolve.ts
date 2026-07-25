import { BoundsOps, type Bounds, type Vec2 } from '@/geometry';
import { flattenSegment, pointOnSegment } from './curve';
import type { PatternDocument } from './document';
import type { PointId, SegmentId } from './ids';
import type { PatternPiece, PieceSegment } from './piece';

/**
 * Read-side helpers over the pattern model.
 *
 * The model stores topology (points and segments referenced by id) because that
 * is what edits and grading need. Renderers, hit tests and measurements want
 * coordinates. Everything that turns one into the other lives here, so no
 * consumer has to know how the pools are wired.
 */

export const findPoint = (piece: PatternPiece, id: PointId) =>
  piece.points.find((point) => point.id === id);

export const findSegment = (piece: PatternPiece, id: SegmentId) =>
  piece.segments.find((segment) => segment.id === id);

/** Start and end coordinates of a segment, or null if either point is missing. */
export const segmentEndpoints = (
  piece: PatternPiece,
  segment: PieceSegment,
): readonly [Vec2, Vec2] | null => {
  const from = findPoint(piece, segment.from);
  const to = findPoint(piece, segment.to);
  return from && to ? [from.position, to.position] : null;
};

/** Coordinate at parameter `t` along a segment — used to place notches. */
export const pointAlongSegment = (
  piece: PatternPiece,
  segment: PieceSegment,
  t: number,
): Vec2 | null => {
  const ends = segmentEndpoints(piece, segment);
  return ends ? pointOnSegment(ends[0], ends[1], segment.geometry, t) : null;
};

/** Segments of the outline in boundary order, skipping any dangling references. */
export const boundarySegments = (piece: PatternPiece): PieceSegment[] =>
  piece.boundary
    .map((id) => findSegment(piece, id))
    .filter((segment): segment is PieceSegment => segment !== undefined);

/**
 * The outline as a flat polyline, curves subdivided. This is the canonical
 * input for bounds, hit testing and length measurement.
 */
export const outlinePoints = (piece: PatternPiece): Vec2[] => {
  const segments = boundarySegments(piece);
  if (segments.length === 0) return [];

  const out: Vec2[] = [];
  let first = true;
  for (const segment of segments) {
    const ends = segmentEndpoints(piece, segment);
    if (!ends) continue;
    if (first) {
      out.push(ends[0]);
      first = false;
    }
    out.push(...flattenSegment(ends[0], ends[1], segment.geometry));
  }
  return out;
};

/** Coordinates for a run of point ids — internal lines, measurement refs. */
export const pointPositions = (
  piece: PatternPiece,
  ids: readonly PointId[],
): Vec2[] =>
  ids
    .map((id) => findPoint(piece, id)?.position)
    .filter((position): position is Vec2 => position !== undefined);

export const pieceBounds = (piece: PatternPiece): Bounds =>
  BoundsOps.fromPoints(outlinePoints(piece));

export const documentBounds = (document: PatternDocument): Bounds =>
  document.pieces
    .map(pieceBounds)
    .filter((bounds) => !BoundsOps.isEmpty(bounds))
    .reduce(BoundsOps.union, BoundsOps.EMPTY_BOUNDS);

/** Arc length of a single segment, curves included. */
export const segmentLength = (piece: PatternPiece, segment: PieceSegment): number => {
  const ends = segmentEndpoints(piece, segment);
  if (!ends) return 0;
  let total = 0;
  let previous = ends[0];
  for (const point of flattenSegment(ends[0], ends[1], segment.geometry)) {
    total += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return total;
};

/** Total outline length. */
export const outlineLength = (piece: PatternPiece): number =>
  boundarySegments(piece).reduce((total, s) => total + segmentLength(piece, s), 0);

export const findPiece = (document: PatternDocument, id: string) =>
  document.pieces.find((piece) => piece.id === id);
