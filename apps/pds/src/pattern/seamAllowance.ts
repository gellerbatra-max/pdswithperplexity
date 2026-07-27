import { offsetRing, type Vec2 } from '@/geometry';
import { flattenSegment } from './curve';
import type { SegmentId } from './ids';
import type { PatternPiece } from './piece';
import { boundarySegments, segmentEndpoints } from './resolve';

/**
 * The cut line: the piece outline offset outward by its seam allowance.
 *
 * This replaces the widened stroke the renderer used to draw. A stroke is
 * centred on the outline and covers the allowance on *both* sides; the cut line
 * is a real second curve on one side, and it is what a cutter follows and what
 * a DXF writer has to emit.
 */

/**
 * Outline samples tagged with the segment that produced each edge, so a
 * per-segment allowance can be turned into a per-edge offset distance.
 *
 * Entry `i` of `edgeSegmentIds` owns the edge from vertex `i` to vertex `i+1`.
 */
interface TaggedOutline {
  readonly points: readonly Vec2[];
  readonly edgeSegmentIds: readonly SegmentId[];
}

const taggedOutline = (piece: PatternPiece): TaggedOutline => {
  const segments = boundarySegments(piece);
  const points: Vec2[] = [];
  const edgeSegmentIds: SegmentId[] = [];

  let first = true;
  for (const segment of segments) {
    const ends = segmentEndpoints(piece, segment);
    if (!ends) continue;
    if (first) {
      points.push(ends[0]);
      first = false;
    }
    // `flattenSegment` excludes `from` and includes `to`, so every sample it
    // returns closes an edge that belongs to this segment.
    for (const sample of flattenSegment(ends[0], ends[1], segment.geometry)) {
      points.push(sample);
      edgeSegmentIds.push(segment.id);
    }
  }

  return { points, edgeSegmentIds };
};

/**
 * Allowance in millimetres for one segment: its own override when present,
 * otherwise the piece default. Zero is a real value (a net-cut edge) and is
 * preserved; only an absent override falls through.
 */
const allowanceFor = (piece: PatternPiece, segmentId: SegmentId): number => {
  const segment = piece.segments.find((s) => s.id === segmentId);
  return segment?.seamAllowance ?? piece.seamAllowance;
};

/**
 * Cached per piece object. Offsetting walks every edge against every other to
 * trim self-intersections, so it is far too costly to redo per frame — and the
 * cache is only sound because pieces are immutable, exactly as with
 * `outlinePoints`. An edited piece is a new object and misses.
 */
const cache = new WeakMap<PatternPiece, readonly Vec2[]>();

const EMPTY: readonly Vec2[] = [];

const compute = (piece: PatternPiece): readonly Vec2[] => {
  // An open piece has no inside, so "outward" is undefined and there is no
  // cut line to derive. Returning empty is honest; guessing a side is not.
  if (!piece.closed) return EMPTY;

  const { points, edgeSegmentIds } = taggedOutline(piece);
  if (points.length < 3) return EMPTY;

  const distances = edgeSegmentIds.map((id) => allowanceFor(piece, id));
  if (distances.every((d) => d === 0)) return EMPTY;

  // The scalar fallback only applies to edges the tagging missed; the
  // per-edge array is what actually drives the offset.
  return offsetRing(points, piece.seamAllowance, { distances });
};

/**
 * The cut line as a closed polyline, or an empty array when the piece has no
 * allowance, is not closed, or the offset consumes the shape.
 *
 * The returned array is cached and shared — treat it as read-only.
 */
export const seamAllowanceRing = (piece: PatternPiece): readonly Vec2[] => {
  const cached = cache.get(piece);
  if (cached) return cached;
  const computed = compute(piece);
  cache.set(piece, computed);
  return computed;
};
