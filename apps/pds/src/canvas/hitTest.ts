import type { Vec2 } from '@/geometry';
import {
  findSegment,
  outlinePoints,
  projectOntoBoundary,
  type HandleKind,
  type PatternPiece,
  type PieceId,
  type PointId,
  type SegmentId,
} from '@/pattern';

/** Even-odd ray cast against the flattened outline. */
const containsPoint = (outline: readonly Vec2[], p: Vec2): boolean => {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i];
    const b = outline[j];
    if (!a || !b) continue;
    const intersects =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
};

export interface PointHit {
  readonly pieceId: PieceId;
  readonly pointId: PointId;
}

/**
 * Nearest point within `tolerance` document units of `point`, or null.
 * Construction points are skipped — they position other geometry rather than
 * being handles in their own right.
 */
export const pickPoint = (
  pieces: readonly PatternPiece[],
  point: Vec2,
  tolerance: number,
): PointHit | null => {
  let best: PointHit | null = null;
  let bestDistance = tolerance;

  for (const piece of pieces) {
    for (const candidate of piece.points) {
      if (candidate.role === 'construction') continue;
      const distance = Math.hypot(
        candidate.position.x - point.x,
        candidate.position.y - point.y,
      );
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = { pieceId: piece.id, pointId: candidate.id };
      }
    }
  }

  return best;
};

export interface SegmentHit {
  readonly pieceId: PieceId;
  readonly segmentId: SegmentId;
  /**
   * Where along the edge the hit landed, 0 at `from` and 1 at `to`.
   *
   * Approximated from the flattened polyline: the sample interval that was hit
   * gives the coarse position and projecting onto it gives the rest. That is
   * accurate to the flattening density, which is what inserting a point needs —
   * the split itself is exact wherever `t` lands, so an imprecise `t` moves the
   * new point along the curve but never off it.
   */
  readonly t: number;
}

/**
 * Nearest boundary segment within `tolerance` of `point`, or null.
 *
 * Solved against the real curve via `projectOntoBoundary`, not against the
 * flattened polyline. That gives both a true distance and an exact `t`, which
 * matters because the same `t` is what splits an edge or places a notch — a
 * value read off the flattening would put them a fraction of a millimetre from
 * where the pointer actually was, and would drift with the sample spacing.
 */
export const pickSegment = (
  pieces: readonly PatternPiece[],
  point: Vec2,
  tolerance: number,
): SegmentHit | null => {
  let best: SegmentHit | null = null;
  let bestDistance = tolerance;

  for (const piece of pieces) {
    const hit = projectOntoBoundary(piece, point);
    if (hit && hit.distance <= bestDistance) {
      bestDistance = hit.distance;
      best = { pieceId: piece.id, segmentId: hit.segment.id, t: hit.t };
    }
  }

  return best;
};

/**
 * Nearest cubic control handle of `segmentId` within `tolerance`, or null.
 *
 * Only meaningful for a segment that is already selected — handles are drawn
 * for the selection alone, and a handle that cannot be seen must not be
 * grabbable. `control1` is checked first so that when the two coincide (a
 * freshly curved edge, whose handles sit on the chord) the drag is
 * deterministic rather than depending on iteration order.
 */
export const pickHandle = (
  piece: PatternPiece,
  segmentId: SegmentId,
  point: Vec2,
  tolerance: number,
): HandleKind | null => {
  const segment = findSegment(piece, segmentId);
  if (!segment || segment.geometry.kind !== 'cubic') return null;

  const first = Math.hypot(
    segment.geometry.control1.x - point.x,
    segment.geometry.control1.y - point.y,
  );
  const second = Math.hypot(
    segment.geometry.control2.x - point.x,
    segment.geometry.control2.y - point.y,
  );

  if (first <= tolerance && first <= second) return 'control1';
  if (second <= tolerance) return 'control2';
  return null;
};

/** Topmost piece under a document-space point, or null. */
export const pickPiece = (
  pieces: readonly PatternPiece[],
  point: Vec2,
): PieceId | null => {
  for (let i = pieces.length - 1; i >= 0; i -= 1) {
    const piece = pieces[i];
    if (!piece) continue;
    const outline = outlinePoints(piece);
    if (outline.length >= 3 && containsPoint(outline, point)) return piece.id;
  }
  return null;
};
