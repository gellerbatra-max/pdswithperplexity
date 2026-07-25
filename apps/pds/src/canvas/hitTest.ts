import type { Vec2 } from '@/geometry';
import { outlinePoints, type PatternPiece, type PieceId, type PointId } from '@/pattern';

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
