import type { Vec2 } from '@/geometry';
import { outlinePoints, type PatternPiece, type PieceId } from '@/pattern';

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
