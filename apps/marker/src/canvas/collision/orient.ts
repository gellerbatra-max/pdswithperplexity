/**
 * Applying a piece's flip and rotation to an arbitrary point list.
 *
 * `pieceGeometry.orientedGeometry` does this for a piece's own outline, but
 * collision needs the same transform applied to its convex parts, which are
 * derived from that outline rather than stored on the piece. Same order —
 * flip, then rotate counter-clockwise — because CLAUDE.md requires rendering,
 * collision and nesting to agree.
 */

import type { PlacedPiece, Point } from '@/marker/schema';

const DEG_TO_RAD = Math.PI / 180;

export const orientPoints = (
  points: readonly Point[],
  piece: Pick<PlacedPiece, 'rotation' | 'flipped'>,
): Point[] => {
  const radians = piece.rotation * DEG_TO_RAD;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map((point) => {
    const x = piece.flipped ? -point.x : point.x;
    const y = point.y;
    return { x: x * cos - y * sin, y: x * sin + y * cos };
  });
};
