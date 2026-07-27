import { BoundsOps, type Bounds, type Vec2 } from '@/geometry';
import {
  flattenSegment,
  nearestOnSegment,
  pointOnSegment,
  segmentArcLength,
  splitSegment,
} from './curve';
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
 * Flattened-outline cache. Pieces are immutable, so a piece object is a valid
 * cache key for its own geometry: any edit produces a new object and misses.
 * This matters because hover hit-testing re-flattens every piece on every
 * pointer move, and each piece is well over a hundred sampled points.
 */
const outlineCache = new WeakMap<PatternPiece, Vec2[]>();

const computeOutline = (piece: PatternPiece): Vec2[] => {
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

/**
 * The outline as a flat polyline, curves subdivided. This is the canonical
 * input for bounds, hit testing and length measurement.
 *
 * The returned array is cached and shared — treat it as read-only.
 */
export const outlinePoints = (piece: PatternPiece): Vec2[] => {
  const cached = outlineCache.get(piece);
  if (cached) return cached;
  const computed = computeOutline(piece);
  outlineCache.set(piece, computed);
  return computed;
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

/**
 * Length cache, keyed on the piece.
 *
 * Deliberately *not* keyed on the segment: a straight segment whose endpoint
 * moves keeps its identity, because `translatePoints` only rebuilds segments
 * whose geometry object changed. The piece is always a new object after an
 * edit, so it is the only safe key here.
 */
const lengthCache = new WeakMap<PatternPiece, Map<SegmentId, number>>();

/**
 * Arc length of a single segment, curves included.
 *
 * Integrated from the curve itself rather than summed off the flattened
 * polyline, so the value depends on the geometry and not on how finely it
 * happened to be sampled. Every point of measure reads through here.
 */
export const segmentLength = (piece: PatternPiece, segment: PieceSegment): number => {
  let cache = lengthCache.get(piece);
  if (!cache) {
    cache = new Map();
    lengthCache.set(piece, cache);
  }
  const cached = cache.get(segment.id);
  if (cached !== undefined) return cached;

  const ends = segmentEndpoints(piece, segment);
  const length = ends ? segmentArcLength(ends[0], ends[1], segment.geometry) : 0;
  cache.set(segment.id, length);
  return length;
};

export interface SegmentProjection {
  readonly segment: PieceSegment;
  /** Parameter along the segment, 0 at `from` and 1 at `to`. */
  readonly t: number;
  readonly position: Vec2;
  readonly distance: number;
}

/**
 * Closest point on a piece's boundary to `p`, solved against the real curves.
 *
 * The single entry point for "what is under the pointer, and where along it" —
 * picking an edge, splitting one, and placing a notch all need the same answer,
 * and all of them need it to be the true closest point rather than the nearest
 * flattening sample.
 */
export const projectOntoBoundary = (
  piece: PatternPiece,
  p: Vec2,
): SegmentProjection | null => {
  let best: SegmentProjection | null = null;
  for (const segment of boundarySegments(piece)) {
    const ends = segmentEndpoints(piece, segment);
    if (!ends) continue;
    const hit = nearestOnSegment(ends[0], ends[1], segment.geometry, p);
    if (!best || hit.distance < best.distance) {
      best = { segment, t: hit.t, position: hit.position, distance: hit.distance };
    }
  }
  return best;
};

/**
 * Distance along a segment from its start to parameter `t`.
 *
 * Notches are stored by parameter but read by pattern makers in millimetres
 * from the seam start, which is how they are specified and checked.
 */
export const lengthAlongSegment = (
  piece: PatternPiece,
  segment: PieceSegment,
  t: number,
): number => {
  const ends = segmentEndpoints(piece, segment);
  if (!ends) return 0;
  const split = splitSegment(ends[0], ends[1], segment.geometry, Math.min(1, Math.max(0, t)));
  return segmentArcLength(ends[0], split.at, split.left);
};

/** Total outline length. */
export const outlineLength = (piece: PatternPiece): number =>
  boundarySegments(piece).reduce((total, s) => total + segmentLength(piece, s), 0);

export const findPiece = (document: PatternDocument, id: string) =>
  document.pieces.find((piece) => piece.id === id);
